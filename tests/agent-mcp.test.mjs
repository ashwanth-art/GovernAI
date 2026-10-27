import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { fingerprint } from "../server/agent-security/contract.mjs";
import { createAgentGateway, createJwtIdentityVerifier } from "../server/agent-security/gateway.mjs";
import { agentRules, evaluateAgentExport, validateAgentProfile, collectAgentMcp } from "../server/review/agent-mcp.mjs";
import { evaluateTechnicalControls } from "../server/review/evaluate.mjs";
import { validateProfile } from "../server/review/broker.mjs";
import { createReviewService } from "../server/review/service.mjs";

const origin = "https://lab.example", resource = origin + "/mcp", issuer = "https://issuer.example";
const fixtureExport = () => { const now = new Date().toISOString(); return { schemaVersion: "1.0", targetOrigin: origin, generatedAt: now, scope: { id: "test-scope", assetIds: ["agent-one"], complete: true }, measurements: agentRules.map(rule => ({ ruleId: rule.id, assetId: "agent-one", collectedAt: now, sourceRef: origin + "/evidence", fields: Object.fromEntries(Object.entries(rule.fields).map(([key, condition]) => [key, condition === "positive" ? 10 : 0])) })) }; };

test("agent evidence detects every rule's violations, ignores claimed passes and refuses absent coverage", () => {
  const value = fixtureExport();
  assert.equal(evaluateAgentExport(value, origin).length, 13);
  assert.ok(evaluateAgentExport(value, origin).every(item => item.status === "pass"));
  for (const rule of agentRules) {
    const failed = structuredClone(value), field = Object.entries(rule.fields).find(([, condition]) => condition === "zero")[0];
    failed.measurements.find(item => item.ruleId === rule.id).fields[field] = 1;
    failed.measurements.find(item => item.ruleId === rule.id).status = "pass";
    assert.equal(evaluateAgentExport(failed, origin).find(item => item.id === rule.id).status, "fail");
  }
  for (const changed of [v => { v.scope.complete = false; }, v => { v.scope.assetIds.push("agent-two"); }, v => { v.measurements.forEach(item => { for (const key in item.fields) item.fields[key] = "0"; }); }, v => { v.measurements.forEach(item => { const pop = Object.keys(item.fields)[0]; item.fields[pop] = 0; }); }]) {
    const copy = structuredClone(value); changed(copy);
    assert.ok(evaluateAgentExport(copy, origin).some(item => item.status === "not_assessed"));
  }
  assert.throws(() => evaluateAgentExport({ ...value, targetOrigin: "https://other.example" }, origin));
  assert.throws(() => evaluateAgentExport({ ...value, generatedAt: "2020-01-01" }, origin));
  assert.throws(() => evaluateAgentExport({ ...value, measurements: [{ ruleId: "fabricated" }] }, origin));
  const outside = structuredClone(value); outside.measurements.forEach(item => { item.assetId = "outside"; });
  assert.ok(evaluateAgentExport(outside, origin).every(item => item.status === "not_assessed"));
});

test("MCP profiles require explicit bounded sandbox authorization; ordinary targets never receive arbitrary tool calls", () => {
  const config = { url: origin + "/evidence", mcpUrl: resource, approvedTools: [], allowActiveProbes: false };
  assert.ok(validateAgentProfile(config));
  assert.ok(validateProfile({ kind: "agent_mcp", name: "lab", targetOrigin: origin, config }));
  assert.throws(() => validateAgentProfile({ ...config, allowActiveProbes: true }));
  assert.throws(() => validateAgentProfile({ ...config, metadataUrl: "https://foreign.example/metadata" }));
  assert.throws(() => validateAgentProfile({ ...config, url: origin + "/evidence?token=unsafe" }));
  assert.throws(() => validateAgentProfile({ ...config, approvedTools: [{ name: "read", definitionHash: "not-reviewed" }] }));
});

test("agent/MCP contract is available inside the existing authenticated review workspace", async () => {
  const store = { init: async () => {}, enqueueDue: async () => {}, claim: async () => null };
  const service = createReviewService({ store, enabled: true, sessionKey: "test-key", engineFetch: async () => Response.json({}) });
  try { await service.init; const response = await service.route(new Request(`https://governance.example/api/reviews/agent-template?target=${encodeURIComponent(origin)}`));
    assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.targetOrigin, origin); assert.equal(body.contract.length, 13); assert.deepEqual(body.measurements, []); assert.equal(body.scope.complete, false);
  } finally { await service.close(); }
});

const tool = { name: "read_order", description: "Read a synthetic order", inputSchema: { type: "object", properties: { tenantId: { type: "string", maxLength: 50 }, orderId: { type: "string", maxLength: 100 } }, required: ["tenantId", "orderId"], additionalProperties: false } };

