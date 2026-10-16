import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { ReviewStore, digest } from "../server/review/store.mjs";

const enabled = process.env.REVIEW_INTEGRATION_TESTS === "true" && Boolean(process.env.REVIEW_DATABASE_URL);
/** Unique tables prevent these opt-in tests from claiming real queued reviews. */
async function fixture(work) {
  const store = new ReviewStore(), raw = store.pool;
  const prefix = `it_${randomUUID().replaceAll("-", "")}_`;
  const rewrite = sql => sql.replace(/arq_review\.(jobs|events|evidence|profiles|schedules|audit)\b/g, `arq_review.${prefix}$1`).replace(/\breview_(jobs_owner|events_job)\b/g, `${prefix}review_$1`);
  store.pool = {
    query: (sql, args) => raw.query(rewrite(sql), args),
    connect: async () => { const client = await raw.connect(); return { query: (sql, args) => client.query(rewrite(sql), args), release: () => client.release() }; },
  };
  const blobs = [];
  try { await store.init(); await work(store, blobs); }
  finally {
    for (const key of blobs) await store.blobs?.deleteBlob(key).catch(() => {});
    for (const table of ["events", "evidence", "profiles", "schedules", "jobs", "audit"]) await raw.query(`DROP TABLE IF EXISTS arq_review.${prefix}${table} CASCADE`);
    await raw.end();
  }
}

test("managed PostgreSQL: exclusive leases, recovery, fencing, profiles and due schedules", { skip: !enabled }, async () => fixture(async store => {
  const input = { systemName: "Isolated queue fixture", tier: 3, standardIds: ["deployment_review"], credentials: { chatbotEndpoint: "https://example.com/" } }, owner = "fixture-owner";
  const ids = await Promise.all([store.submit(owner, input), store.submit(owner, input)]);
  const [first, second] = await Promise.all([store.claim(), store.claim()]);
  assert.ok(ids.includes(first.id) && ids.includes(second.id)); assert.notEqual(first.id, second.id);
  await store.pool.query("UPDATE arq_review.jobs SET lease_until=now()-interval '1 second' WHERE id=$1", [first.id]);
  const recovered = await store.claim(); assert.equal(recovered.id, first.id); assert.notEqual(recovered.lease, first.lease);
  assert.equal(await store.heartbeat(first.id, first.lease), false);
  assert.equal((await store.finish(first.id, first.lease, { forged: true })).rowCount, 0);
  assert.equal((await store.finish(recovered.id, recovered.lease, null, "Fixture, not an assessment")).rowCount, 1);
  assert.equal(await store.cancel(owner, second.id), true);
  const schedule = await store.schedule(owner, input, 900);
  await store.pool.query("UPDATE arq_review.schedules SET next_due=now()-interval '1 second' WHERE id=$1", [schedule]);
  await store.enqueueDue();
  const scheduled = (await store.schedules(owner)).find(item => item.id === schedule);
  assert.ok(scheduled.last_job); assert.equal((await store.get(owner, scheduled.last_job)).status, "queued");
  await store.disableSchedule(owner, schedule); assert.equal((await store.schedules(owner))[0].enabled, false);
  const profile = await store.saveProfile(owner, { name: "Public source fixture", kind: "github", targetOrigin: "https://example.com", config: { repository: "owner/repo", token: "test-only-not-a-real-token" } });
  assert.equal((await store.profiles(owner))[0].config, undefined);
  assert.equal((await store.profiles("other-owner")).length, 0);
  assert.equal((await store.profiles(owner, true))[0].config.token, "test-only-not-a-real-token");
  await store.deleteProfile(owner, profile); assert.equal((await store.profiles(owner)).length, 0);
}));

test("managed evidence store: non-admin role, ciphertext, blob persistence and owner isolation", { skip: !enabled || !process.env.REVIEW_STORAGE_CONNECTION_STRING }, async () => fixture(async (store, blobs) => {
  const identity = (await store.pool.query("SELECT current_user,rolsuper,rolcreaterole FROM pg_roles WHERE rolname=current_user")).rows[0];
  assert.equal(identity.current_user, "arq_review_app"); assert.equal(identity.rolsuper, false); assert.equal(identity.rolcreaterole, false);
  const owner = "evidence-fixture", id = await store.submit(owner, { systemName: "Isolated evidence fixture", tier: 3, standardIds: [], credentials: { chatbotEndpoint: "https://example.com" } });
  const record = { layer: "testing", source: "urn:arq:isolated-storage-fixture", collectedAt: new Date().toISOString(), observations: [], note: "ciphertext-test-marker" };
  const saved = await store.evidence({ id }, record); assert.equal(saved.hash, digest(record));
  assert.equal((await store.readEvidence(owner, id)).length, 1); assert.equal((await store.readEvidence("other-owner", id)).length, 0);
  const row = (await store.pool.query("SELECT payload,object_key FROM arq_review.evidence WHERE id=$1", [saved.id])).rows[0];
  blobs.push(row.object_key); assert.ok(!row.payload.includes(record.note)); assert.ok(await store.blobs.getBlockBlobClient(row.object_key).exists());
}));
