import { readFileSync } from "node:fs";
import { fingerprint, safeHttps, identifier } from "../agent-security/contract.mjs";

export const agentRules = JSON.parse(readFileSync(new URL("../../lib/agent-mcp-rules.json", import.meta.url), "utf8"));
const fresh = (value, now) => Number.isFinite(Date.parse(value)) && Date.parse(value) <= now + 300000 && now - Date.parse(value) <= 30 * 86400000;
const ruleById = new Map(agentRules.map(rule => [rule.id, rule]));
export function agentExportTemplate(targetOrigin) {
  return { schemaVersion: "1.0", targetOrigin, generatedAt: new Date().toISOString(), scope: { id: "REPLACE-source-scope", complete: false, assetIds: ["REPLACE-agent-or-server-id"] }, measurements: [],
    contract: agentRules.map(rule => ({ ruleId: rule.id, layer: rule.layer, requiredFields: rule.fields, remediation: rule.fix })),
    instructions: "Supply actual fresh measurements with ruleId, assetId, collectedAt, sourceRef (HTTPS without query/credentials), and typed fields. Claimed statuses are ignored. Complete is source-declared, not independent assurance. Use sandbox fixtures for active tests; never real customer data or transactions." };
}
export function evaluateAgentExport(value, targetOrigin, now = Date.now()) {
  if (value?.schemaVersion !== "1.0" || value.targetOrigin !== targetOrigin || !fresh(value.generatedAt, now) || !identifier(value.scope?.id) || typeof value.scope.complete !== "boolean" || !Array.isArray(value.scope.assetIds) || !value.scope.assetIds.length || value.scope.assetIds.length > 100 || !value.scope.assetIds.every(identifier) || new Set(value.scope.assetIds).size !== value.scope.assetIds.length || !Array.isArray(value.measurements) || value.measurements.length > 300) throw new Error("Agent evidence needs schemaVersion 1.0, matching targetOrigin, fresh timestamps and bounded explicit asset scope.");
  const observations = [];
  for (const entry of value.measurements) {
    const rule = ruleById.get(entry?.ruleId);
    if (!rule) throw new Error("Unknown agent/MCP measurement rule.");
    const valid = value.scope.assetIds.includes(entry.assetId) && fresh(entry.collectedAt, now) && safeHttps(entry.sourceRef) && entry.fields && typeof entry.fields === "object" && !Array.isArray(entry.fields);
    const missing = [], failed = [], measurements = [];
    for (const [field, condition] of Object.entries(rule.fields)) {
      const actual = valid ? entry.fields[field] : undefined;
      if (!Number.isSafeInteger(actual) || actual < 0 || condition === "positive" && actual === 0) missing.push(field);
      else {
        measurements.push({ metric: field, value: actual });
        if (condition === "zero" && actual > 0) failed.push(`${field}=${actual}`);
      }
    }
    const status = !valid ? "not_assessed" : failed.length ? "fail" : missing.length || !value.scope.complete ? "not_assessed" : "pass";
    observations.push({ id: rule.id, securityPillar: rule.layer, status, assetId: valid ? entry.assetId : undefined, sourceRef: valid ? entry.sourceRef : undefined, measurements, measuredAt: valid ? entry.collectedAt : undefined, scopeId: value.scope.id,
      summary: `${rule.name}: ${failed.length ? `observed violations: ${failed.join(", ")}` : status === "pass" ? "all required measurements satisfied within source-declared scope" : "no complete fresh measurement"}.${missing.length ? ` Missing/invalid or zero tested population: ${missing.join(", ")}.` : ""} Measurements: ${measurements.map(item => `${item.metric}=${item.value}`).join(", ") || "none"}. Connected-tool measurements, not independently attested completeness.` });
  }
  for (const ruleId of new Set(value.measurements.map(entry => entry.ruleId))) {
    if (value.scope.assetIds.some(asset => !value.measurements.some(entry => entry.ruleId === ruleId && entry.assetId === asset))) observations.push({ id: ruleId, securityPillar: ruleById.get(ruleId).layer, status: "not_assessed", summary: "Declared assets are missing measurements for this rule; a passing sample cannot establish scope-wide compliance." });
  }
  return observations;
}

