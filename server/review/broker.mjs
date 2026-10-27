import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import https from "node:https";
import http from "node:http";
import { validateAgentProfile } from "./agent-mcp.mjs";

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !/password|secret|token|authorization|cookie|api.?key|connection.?string/i.test(key)).map(([key, item]) => [key, redact(item)]));
  return typeof value === "string" ? value
    .replace(/Bearer\s+[\w.\-]+/gi, "Bearer [redacted]")
    .replace(/\bsk-(?:proj-)?[\w-]{12,}/g, "[redacted]")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[redacted access key]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted JWT]")
    .replace(/-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g, "[redacted private key]")
    .replace(/\b(?:postgres(?:ql)?|mongodb(?:\+srv)?|mysql):\/\/[^\s"']+/gi, "[redacted connection]")
    .replace(/((?:password|passwd|client[_-]?secret|api[_-]?key|access[_-]?key(?:[_-]?id)?|secret[_-]?access[_-]?key)\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, "$1[redacted]")
    .replace(/([?&](?:token|key|secret|sig|code|password)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]") : value;
}

export function privateAddress(ip) {
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return privateAddress(v.slice(7));
  if (isIP(v) === 6) return v === "::" || v === "::1" || /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v) || v.startsWith("2001:db8:");
  const [a, b] = v.split(".").map(Number);
  return !isIP(v) || v === "168.63.129.16" || a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
}

export async function resolvePublic(hostname) {
  const normalized = hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(normalized) ? [{ address: normalized, family: isIP(normalized) }] : await lookup(normalized, { all: true });
  if (!addresses.length || addresses.some(item => privateAddress(item.address))) throw new Error("Private, loopback and metadata destinations are outside review scope.");
  return addresses;
}

export class Broker {
  constructor({ owner, jobId, target, audit, signal }) {
    this.owner = owner; this.jobId = jobId; this.target = new URL(target); this.audit = audit; this.signal = signal;
    this.calls = 0; this.maxCalls = 100;
  }
  async fetch(value, { method = "GET", headers = {}, body, allowedOrigins = [this.target.origin], limit = 300000, timeoutMs = 15000, query = false } = {}) {
    if (++this.calls > this.maxCalls) throw new Error("Review tool-call budget exhausted.");
    const url = new URL(value);
    if (url.username || url.password || !allowedOrigins.includes(url.origin) || !["https:", "http:"].includes(url.protocol)) throw new Error("Destination outside the configured connection scope.");
    if (url.protocol !== "https:" && process.env.NODE_ENV === "production") throw new Error("Production review connections require HTTPS.");
    if (!["GET", "HEAD"].includes(method) && !(method === "POST" && query)) throw new Error("Tool operation is not an approved read/query.");
    const addresses = await resolvePublic(url.hostname);
    if (this.signal?.aborted) throw new Error("Review cancelled.");
    const source = `${url.origin}${url.pathname}`;
    await this.audit(this.owner, "tool.read", this.jobId, { source, method });
    return new Promise((resolve, reject) => {
      let deadline;
      const transport = url.protocol === "https:" ? https : http;
      const request = transport.request(url, {
        method, headers: { "User-Agent": "ARQ-Governance-ReadOnly-Reviewer/1.0", ...headers },
        signal: this.signal, timeout: timeoutMs,
        lookup: (_hostname, options, callback) => {
          const address = addresses.find(item => !options.family || item.family === options.family) ?? addresses[0];
          if (options.all) callback(null, [address]); else callback(null, address.address, address.family);
        },
      }, response => {
        const chunks = []; let length = 0;
        response.on("data", chunk => { length += chunk.length; if (length > limit) { request.destroy(new Error("Evidence response exceeded its size budget.")); } else chunks.push(chunk); });
        response.on("end", () => {
          clearTimeout(deadline);
          const buffer = Buffer.concat(chunks), text = buffer.toString("utf8"); let json;
          try { json = JSON.parse(text); } catch { /* HTML and text are valid evidence. */ }
          resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, headers: response.headers, text, buffer, json, source, collectedAt: new Date().toISOString() });
        });
      });
      deadline = setTimeout(() => request.destroy(new Error("Evidence read timed out.")), timeoutMs);
      request.on("timeout", () => request.destroy(new Error("Evidence read timed out.")));
      request.on("error", error => { clearTimeout(deadline); reject(error); }); if (body) request.write(body); request.end();
    });
  }
  async azureToken(profile, scope = "https://management.azure.com/.default") {
    if (!["https://management.azure.com/.default", "https://graph.microsoft.com/.default"].includes(scope)) throw new Error("Unsupported Azure token audience.");
    const { tenantId, clientId, clientSecret } = profile.config;
    if (!tenantId || !clientId || !clientSecret) throw new Error("Azure service principal credentials are incomplete.");
    if (!/^[a-f0-9-]{36}$/i.test(tenantId)) throw new Error("Invalid Azure tenant ID.");
    const response = await this.fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: "POST", query: true, allowedOrigins: ["https://login.microsoftonline.com"],
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, scope }).toString(),
    });
    if (!response.json?.access_token) throw new Error("Azure read-only connection authorization failed.");
    return response.json.access_token;
  }
}

