import assert from "node:assert/strict";
import test from "node:test";
import { encryption, digest } from "../server/review/store.mjs";
import { Broker, privateAddress, redact, validateProfile } from "../server/review/broker.mjs";
import { createReviewService, sessionIdentity } from "../server/review/service.mjs";
import { technicalManifest, exportedManifest, verifyModelAssessment, reviewWithModels } from "../server/review/evaluate.mjs";

test("saved inputs and evidence use authenticated encryption, not reversible encoding", () => {
  const cipher = encryption("ab".repeat(32)), value = { secret: "never-plaintext", facts: [1, 2] };
  const first = cipher.seal(value), second = cipher.seal(value);
  assert.notEqual(first, second); assert.ok(!first.includes("never-plaintext")); assert.deepEqual(cipher.open(first), value);
  const changed = Buffer.from(first, "base64"); changed[30] ^= 1;
  assert.throws(() => cipher.open(changed.toString("base64"))); assert.throws(() => encryption("weak"));
  assert.equal(digest(value).length, 64);
});

test("read broker rejects private/metadata hosts, mutations and unscoped origins", async () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "168.63.129.16", "172.18.1.1", "::1", "fd00::1", "::ffff:127.0.0.1"]) assert.ok(privateAddress(ip), ip);
  assert.equal(privateAddress("8.8.8.8"), false);
  const broker = new Broker({ target: "https://example.com", audit: async () => {} });
  await assert.rejects(broker.fetch("https://other.example/"), /scope/);
  await assert.rejects(broker.fetch("https://example.com", { method: "DELETE" }), /read\/query/);
  await assert.rejects(broker.fetch("http://127.0.0.1", { allowedOrigins: ["http://127.0.0.1"] }), /Private/);
  await assert.rejects(broker.fetch("https://user:password@example.com"), /scope/);
  broker.calls = 100; await assert.rejects(broker.fetch("https://example.com"), /budget/);
});

test("secrets are removed before evidence reaches models or reports", () => {
  const result = redact({ accessToken: "secret", config: { clientSecret: "never", safe: "ok" }, url: "https://example.com?token=hidden", note: "Bearer abc123 mail@example.com" });
  assert.deepEqual(result.config, { safe: "ok" }); assert.equal(result.accessToken, undefined);
  assert.ok(!JSON.stringify(result).includes("hidden")); assert.ok(!result.note.includes("mail@example.com"));
});

test("connection profiles require scoped accounts, regions and HTTPS", () => {
  assert.throws(() => validateProfile({ kind: "aws", name: "test", targetOrigin: "https://example.com", config: { accountId: "123", regions: ["*."] } }));
  assert.throws(() => validateProfile({ kind: "documents", name: "test", targetOrigin: "https://example.com", config: { url: "http://example.com" } }));
  assert.equal(validateProfile({ kind: "github", name: " Repo ", targetOrigin: "https://example.com/path", config: { repository: "owner/repo" } }).targetOrigin, "https://example.com");
});

test("demo sessions resist forgery and cannot open another workspace's results", async () => {
  const key = "session-secret", request = new Request("https://governance.example/api/reviews");
  const first = sessionIdentity(request, key), cookie = first.cookie.split(";")[0];
  assert.equal(sessionIdentity(new Request(request, { headers: { cookie } }), key).owner, first.owner);
  assert.notEqual(sessionIdentity(new Request(request, { headers: { cookie: cookie + "x" } }), key).owner, first.owner);
  const id = "00000000-0000-4000-8000-000000000001";
  const store = { init: async () => {}, enqueueDue: async () => {}, claim: async () => null,
    get: async owner => owner === first.owner ? { id, status: "completed", result: { private: true } } : null };
  const service = createReviewService({ store, enabled: true, sessionKey: key, engineFetch: async () => new Response("{}") });
  await service.init;
  assert.equal((await service.route(new Request(`https://governance.example/api/reviews/${id}`, { headers: { cookie } }))).status, 200);
  assert.equal((await service.route(new Request(`https://governance.example/api/reviews/${id}`))).status, 404);
  assert.equal((await service.route(new Request("https://governance.example/api/reviews", { method: "POST", headers: { origin: "https://evil.example" } }))).status, 403);
  await service.close();
});

