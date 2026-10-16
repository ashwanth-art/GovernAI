import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { BlobServiceClient } from "@azure/storage-blob";

export function encryption(key) {
  if (!/^[a-f0-9]{64}$/i.test(key ?? "")) throw new Error("REVIEW_ENCRYPTION_KEY must be a 32-byte hex secret.");
  const bytes = Buffer.from(key, "hex");
  return {
    seal(value) {
      const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", bytes, iv);
      const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
    },
    open(value) {
      const data = Buffer.from(value, "base64"), cipher = createDecipheriv("aes-256-gcm", bytes, data.subarray(0, 12));
      cipher.setAuthTag(data.subarray(12, 28));
      return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString());
    },
  };
}

export const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export class ReviewStore {
  constructor({ databaseUrl = process.env.REVIEW_DATABASE_URL, key = process.env.REVIEW_ENCRYPTION_KEY, storage = process.env.REVIEW_STORAGE_CONNECTION_STRING } = {}) {
    if (!databaseUrl) throw new Error("Persistent review database is not configured.");
    this.cipher = encryption(key);
    const url = new URL(databaseUrl); url.searchParams.delete("sslmode");
    this.pool = new Pool({ connectionString: url.toString(), ssl: { rejectUnauthorized: true }, max: 5, connectionTimeoutMillis: 15000 });
    this.blobs = storage ? BlobServiceClient.fromConnectionString(storage).getContainerClient(process.env.REVIEW_EVIDENCE_CONTAINER || "review-evidence") : null;
  }
  async init() {
    await this.pool.query(`
      CREATE SCHEMA IF NOT EXISTS arq_review;
      CREATE TABLE IF NOT EXISTS arq_review.jobs (
        id uuid PRIMARY KEY, owner text NOT NULL, status text NOT NULL DEFAULT 'queued',
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        input text NOT NULL, result text, summary jsonb NOT NULL DEFAULT '{}',
        lease uuid, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0,
        cancelled boolean NOT NULL DEFAULT false, error text);
      CREATE INDEX IF NOT EXISTS review_jobs_owner ON arq_review.jobs(owner,created_at DESC);
      CREATE TABLE IF NOT EXISTS arq_review.events (
        sequence bigserial PRIMARY KEY, job_id uuid REFERENCES arq_review.jobs(id) ON DELETE CASCADE,
        name text NOT NULL, payload text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
      CREATE INDEX IF NOT EXISTS review_events_job ON arq_review.events(job_id,sequence);
      CREATE TABLE IF NOT EXISTS arq_review.evidence (
        id uuid PRIMARY KEY, job_id uuid REFERENCES arq_review.jobs(id) ON DELETE CASCADE,
        layer text NOT NULL, source text NOT NULL, hash text NOT NULL, payload text NOT NULL,
        object_key text, collected_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS arq_review.profiles (
        id uuid PRIMARY KEY, owner text NOT NULL, name text NOT NULL, kind text NOT NULL,
        target_origin text NOT NULL, sealed text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS arq_review.schedules (
        id uuid PRIMARY KEY, owner text NOT NULL, input text NOT NULL, interval_seconds integer NOT NULL,
        next_due timestamptz NOT NULL, enabled boolean NOT NULL DEFAULT true, last_job uuid);
      CREATE TABLE IF NOT EXISTS arq_review.audit (
        sequence bigserial PRIMARY KEY, owner text NOT NULL, action text NOT NULL,
        subject text NOT NULL, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
    `);
    if (this.blobs) await this.blobs.createIfNotExists();
  }
  async audit(owner, action, subject, detail = {}) {
    await this.pool.query("INSERT INTO arq_review.audit(owner,action,subject,detail) VALUES($1,$2,$3,$4)", [owner, action, subject, detail]);
  }
  async submit(owner, input) {
    // A global bound also limits anonymous-session churn in the public demo.
    const usage = await this.pool.query("SELECT count(*)::int AS count FROM arq_review.jobs WHERE created_at>now()-interval '1 day'");
    if (usage.rows[0].count >= Number(process.env.REVIEW_DAILY_JOB_LIMIT || 100)) throw new Error("The daily review safety budget is exhausted. Try again tomorrow.");
    const id = randomUUID();
    const summary = { systemName: input.systemName, tier: input.tier, standardIds: input.standardIds, stage: "Queued", target: new URL(input.credentials.chatbotEndpoint).origin };
    await this.pool.query("INSERT INTO arq_review.jobs(id,owner,input,summary) VALUES($1,$2,$3,$4)", [id, owner, this.cipher.seal(input), summary]);
    await this.audit(owner, "review.queued", id);
    return id;
  }
  async claim() {
    const lease = randomUUID();
    const { rows } = await this.pool.query(`UPDATE arq_review.jobs SET status='running', lease=$1, lease_until=now()+interval '90 seconds', attempts=attempts+1, updated_at=now()
      WHERE id=(SELECT id FROM arq_review.jobs WHERE NOT cancelled AND attempts<3 AND (status='queued' OR (status='running' AND lease_until<now())) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING *`, [lease]);
    if (!rows[0]) return null;
    return { ...rows[0], input: this.cipher.open(rows[0].input) };
  }
  async heartbeat(id, lease) {
    const { rowCount } = await this.pool.query("UPDATE arq_review.jobs SET lease_until=now()+interval '90 seconds',updated_at=now() WHERE id=$1 AND lease=$2 AND status='running' AND NOT cancelled", [id, lease]);
    return rowCount === 1;
  }
  async emit(id, name, payload) {
    await this.pool.query("INSERT INTO arq_review.events(job_id,name,payload) VALUES($1,$2,$3)", [id, name, this.cipher.seal(payload)]);
  }
  async stage(id, stage) {
    await this.pool.query("UPDATE arq_review.jobs SET summary=summary || $2::jsonb,updated_at=now() WHERE id=$1", [id, JSON.stringify({ stage })]);
    await this.emit(id, "review_progress", { message: stage, occurredAt: new Date().toISOString() });
  }
  async finish(id, lease, result, error) {
    return this.pool.query("UPDATE arq_review.jobs SET status=$3,result=$4,error=$5,lease_until=NULL,input=$6,updated_at=now() WHERE id=$1 AND lease=$2 AND NOT cancelled", [id, lease, error ? "failed" : "completed", result ? this.cipher.seal(result) : null, error || null, this.cipher.seal({ erased: true })]);
  }
  async get(owner, id, includeResult = false) {
    const { rows } = await this.pool.query("SELECT id,status,created_at,updated_at,summary,error,result FROM arq_review.jobs WHERE owner=$1 AND id=$2", [owner, id]);
    if (!rows[0]) return null;
    const { result, ...row } = rows[0];
    return { ...row, ...(includeResult && result ? { result: this.cipher.open(result) } : {}) };
  }
  async list(owner) {
    return (await this.pool.query("SELECT id,status,created_at,updated_at,summary,error FROM arq_review.jobs WHERE owner=$1 ORDER BY created_at DESC LIMIT 30", [owner])).rows;
  }
  async events(id, after) {
    const { rows } = await this.pool.query("SELECT sequence,name,payload FROM arq_review.events WHERE job_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 500", [id, after]);
    return rows.map(row => ({ sequence: Number(row.sequence), name: row.name, data: this.cipher.open(row.payload) }));
  }
  async cancel(owner, id) {
    const { rowCount } = await this.pool.query("UPDATE arq_review.jobs SET cancelled=true,status='cancelled',input=$3,updated_at=now() WHERE owner=$1 AND id=$2 AND status IN ('queued','running')", [owner, id, this.cipher.seal({ erased: true })]);
    if (rowCount) await this.audit(owner, "review.cancelled", id);
    return rowCount > 0;
  }
  async evidence(job, record) {
    const id = randomUUID(), hash = digest(record), sealed = this.cipher.seal(record);
    const objectKey = this.blobs ? `${job.id}/${id}.sealed` : null;
    if (this.blobs) await this.blobs.getBlockBlobClient(objectKey).upload(sealed, Buffer.byteLength(sealed));
    await this.pool.query("INSERT INTO arq_review.evidence(id,job_id,layer,source,hash,payload,object_key) VALUES($1,$2,$3,$4,$5,$6,$7)", [id, job.id, record.layer, record.source, hash, sealed, objectKey]);
    return { id, hash, ...record };
  }
  async readEvidence(owner, jobId) {
    const { rows } = await this.pool.query("SELECT e.* FROM arq_review.evidence e JOIN arq_review.jobs j ON e.job_id=j.id WHERE j.owner=$1 AND j.id=$2 ORDER BY e.collected_at", [owner, jobId]);
    return rows.map(row => ({ id: row.id, hash: row.hash, ...this.cipher.open(row.payload) }));
  }
  async profiles(owner, includeSecrets = false) {
    const { rows } = await this.pool.query("SELECT * FROM arq_review.profiles WHERE owner=$1 ORDER BY created_at", [owner]);
    return rows.map(row => ({ id: row.id, name: row.name, kind: row.kind, targetOrigin: row.target_origin, ...(includeSecrets ? { config: this.cipher.open(row.sealed) } : {}) }));
  }
  async saveProfile(owner, profile) {
    const id = randomUUID();
    await this.pool.query("INSERT INTO arq_review.profiles(id,owner,name,kind,target_origin,sealed) VALUES($1,$2,$3,$4,$5,$6)", [id, owner, profile.name, profile.kind, profile.targetOrigin, this.cipher.seal(profile.config)]);
    await this.audit(owner, "connection.created", id, { kind: profile.kind });
    return id;
  }
  async deleteProfile(owner, id) {
    await this.pool.query("DELETE FROM arq_review.profiles WHERE owner=$1 AND id=$2", [owner, id]);
    await this.audit(owner, "connection.removed", id);
  }
  async schedule(owner, input, intervalSeconds) {
    const count = await this.pool.query("SELECT count(*)::int AS count FROM arq_review.schedules WHERE owner=$1 AND enabled", [owner]);
    if (count.rows[0].count >= 5) throw new Error("Disable an existing schedule before creating another (maximum five).");
    const id = randomUUID();
    await this.pool.query("INSERT INTO arq_review.schedules(id,owner,input,interval_seconds,next_due) VALUES($1,$2,$3,$4,now()+make_interval(secs=>$4))", [id, owner, this.cipher.seal(input), intervalSeconds]);
    await this.audit(owner, "schedule.created", id, { intervalSeconds }); return id;
  }
  async schedules(owner) {
    return (await this.pool.query("SELECT id,interval_seconds,next_due,enabled,last_job FROM arq_review.schedules WHERE owner=$1", [owner])).rows;
  }
  async disableSchedule(owner, id) {
    await this.pool.query("UPDATE arq_review.schedules SET enabled=false,input=$3 WHERE owner=$1 AND id=$2", [owner, id, this.cipher.seal({ erased: true })]);
  }
  async enqueueDue() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query("SELECT * FROM arq_review.schedules WHERE enabled AND next_due<=now() FOR UPDATE SKIP LOCKED LIMIT 5");
      for (const row of rows) {
        const active = await client.query("SELECT 1 FROM arq_review.jobs WHERE summary->>'scheduleId'=$1 AND status IN ('queued','running') LIMIT 1", [row.id]);
        if (active.rowCount) continue;
        const usage = await client.query("SELECT count(*)::int AS count FROM arq_review.jobs WHERE created_at>now()-interval '1 day'");
        if (usage.rows[0].count >= Number(process.env.REVIEW_DAILY_JOB_LIMIT || 100)) break;
        const input = this.cipher.open(row.input), id = randomUUID();
        const summary = { systemName: input.systemName, tier: input.tier, standardIds: input.standardIds, stage: "Scheduled", scheduleId: row.id, target: new URL(input.credentials.chatbotEndpoint).origin };
        await client.query("INSERT INTO arq_review.jobs(id,owner,input,summary) VALUES($1,$2,$3,$4)", [id, row.owner, this.cipher.seal(input), summary]);
        await client.query("UPDATE arq_review.schedules SET next_due=now()+make_interval(secs=>interval_seconds),last_job=$2 WHERE id=$1", [row.id, id]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    await this.pool.query("UPDATE arq_review.jobs SET status='failed',error='Worker lease expired after three attempts',input=$1 WHERE status='running' AND lease_until<now() AND attempts>=3", [this.cipher.seal({ erased: true })]);
  }
}