async function collectFixture({ pin = fingerprint(tool), denyStatus = 403, sandbox = true, active = false } = {}) {
  const records = [], calls = [];
  const config = { url: origin + "/evidence", mcpUrl: resource, metadataUrl: origin + "/.well-known/oauth-protected-resource/mcp", expectedIssuer: issuer, expectedAudience: resource, token: "discovery-secret", approvedTools: [{ name: tool.name, definitionHash: pin }], allowActiveProbes: active };
  if (active) Object.assign(config, { sandbox: { approved: true, id: "fixture-lab", fixtureTool: "arq_security_fixture" }, identities: [{ id: "reader", token: "identity-secret" }], tests: [
    { id: "allow", identityId: "reader", expect: "allow", arguments: { fixtureId: "allow-one", action: "read", tenantId: "tenant-a", resourceId: "tenant-a:one" } },
    { id: "deny", identityId: "reader", expect: "deny", arguments: { fixtureId: "deny-one", action: "read", tenantId: "tenant-b", resourceId: "tenant-b:one" } },
  ] });
  const broker = { fetch: async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null; calls.push({ url, method: body?.method });
    let status = 200, result;
    if (url.endsWith("/evidence")) return { ok: true, status, json: fixtureExport(), headers: {} };
    if (url.includes("/.well-known/")) return { ok: true, status, json: { resource, authorization_servers: [issuer] }, headers: {} };
    if (body.method === "initialize") result = { protocolVersion: "2025-11-25", serverInfo: { arqSandboxId: sandbox ? "fixture-lab" : "foreign", syntheticOnly: sandbox } };
    if (body.method === "notifications/initialized") return { ok: true, status: 202, headers: {} };
    if (body.method === "tools/list") result = { tools: [tool] };
    if (body.method === "tools/call") {
      assert.equal(body.params.name, "arq_security_fixture");
      if (body.params.arguments.tenantId === "tenant-b") status = denyStatus;
      result = { structuredContent: { authorized: true, sandboxId: "fixture-lab", fixtureId: body.params.arguments.fixtureId } };
    }
    return { status, ok: status >= 200 && status < 300, json: { jsonrpc: "2.0", id: body.id, result }, headers: {} };
  } };
  await collectAgentMcp({ broker, target: new URL(origin), save: async record => records.push({ ...record, id: "fixture-evidence", hash: "hash" }) }, { config });
  return { observations: records.flatMap(record => record.observations), calls, records };
}

test("native MCP discovery verifies definition pins and does not execute tool annotations", async () => {
  const good = await collectFixture();
  assert.equal(good.observations.find(item => item.id === "mcp-tool-integrity").status, "pass");
  assert.equal(good.observations.find(item => item.id === "mcp-metadata").status, "pass");
  assert.ok(!good.calls.some(call => call.method === "tools/call"));
  assert.equal((await collectFixture({ pin: "a".repeat(64) })).observations.find(item => item.id === "mcp-tool-integrity").status, "fail");
  assert.ok(!JSON.stringify(good.records).includes("discovery-secret"));
  assert.ok(!JSON.stringify(good.records).includes("identity-secret"));
  const technical = evaluateTechnicalControls([{ id: "MCP", evidenceProcedureIds: ["artifact-review-mcp-tool-integrity"], tierMinimum: 3 }], good.records, 3);
  assert.equal(technical[0].status, "pass");
});

test("native MCP safe fixtures require matching sandbox, working identities and explicit denials", async () => {
  for (const [http, expected] of [[403, "pass"], [401, "not_assessed"], [404, "not_assessed"], [200, "fail"]]) {
    const result = await collectFixture({ active: true, denyStatus: http });
    assert.equal(result.observations.filter(item => item.id === "mcp-authorization-matrix").at(-1).status, expected);
  }
  const other = await collectFixture({ active: true, sandbox: false });
  assert.ok(!other.calls.some(call => call.method === "tools/call"));
});

const identity = { subject: "user-one", agentId: "agent-one", tenantId: "tenant-a", tokenId: "token-one", scopes: ["orders:read"] };
const grant = { tool: tool.name, definitionHash: fingerprint(tool), subjects: [identity.subject], agentIds: [identity.agentId], tenantIds: [identity.tenantId], scopes: ["orders:read"], resourceArgument: "orderId", tenantArgument: "tenantId", resourcePrefixes: ["tenant-a:"], effect: "read", callsPerMinute: 10 };
const rpcRequest = (args = { tenantId: "tenant-a", orderId: "tenant-a:one" }, headers = {}) => new Request(resource, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool.name, arguments: args } }) });
function gatewayFixture(overrides = {}) {
  const audit = [], invocations = [], approvals = new Set(), current = { revoked: false, budget: true, auditWorks: true };
  const state = { isRevoked: async () => current.revoked, reserve: async () => current.budget, consumeApproval: async ({ id, binding, identity: user }) => {
    const key = `${id}:${binding}:${user.subject}`; if (!approvals.has(key)) return false; approvals.delete(key); return true;
  }, audit: async event => { if (!current.auditWorks) throw new Error("audit down"); audit.push(event); } };
  const options = { policy: { version: "v1", enabled: true, grants: [grant] }, resource, issuer, verifyIdentity: async () => identity, loadTool: async () => tool, invokeTool: async request => { invocations.push(request); return { content: [{ type: "text", text: "synthetic order" }] }; }, state, ...overrides };
  return { handle: createAgentGateway(options), audit, invocations, approvals, current, options };
}

