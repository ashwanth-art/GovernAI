import Ajv2020 from "ajv/dist/2020.js";
import { createLocalJWKSet, jwtVerify } from "jose";
import { randomUUID } from "node:crypto";
import { fingerprint, identifier, safeHttps } from "./contract.mjs";

/** Target-side integration component. ARQ's assessment server never mounts this
 * handler or receives permission to execute a customer's real tools. */
export function createJwtIdentityVerifier({ issuer, audience, jwks, algorithms = ["RS256", "ES256"] }) {
  if (!safeHttps(issuer) || !safeHttps(audience) || !Array.isArray(algorithms) || !algorithms.length || algorithms.some(alg => !["RS256", "ES256", "EdDSA"].includes(alg))) throw new Error("Pin HTTPS issuer/audience, asymmetric algorithms and locally provisioned public keys.");
  const keys = createLocalJWKSet(jwks);
  return async request => {
    const authorization = request.headers.get("authorization") ?? "";
    if (!/^Bearer [^\s]{1,16000}$/.test(authorization)) throw new Error("Bearer authorization required.");
    const { payload } = await jwtVerify(authorization.slice(7), keys, { issuer, audience, algorithms, requiredClaims: ["sub", "exp", "iat", "jti", "agent_id", "tenant_id"], maxTokenAge: "15m", clockTolerance: 5 });
    if (![payload.sub, payload.jti, payload.agent_id, payload.tenant_id].every(identifier) || typeof payload.scope !== "string" || payload.scope.length > 2000) throw new Error("Verified user, agent, tenant, token ID and explicit scopes required.");
    return Object.freeze({ subject: payload.sub, agentId: payload.agent_id, tenantId: payload.tenant_id, tokenId: payload.jti, scopes: Object.freeze(payload.scope.split(" ").filter(Boolean)) });
  };
}

const reply = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
const allowedSchema = value => {
  if (Array.isArray(value)) return value.every(allowedSchema);
  if (!value || typeof value !== "object") return true;
  return Object.entries(value).every(([key, item]) => !["$async", "$data", "pattern", "patternProperties"].includes(key) && (key !== "$ref" || typeof item === "string" && item.startsWith("#")) && allowedSchema(item));
};

/** Required state methods are backed by durable transactional storage in
 * production. No in-memory approval/revocation/budget fallback is supplied. */