export function validateProfile(value) {
  const kinds = ["azure", "aws", "entra", "security_export", "agent_mcp", "github", "observability", "auth", "documents", "banking_export"];
  if (!value || !kinds.includes(value.kind) || typeof value.name !== "string" || !value.name.trim() || !value.config || typeof value.config !== "object" || Array.isArray(value.config)) throw new Error("A connection needs a name, supported kind, target origin and configuration object.");
  const target = new URL(value.targetOrigin);
  if (value.kind === "agent_mcp") validateAgentProfile(value.config);
  if (target.protocol !== "https:" || target.username || target.password) throw new Error("Connection target must be an HTTPS origin.");
  if (value.kind === "azure" && (!/^[\w-]{36}$/.test(value.config.subscriptionId ?? "") || !/^[\w.()-]{1,90}$/.test(value.config.resourceGroup ?? ""))) throw new Error("Azure connections require a subscription ID and one resource group.");
  if (value.kind === "aws" && (!/^\d{12}$/.test(value.config.accountId ?? "") || !Array.isArray(value.config.regions) || !value.config.regions.length || value.config.regions.length > 5 || !value.config.regions.every(region => /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(region)))) throw new Error("AWS connections require an account ID and one to five explicit regions.");
  if (value.kind === "entra" && (!/^[a-f0-9-]{36}$/i.test(value.config.tenantId ?? "") || !Array.isArray(value.config.principalIds) || !value.config.principalIds.length || value.config.principalIds.length > 10 || !value.config.principalIds.every(id => /^[a-f0-9-]{36}$/i.test(id)))) throw new Error("Entra needs an explicit tenant and one to ten principal object IDs; no tenant-wide discovery is assumed.");
  if (value.kind === "entra") {
    for (const key of ["requiredConditionalAccessPolicyIds", "privilegedRoleDefinitionIds"]) if (value.config[key] !== undefined && (!Array.isArray(value.config[key]) || value.config[key].length > 10 || !value.config[key].every(id => /^[a-f0-9-]{36}$/i.test(id)))) throw new Error("Entra policy/role scope must contain at most ten explicit object IDs.");
    if (value.config.requireTimeBoundRoles === true && !value.config.privilegedRoleDefinitionIds?.length) throw new Error("Time-bound role evaluation needs explicit privileged role definition IDs.");
  }
  if (value.kind === "aws" && value.config.includeIdentityAudit === true && (!Array.isArray(value.config.iamUserNames) || !value.config.iamUserNames.length || value.config.iamUserNames.length > 25 || !value.config.iamUserNames.every(name => /^[\w+=,.@-]{1,64}$/.test(name)))) throw new Error("AWS identity auditing requires one to twenty-five explicit IAM user names.");
  if (value.kind === "aws" && value.config.accessAnalyzerArn && !value.config.regions.some(region => value.config.accessAnalyzerArn.startsWith(`arn:aws:access-analyzer:${region}:${value.config.accountId}:analyzer/`) && /^arn:aws:access-analyzer:[\w-]+:\d{12}:analyzer\/[\w-]{1,255}$/.test(value.config.accessAnalyzerArn))) throw new Error("Access Analyzer must be in the configured AWS account and an explicitly selected region.");
  for (const key of ["maximumCredentialAgeDays", "maximumCredentialIdleDays"]) if (value.config[key] !== undefined && (!Number.isSafeInteger(value.config[key]) || value.config[key] < 1 || value.config[key] > 3650)) throw new Error("Credential policy thresholds must be explicit positive day counts, at most 3650.");
  if (["documents", "banking_export", "observability", "auth", "security_export"].includes(value.kind)) {
    const source = new URL(value.config.url);
    if (source.protocol !== "https:" || source.username || source.password) throw new Error("Export/document URLs must be HTTPS without embedded credentials.");
  }
  if (value.kind === "auth") {
    if (new URL(value.config.url).origin !== target.origin) throw new Error("Authentication endpoints must be on the target origin.");
    if (value.config.forbiddenUrl && new URL(value.config.forbiddenUrl).origin !== target.origin) throw new Error("Forbidden resource must be on the target origin.");
    if (value.config.tests !== undefined) {
      const identities = value.config.identities;
      if (!Array.isArray(identities) || !identities.length || identities.length > 6 || !identities.every(item => typeof item.id === "string" && /^[\w-]{1,64}$/.test(item.id) && typeof item.token === "string" && item.token.length > 0 && item.token.length <= 16000 && !/[\r\n]/.test(item.token)) || new Set(identities.map(item => item.id)).size !== identities.length) throw new Error("Authorization matrix requires one to six uniquely named test identities.");
      if (!Array.isArray(value.config.tests) || !value.config.tests.length || value.config.tests.length > 20 || !value.config.tests.every(test => {
        try { const url = new URL(test.url); return url.protocol === "https:" && url.origin === target.origin && !url.username && !url.password && !url.search && !url.hash && identities.some(identity => identity.id === test.identityId) && ["allow", "deny"].includes(test.expect); } catch { return false; }
      }) || !identities.every(identity => value.config.tests.some(test => test.identityId === identity.id && test.expect === "allow"))) throw new Error("Matrix needs up to twenty same-origin HTTPS GET tests without queries, an allow baseline per identity, and explicit allow/deny expectations.");
    }
  }
  if (value.kind === "github" && !/^[\w.-]+\/[\w.-]+$/.test(value.config.repository ?? "")) throw new Error("GitHub connections need owner/repository.");
  return { ...value, name: value.name.trim().slice(0, 100), targetOrigin: target.origin };
}