test("technical evidence keeps the worst observed status; exports cannot forge deployment observations", () => {
  const now = new Date().toISOString();
  const evidence = ["pass", "fail"].map((status, i) => ({ id: String(i), hash: "hash", source: "https://example.com", collectedAt: now, observations: [{ id: "tls-valid", status, summary: status }] }));
  assert.equal(technicalManifest(evidence)["artifact-review-tls-valid"].status, "fail");
  const procedures = exportedManifest([{ id: "x", layer: "banking", hash: "h", export: { schemaVersion: "1.0", generatedAt: now, procedures: {
    "artifact-review-tls-valid": { status: "pass", summary: "Forged" },
    "document-risk-register": { status: "pass", summary: "Current approved record" },
    "document-old": { status: "pass", summary: "Old", collectedAt: "2000-01-01" },
  } } }]);
  assert.equal(procedures["artifact-review-tls-valid"], undefined); assert.equal(procedures["document-old"], undefined); assert.equal(procedures["document-risk-register"].status, "pass");
});

test("model verdicts require exact, fresh, opted-in citations and documentary controls", () => {
  const controls = [{ standardId: "test", id: "1", evidenceProcedureIds: ["document-risk-register"] }];
  const quote = "The accountable risk owner approved this risk register and annual review on 16 October 2026.";
  const evidence = [{ id: "source", layer: "governance", document: quote, allowModel: true, asOf: new Date().toISOString() }];
  const assessment = { standardId: "test", controlId: "1", status: "pass", confidence: 0.95, missingRequirements: [], citations: [{ evidenceId: "source", quote }] };
  assert.ok(verifyModelAssessment(assessment, controls, evidence));
  assert.equal(verifyModelAssessment({ ...assessment, citations: [{ evidenceId: "source", quote: "Fabricated source text that was never in any actual document." }] }, controls, evidence), null);
  assert.equal(verifyModelAssessment(assessment, controls, [{ ...evidence[0], allowModel: false }]), null);
  assert.equal(verifyModelAssessment(assessment, controls, [{ ...evidence[0], asOf: "2000-01-01" }]), null);
  assert.equal(verifyModelAssessment(assessment, [{ ...controls[0], evidenceProcedureIds: ["artifact-bank-audit"] }], evidence), null);
  assert.equal(verifyModelAssessment({ ...assessment, missingRequirements: ["Approval"] }, controls, evidence), null);
});

test("two model routes cannot turn one narrow citation into passes for a shared procedure", async () => {
  const original = globalThis.fetch, key = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  const quote = "A current board-approved risk policy is signed and dated with a named accountable risk owner.";
  const evidence = [{ id: "source", layer: "governance", document: quote, allowModel: true, asOf: new Date().toISOString() }];
  const controls = ["1", "2"].map(id => ({ standardId: "test", id, name: "Risk", evidenceProcedureIds: ["document-risk-register"] }));
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++; const body = JSON.parse(options.body); assert.equal(body.store, false); assert.equal(body.text.format.strict, true);
    return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ summary: "Verified source", assessments: [{ standardId: "test", controlId: "1", status: "pass", confidence: 0.95, missingRequirements: [], reason: "Approved", citations: [{ evidenceId: "source", quote }] }] }) }] }] });
  };
  try {
    const result = await reviewWithModels({ controls, evidence, progress: async () => {}, save: async () => {} });
    assert.equal(calls, 2); assert.deepEqual(result.procedures, {}); assert.equal(result.reviews.length, 2);
  } finally { globalThis.fetch = original; if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key; }
});