export function validateAgentProfile(config) {
  for (const key of ["token", "exportToken"]) if (config[key] !== undefined && (typeof config[key] !== "string" || config[key].length > 16000 || /[\r\n]/.test(config[key]))) throw new Error("Agent/MCP credentials must be bounded strings without header delimiters.");
  if (!safeHttps(config.url)) throw new Error("Agent evidence URL must be HTTPS without credentials/query/fragment.");
  if (config.mcpUrl && !safeHttps(config.mcpUrl)) throw new Error("MCP URL must be explicitly configured HTTPS.");
  if (config.metadataUrl && (!config.mcpUrl || !safeHttps(config.metadataUrl) || new URL(config.metadataUrl).origin !== new URL(config.mcpUrl).origin || !safeHttps(config.expectedIssuer) || !safeHttps(config.expectedAudience))) throw new Error("Metadata discovery requires same-origin metadata URL and explicit HTTPS expected issuer/audience.");
  if (config.approvedTools !== undefined && (!Array.isArray(config.approvedTools) || config.approvedTools.length > 100 || !config.approvedTools.every(tool => identifier(tool.name) && /^[a-f0-9]{64}$/.test(tool.definitionHash)) || new Set(config.approvedTools.map(tool => tool.name)).size !== config.approvedTools.length)) throw new Error("Approved MCP tools need unique names and operator-reviewed SHA-256 definition pins.");
  if (config.allowActiveProbes === true) {
    if (!config.mcpUrl || config.sandbox?.approved !== true || !identifier(config.sandbox.id) || config.sandbox.fixtureTool !== "arq_security_fixture") throw new Error("Active MCP probes require explicit sandbox approval and the isolated arq_security_fixture tool.");
    if (!Array.isArray(config.identities) || !config.identities.length || config.identities.length > 4 || new Set(config.identities.map(item => item.id)).size !== config.identities.length || !config.identities.every(item => identifier(item.id) && typeof item.token === "string" && item.token.length > 0 && item.token.length < 16000 && !/[\r\n]/.test(item.token))) throw new Error("Configure up to four dedicated sandbox identities.");
    if (!Array.isArray(config.tests) || !config.tests.length || config.tests.length > 12 || new Set(config.tests.map(item => item.id)).size !== config.tests.length || !config.tests.every(test => identifier(test.id) && config.identities.some(identity => identity.id === test.identityId) && ["allow", "deny"].includes(test.expect) && ["fixtureId", "action", "tenantId", "resourceId"].every(key => identifier(test.arguments?.[key])) && Object.keys(test.arguments).every(key => ["fixtureId", "action", "tenantId", "resourceId"].includes(key))) || !config.identities.every(identity => config.tests.some(test => test.identityId === identity.id && test.expect === "allow"))) throw new Error("Sandbox tests need unique IDs, explicit fixture arguments and an allow baseline for each identity.");
  }
  return config;
}

function rpcBody(response, id) {
  let body = response.json;
  if (!body && /text\/event-stream/i.test(String(response.headers?.["content-type"]))) {
    const messages = response.text.split(/\r?\n\r?\n/).map(event => event.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n"));
    for (const text of messages) { try { const candidate = JSON.parse(text); if (candidate.id === id) body = candidate; } catch { /* not a complete response */ } }
  }
  return body?.jsonrpc === "2.0" && body.id === id && !body.error ? body.result : undefined;
}
async function session(context, config, token) {
  const url = config.mcpUrl, headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const send = (body, extra = {}) => context.broker.fetch(url, { method: "POST", query: true, headers: { ...headers, ...extra }, body: JSON.stringify(body), allowedOrigins: [new URL(url).origin], limit: 300000 });
  const initialized = await send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "arq-bounded-review", version: "1.0" } } });
  const info = rpcBody(initialized, 1);
  if (!initialized.ok || !info || info.protocolVersion !== "2025-11-25") return null;
  headers["MCP-Protocol-Version"] = info.protocolVersion;
  const sessionId = initialized.headers?.["mcp-session-id"];
  if (sessionId && (typeof sessionId !== "string" || !/^[\w.-]{1,200}$/.test(sessionId))) return null;
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const notified = await send({ jsonrpc: "2.0", method: "notifications/initialized" });
  if (!notified.ok) return null;
  let nextId = 2;
  return { info, call: async (method, params) => { const id = nextId++, response = await send({ jsonrpc: "2.0", id, method, params }); return { response, result: rpcBody(response, id) }; } };
}