test("gateway authorizes exact identities/scopes/tenant/resources and fails closed", async () => {
  const good = gatewayFixture(); assert.equal((await good.handle(rpcRequest())).status, 200);
  assert.ok(!JSON.stringify(good.invocations).includes("authorization"));
  assert.equal((await good.handle(rpcRequest({ tenantId: "tenant-b", orderId: "tenant-a:one" }))).status, 403);
  assert.equal((await good.handle(rpcRequest({ tenantId: "tenant-a", orderId: "tenant-b:one" }))).status, 403);
  assert.equal((await good.handle(rpcRequest({ tenantId: "tenant-a", orderId: "tenant-a:one", extra: "unsafe" }))).status, 400);
  for (const patch of [{ subject: "foreign" }, { agentId: "foreign" }, { tenantId: "foreign" }, { scopes: [] }]) {
    const blocked = gatewayFixture({ verifyIdentity: async () => ({ ...identity, ...patch }) }); assert.equal((await blocked.handle(rpcRequest())).status, 403); assert.equal(blocked.invocations.length, 0);
  }
  const changed = gatewayFixture({ loadTool: async () => ({ ...tool, description: "new injected instruction" }) }); assert.equal((await changed.handle(rpcRequest())).status, 403);
  good.current.revoked = true; assert.equal((await good.handle(rpcRequest())).status, 403);
  good.current.revoked = false; good.current.budget = false; assert.equal((await good.handle(rpcRequest())).status, 429);
  good.current.budget = true; good.current.auditWorks = false; assert.equal((await good.handle(rpcRequest())).status, 503); assert.equal(good.invocations.length, 1);
  const disabled = gatewayFixture({ policy: { enabled: false, version: "v1", grants: [grant] } }); assert.equal((await disabled.handle(rpcRequest())).status, 503);
  assert.equal((await gatewayFixture().handle(rpcRequest(undefined, { Origin: "https://attacker.example" }))).status, 403);
});

test("gateway consequential approval binds exact request and permits only one atomic consumption", async () => {
  const fixture = gatewayFixture({ policy: { version: "v1", enabled: true, grants: [{ ...grant, effect: "consequential" }] } });
  const args = { tenantId: "tenant-a", orderId: "tenant-a:one" };
  const binding = fingerprint({ subject: identity.subject, agentId: identity.agentId, tenantId: identity.tenantId, tool: tool.name, arguments: args, policyVersion: "v1", definitionHash: grant.definitionHash });
  assert.equal((await fixture.handle(rpcRequest(args))).status, 403);
  fixture.approvals.add(`approval-one:${binding}:${identity.subject}`);
  assert.equal((await fixture.handle(rpcRequest({ ...args, orderId: "tenant-a:two" }, { "x-arq-approval": "approval-one" }))).status, 403);
  const results = await Promise.all([fixture.handle(rpcRequest(args, { "x-arq-approval": "approval-one" })), fixture.handle(rpcRequest(args, { "x-arq-approval": "approval-one" }))]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 403]); assert.equal(fixture.invocations.length, 1);
});

test("gateway JWT verifier rejects wrong audience, issuer, expiry and signatures without forwarding tokens", async () => {
  const { publicKey, privateKey } = await generateKeyPair("ES256"), key = await exportJWK(publicKey); key.kid = "test-key";
  const verify = createJwtIdentityVerifier({ issuer, audience: resource, jwks: { keys: [key] }, algorithms: ["ES256"] });
  const sign = ({ aud = resource, iss = issuer, expires = "5m" } = {}) => new SignJWT({ agent_id: identity.agentId, tenant_id: identity.tenantId, scope: "orders:read" }).setProtectedHeader({ alg: "ES256", kid: "test-key" }).setSubject(identity.subject).setJti(identity.tokenId).setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime(expires).sign(privateKey);
  const request = token => new Request(resource, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await verify(request(await sign()))).subject, identity.subject);
  for (const patch of [{ aud: origin + "/other" }, { iss: "https://foreign.example" }, { expires: Math.floor(Date.now() / 1000) - 30 }]) await assert.rejects(verify(request(await sign(patch))));
  await assert.rejects(verify(request("malformed")));
  const meta = await gatewayFixture().handle(new Request(origin + "/.well-known/oauth-protected-resource/mcp")); assert.equal((await meta.json()).resource, resource);
});