export function createAgentGateway({ policy, resource, issuer, verifyIdentity, loadTool, invokeTool, state }) {
  if (!safeHttps(resource) || !safeHttps(issuer)) throw new Error("Pin the gateway resource URL and authorization issuer.");
  const resourceUrl = new URL(resource), metadataUrl = new URL(`/.well-known/oauth-protected-resource${resourceUrl.pathname === "/" ? "" : resourceUrl.pathname}`, resourceUrl.origin).toString();
  if (!policy || !identifier(policy.version) || !Array.isArray(policy.grants) || policy.grants.length > 100 || ![verifyIdentity, loadTool, invokeTool, state?.isRevoked, state?.reserve, state?.consumeApproval, state?.audit].every(fn => typeof fn === "function")) throw new Error("Gateway needs explicit policy, identity verification, trusted tool adapters and durable revocation/budget/approval/audit methods.");
  // Snapshot operator configuration so the model/caller cannot mutate grants.
  policy = structuredClone(policy);
  for (const grant of policy.grants) {
    if (!identifier(grant.tool) || !/^[a-f0-9]{64}$/.test(grant.definitionHash) || !["read", "consequential"].includes(grant.effect) || !["subjects", "agentIds", "tenantIds", "scopes", "resourcePrefixes"].every(field => Array.isArray(grant[field]) && grant[field].length > 0 && grant[field].length <= 50 && grant[field].every(value => typeof value === "string" && value.length > 0 && value.length <= 200 && !value.includes("*"))) || !identifier(grant.tenantArgument) || !identifier(grant.resourceArgument) || !Number.isSafeInteger(grant.callsPerMinute) || grant.callsPerMinute < 1 || grant.callsPerMinute > 100) throw new Error("Each gateway grant needs an exact pinned tool, identities, tenants, scopes, resource prefixes, effect and bounded call budget; wildcards are not accepted.");
    if (grant.tenantIds.length !== 1 || !grant.resourcePrefixes.every(prefix => prefix.startsWith(`${grant.tenantIds[0]}:`))) throw new Error("Each grant must bind one tenant and tenant-qualified resource prefixes; adapters must still enforce object ownership.");
  }
  if (new Set(policy.grants.map(grant => `${grant.tool}:${grant.tenantIds[0]}`)).size !== policy.grants.length) throw new Error("Gateway policy must contain at most one grant per tool and tenant.");
  const ajv = new Ajv2020({ strict: true, allErrors: false, validateFormats: false, addUsedSchema: false });
  return async function handle(request) {
    const traceId = randomUUID(); let identity, toolName, id = null;
    const audit = (decision, reason, detail = {}) => state.audit({ traceId, at: new Date().toISOString(), policyVersion: policy.version, subject: identity?.subject, agentId: identity?.agentId, tenantId: identity?.tenantId, tool: toolName, decision, reason, ...detail });
    const deny = async (reason, status = 403) => { await audit("deny", reason); return reply({ jsonrpc: "2.0", id, error: { code: -32003, message: reason }, traceId }, status); };
    try {
      if (policy.enabled !== true) return await deny("Agent gateway disabled by operator policy.", 503);
      const location = new URL(request.url);
      if (location.origin !== resourceUrl.origin) return await deny("Unapproved gateway origin.");
      if (request.method === "GET" && location.toString() === metadataUrl) return reply({ resource, authorization_servers: [issuer] });
      if (location.toString() !== resource) return await deny("Unapproved gateway resource.", 404);
      const origin = request.headers.get("origin");
      if (origin && !(policy.allowedBrowserOrigins ?? []).includes(origin)) return await deny("Browser origin is not explicitly allowed.");
      if (request.method !== "POST") return await deny("Only approved MCP POST messages are supported.", 405);
      identity = await verifyIdentity(request);
      if (!identity || ![identity.subject, identity.agentId, identity.tenantId, identity.tokenId].every(identifier) || !Array.isArray(identity.scopes)) return await deny("Verified identity is incomplete.", 401);
      if (await state.isRevoked(identity)) return await deny("Identity, agent or token has been revoked.");
      if (!await state.reserve({ ...identity, tool: "_mcp_protocol_", limit: 60 })) return await deny("MCP request budget exhausted.", 429);
      if (!/application\/json/i.test(request.headers.get("content-type") ?? "")) return await deny("JSON request required.", 415);
      if (Number(request.headers.get("content-length") || 0) > 16384 || !request.body) return await deny("Request exceeds input budget.", 413);
      const reader = request.body.getReader(), chunks = []; let size = 0;
      while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 16384) { await reader.cancel(); return await deny("Request exceeds input budget.", 413); } chunks.push(Buffer.from(part.value)); }
      const message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (message?.jsonrpc !== "2.0" || Array.isArray(message) || !["initialize", "notifications/initialized", "tools/list", "tools/call"].includes(message.method)) return await deny("Unsupported MCP message.", 400);
      if (message.method !== "notifications/initialized" && !(typeof message.id === "string" && message.id.length <= 100 || Number.isSafeInteger(message.id))) return await deny("An explicit request ID is required.", 400);
      id = message.id ?? null;
      const grants = policy.grants.filter(grant => grant.subjects.includes(identity.subject) && grant.agentIds.includes(identity.agentId) && grant.tenantIds.includes(identity.tenantId) && grant.scopes.every(scope => identity.scopes.includes(scope)));
      if (!grants.length) return await deny("No explicit tool grant for this user, agent, tenant and scope.");
      if (message.method === "initialize") { await audit("allow", "Initialize authenticated stateless MCP connection."); return reply({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-11-25", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "arq-policy-gateway", version: policy.version } } }); }
      if (message.method === "notifications/initialized") { await audit("allow", "Authenticated initialization notification."); return new Response(null, { status: 202 }); }
      if (message.method === "tools/list") {
        const tools = [];
        for (const grant of grants) { const tool = await loadTool(grant.tool); if (!tool || fingerprint(tool) !== grant.definitionHash) return await deny("Approved tool definition changed; operator review required."); tools.push(tool); }
        await audit("allow", "List only explicitly granted tools."); return reply({ jsonrpc: "2.0", id, result: { tools } });
      }
      toolName = identifier(message.params?.name) ? message.params.name : undefined;
      if (!toolName) return await deny("A bounded tool identifier is required.", 400);
      const grant = grants.find(grant => grant.tool === toolName);
      if (!grant) return await deny("Tool is outside the authenticated grant.");
      const tool = await loadTool(toolName);
      if (!tool || fingerprint(tool) !== grant.definitionHash) return await deny("Tool definition pin mismatch.");
      const args = message.params?.arguments;
      if (!args || Array.isArray(args) || typeof args !== "object" || !tool.inputSchema || tool.inputSchema.type !== "object" || tool.inputSchema.additionalProperties !== false || Buffer.byteLength(JSON.stringify(tool.inputSchema)) > 32000 || !allowedSchema(tool.inputSchema)) return await deny("A bounded local object schema without executable/remote references or regex patterns is required.", 400);
      const validate = ajv.compile(tool.inputSchema);
      if (!validate(args)) return await deny("Tool arguments violate the approved input schema.", 400);
      if (args[grant.tenantArgument] !== identity.tenantId || typeof args[grant.resourceArgument] !== "string" || !grant.resourcePrefixes.some(prefix => args[grant.resourceArgument].startsWith(prefix))) return await deny("Tenant or resource boundary rejected.");
      const binding = fingerprint({ subject: identity.subject, agentId: identity.agentId, tenantId: identity.tenantId, tool: toolName, arguments: args, policyVersion: policy.version, definitionHash: grant.definitionHash });
      // Reserve atomically even on a later rejection. Failed attempts must not
      // offer an unlimited bypass of execution/approval attempt budgets.
      if (!await state.reserve({ ...identity, tool: toolName, limit: grant.callsPerMinute })) return await deny("Execution budget exhausted.", 429);
      let approvalId;
      if (grant.effect === "consequential") {
        approvalId = request.headers.get("x-arq-approval");
        if (!identifier(approvalId) || !await state.consumeApproval({ id: approvalId, binding, identity })) return await deny("Matching unexpired independent human approval is required.");
      }
      // Audit durability is a precondition to execution. Recheck revocation
      // immediately before dispatch, including after external approval work.
      if (await state.isRevoked(identity)) return await deny("Authority revoked before dispatch.");
      await audit("allow", "Authorized tool execution.", { binding, approvalId });
      // Only trusted adapter arguments are passed; no inbound token/headers.
      const result = await invokeTool({ name: toolName, arguments: args, identity: { subject: identity.subject, agentId: identity.agentId, tenantId: identity.tenantId }, traceId });
      if (Buffer.byteLength(JSON.stringify(result)) > 300000) throw new Error("Tool output budget exceeded.");
      await audit("completed", "Tool adapter returned.", { binding, approvalId });
      return reply({ jsonrpc: "2.0", id, result, traceId });
    } catch {
      // An audit/storage/auth/schema/adapter outage is never an allow. A target
      // adapter must itself implement idempotency and output/DLP safeguards.
      try { await audit("error", "Authorization, state or tool adapter unavailable; no success claimed."); } catch { /* fail closed */ }
      return reply({ jsonrpc: "2.0", id, error: { code: -32001, message: "Gateway authorization or execution unavailable." }, traceId }, identity ? 503 : 401, identity ? {} : { "WWW-Authenticate": `Bearer resource_metadata="${metadataUrl}"` });
    }
  };
}