export async function collectAgentMcp(context, profile) {
  const config = validateAgentProfile(profile.config), observations = [];
  const exported = await context.broker.fetch(config.url, { headers: config.exportToken ? { Authorization: `Bearer ${config.exportToken}` } : {}, allowedOrigins: [new URL(config.url).origin], limit: 500000 });
  if (exported.ok) observations.push(...evaluateAgentExport(exported.json, context.target.origin));
  else observations.push({ id: "agent-export-unavailable", status: "not_assessed", summary: `Agent test export unavailable (HTTP ${exported.status}); availability is not a control pass.` });
  await context.save({ layer: "agent_mcp", source: config.url, collectedAt: new Date().toISOString(), observations: observations.splice(0) });
  if (config.metadataUrl) {
    const metadata = await context.broker.fetch(config.metadataUrl, { allowedOrigins: [new URL(config.metadataUrl).origin] });
    const data = metadata.json;
    observations.push({ id: "mcp-metadata", securityPillar: "network", status: !metadata.ok || !data || typeof data.resource !== "string" || !Array.isArray(data.authorization_servers) ? "not_assessed" : data.resource === config.expectedAudience && data.authorization_servers.length === 1 && data.authorization_servers[0] === config.expectedIssuer ? "pass" : "fail", summary: "Compared protected-resource resource/issuer binding against the operator-configured audience and issuer. No discovered URLs were followed; this does not prove actual token validation." });
  }
  if (config.mcpUrl) {
    const connection = await session(context, config, config.token);
    if (connection) {
      const tools = []; let cursor, complete = false;
      for (let page = 0; page < 3; page++) {
        const result = (await connection.call("tools/list", cursor ? { cursor } : {})).result;
        if (!Array.isArray(result?.tools) || result.tools.length > 100) break;
        tools.push(...result.tools); if (tools.length > 100) break;
        cursor = result.nextCursor; if (!cursor) { complete = true; break; }
        if (typeof cursor !== "string" || cursor.length > 1000) break;
      }
      const approved = config.approvedTools ?? [], valid = tools.every(tool => identifier(tool?.name) && tool.inputSchema && typeof tool.inputSchema === "object");
      const changed = valid && approved.length && tools.some(tool => !approved.some(pin => pin.name === tool.name && pin.definitionHash === fingerprint(tool)));
      const duplicate = valid && new Set(tools.map(tool => tool.name)).size !== tools.length;
      const absent = complete && approved.some(pin => !tools.some(tool => tool.name === pin.name));
      observations.push({ id: "mcp-tool-integrity", securityPillar: "application", status: duplicate || changed || absent ? "fail" : complete && valid && approved.length ? "pass" : "not_assessed", summary: `Discovered ${Math.min(tools.length, 100)} tool definitions; compared operator-approved pins over full definitions. Inventory ${complete ? "complete within bounded listing" : "incomplete"}; ${duplicate ? "duplicate names; " : ""}${changed ? "unapproved/changed definitions; " : ""}${absent ? "approved definitions missing; " : ""}annotations alone never authorize invocation. Descriptions and tool responses were not executed or sent to models.` });
    } else observations.push({ id: "mcp-tool-integrity", securityPillar: "application", status: "not_assessed", summary: "MCP initialization/authorization did not complete using the supported 2025-11-25 JSON/Streamable HTTP subset; no tool calls were inferred." });
    if (config.allowActiveProbes === true) {
      const baseline = new Set();
      for (const identity of config.identities) {
        const fixture = await session(context, config, identity.token);
        if (!fixture || fixture.info.serverInfo?.arqSandboxId !== config.sandbox.id || fixture.info.serverInfo?.syntheticOnly !== true) { observations.push({ id: "mcp-authorization-matrix", status: "not_assessed", securityPillar: "application", summary: "The server did not confirm the configured synthetic sandbox; no fixture call was issued." }); continue; }
        const tests = config.tests.filter(test => test.identityId === identity.id).sort((a, b) => (a.expect === "allow" ? 0 : 1) - (b.expect === "allow" ? 0 : 1));
        for (const test of tests) {
          const { response, result } = await fixture.call("tools/call", { name: "arq_security_fixture", arguments: test.arguments });
          const success = response.ok && result?.isError !== true && result?.structuredContent?.fixtureId === test.arguments.fixtureId && result?.structuredContent?.sandboxId === config.sandbox.id && result?.structuredContent?.authorized === true;
          if (test.expect === "allow" && success) baseline.add(identity.id);
          const status = test.expect === "allow" ? success ? "pass" : "not_assessed" : !baseline.has(identity.id) ? "not_assessed" : success ? "fail" : response.status === 403 ? "pass" : "not_assessed";
          observations.push({ id: "mcp-authorization-matrix", securityPillar: "application", status, summary: `Synthetic fixture ${test.id}: expected ${test.expect}, HTTP ${response.status}; working identity baseline ${baseline.has(identity.id) ? "confirmed" : "absent"}. Tested only the explicitly approved fixture harness, not real customer actions. No token or response body retained.` });
        }
      }
    }
  }
  await context.save({ layer: "agent_mcp", source: config.url, collectedAt: new Date().toISOString(), observations });
}
