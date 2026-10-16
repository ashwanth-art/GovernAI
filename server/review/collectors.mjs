import { resolve4, resolve6, resolveCname } from "node:dns/promises";
import { connect } from "node:tls";
import { Broker, redact, resolvePublic } from "./broker.mjs";

const now = () => new Date().toISOString();
const check = (id, status, summary, detail = {}) => ({ id, status, summary, ...detail });
const record = (layer, source, observations, detail = {}) => ({ layer, source, collectedAt: now(), observations, ...detail });
const settled = async operation => { try { return await operation(); } catch { return []; } };
const readStatus = response => response.status === 401 || response.status === 403 ? "not_assessed" : response.ok ? "pass" : "not_assessed";

export async function collectPublic(context) {
  const { broker, target } = context;
  const [a, aaaa, cname] = await Promise.all([settled(() => resolve4(target.hostname)), settled(() => resolve6(target.hostname)), settled(() => resolveCname(target.hostname))]);
  await context.save(record("dns", `dns://${target.hostname}`, [check("dns-resolution", a.length + aaaa.length ? "pass" : "not_assessed", `${a.length} IPv4 and ${aaaa.length} IPv6 answers; ${cname.length} CNAME answers.`, { addresses: [...a, ...aaaa], cname })], {
    assets: [...a, ...aaaa].map(ip => ({ id: `ip:${ip}`, kind: "address", name: ip })),
    edges: [...a, ...aaaa].map(ip => ({ from: `domain:${target.hostname}`, to: `ip:${ip}`, relation: "resolves_to" })),
  }));
  if (target.protocol === "https:") {
    try {
      const addresses = await resolvePublic(target.hostname);
      const certificate = await new Promise((resolve, reject) => {
        const socket = connect({ host: addresses[0].address, port: Number(target.port) || 443, servername: target.hostname, rejectUnauthorized: true }, () => {
          const cert = socket.getPeerCertificate();
          resolve({ authorized: socket.authorized, protocol: socket.getProtocol(), validFrom: cert.valid_from, validTo: cert.valid_to, fingerprint: cert.fingerprint256, issuer: cert.issuer?.O, subjectAltName: cert.subjectaltname }); socket.end();
        });
        socket.setTimeout(10000, () => socket.destroy(new Error("TLS observation timed out"))); socket.on("error", reject);
      });
      const supported = ["TLSv1.2", "TLSv1.3"].includes(certificate.protocol);
      await context.save(record("tls", target.origin, [check("tls-valid", "pass", "Certificate chain and hostname verified during a TLS handshake.", certificate), check("tls-modern", supported ? "pass" : "fail", `Negotiated ${certificate.protocol}.`)]));
    } catch (error) {
      const status = /CERT_|certificate|hostname/i.test(String(error)) ? "fail" : "not_assessed";
      await context.save(record("tls", target.origin, [check("tls-valid", status, status === "fail" ? "TLS certificate verification failed." : "TLS evidence unavailable; no successful certificate observation.")]));
    }
  }
  const front = await broker.fetch(target.toString());
  const headers = front.headers;
  const contentType = String(headers["content-type"] ?? "");
  const browserPage = front.ok && /text\/html/i.test(contentType);
  const observations = [check("frontend-reachable", front.ok ? "pass" : "not_assessed", `Frontend returned HTTP ${front.status}.`)];
  if (browserPage) {
    observations.push(
      check("frontend-csp", headers["content-security-policy"] ? "pass" : "fail", headers["content-security-policy"] ? "An enforcing Content-Security-Policy header is present; directive effectiveness requires further review." : "The HTML response has no enforcing Content-Security-Policy header."),
      check("frontend-nosniff", String(headers["x-content-type-options"]).toLowerCase() === "nosniff" ? "pass" : "fail", "Checks X-Content-Type-Options on the frontend response."),
      check("frontend-framing", /frame-ancestors/i.test(String(headers["content-security-policy"] ?? "")) || /^(deny|sameorigin)$/i.test(String(headers["x-frame-options"] ?? "")) ? "pass" : "fail", "Checks whether the frontend declares a frame-embedding restriction."),
      check("frontend-hsts", target.protocol === "https:" && /max-age=[1-9]\d*/i.test(String(headers["strict-transport-security"] ?? "")) ? "pass" : "fail", "Checks whether the HTTPS response declares an HSTS lifetime."),
    );
  }
  const cookieFlags = (headers["set-cookie"] ?? []).map(cookie => ({ secure: /;\s*secure(?:;|$)/i.test(cookie), httpOnly: /;\s*httponly(?:;|$)/i.test(cookie), sameSite: /;\s*samesite=(?:lax|strict|none)/i.test(cookie) }));
  if (cookieFlags.length) observations.push(check("session-cookie-flags", cookieFlags.every(cookie => cookie.secure && cookie.httpOnly && cookie.sameSite) ? "pass" : "partial", "Cookie flags observed on the public response. Authentication-specific session behavior still needs an authenticated test profile.", { cookieFlags }));
  const html = front.text;
  const scriptUrls = [...html.matchAll(/<script\b[^>]*src=["']([^"']+)["']/gi)].map(match => { try { return new URL(match[1], target).origin; } catch { return null; } }).filter(Boolean);
  await context.save(record("frontend", front.source, observations, { contentType, htmlPage: browserPage, scriptOrigins: [...new Set(scriptUrls)], headers: { csp: headers["content-security-policy"], hsts: headers["strict-transport-security"], frameOptions: headers["x-frame-options"], contentTypeOptions: headers["x-content-type-options"] } }));
}

export async function collectBrowser(context, profile) {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: process.env.REVIEW_CHROMIUM_PATH || "/usr/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const browserContext = await browser.newContext({ ignoreHTTPSErrors: false, serviceWorkers: "block", acceptDownloads: false });
  const failed = [], violations = [];
  try {
    // All page requests are scoped, including subresources. Mutations and private
    // destinations are blocked. No credential or cookie values enter evidence.
    await browserContext.route("**/*", async route => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        if (!["GET", "HEAD"].includes(request.method()) || url.origin !== context.target.origin) { violations.push({ origin: url.origin, method: request.method() }); return route.abort(); }
        const response = await context.broker.fetch(url.toString(), { limit: 1500000 });
        const headers = { ...response.headers }; delete headers["content-encoding"]; delete headers["content-length"]; delete headers["transfer-encoding"]; delete headers["set-cookie"];
        await route.fulfill({ status: response.status, headers: Object.fromEntries(Object.entries(headers).filter(([, value]) => typeof value === "string")), body: response.buffer });
      } catch { await route.abort(); }
    });
    const page = await browserContext.newPage();
    page.setDefaultTimeout(10000);
    page.on("pageerror", error => failed.push(String(error.message).slice(0, 180)));
    await page.goto(context.target.toString(), { waitUntil: "domcontentloaded", timeout: 20000 });
    const info = await page.evaluate(() => ({ title: document.title, headings: [...document.querySelectorAll("h1")].map(node => node.textContent?.slice(0, 180)), passwordInputs: document.querySelectorAll('input[type="password"]').length, forms: document.forms.length, localStorageKeys: Object.keys(localStorage).filter(key => /token|auth|session|password/i.test(key)), sessionStorageKeys: Object.keys(sessionStorage).filter(key => /token|auth|session|password/i.test(key)) }));
    await context.save(record("browser", context.target.origin, [check("browser-render", "pass", "A headless browser loaded the frontend DOM.", info), check("browser-runtime", failed.length ? "fail" : "pass", `${failed.length} JavaScript page errors observed during the bounded initial load.`, { errors: failed }), check("browser-storage", info.localStorageKeys.length || info.sessionStorageKeys.length ? "partial" : "pass", "Inspected storage key names for credential-like identifiers; no stored values were collected.")], { blockedRequests: violations.slice(0, 10), profile: profile?.name ?? "Public browser review" }));
  } finally { await browserContext.close(); await browser.close(); }
}

export async function collectAzure(context, profile) {
  const config = profile.config, token = await context.broker.azureToken(profile);
  const base = `https://management.azure.com/subscriptions/${config.subscriptionId}/resourceGroups/${encodeURIComponent(config.resourceGroup)}`;
  const get = path => context.broker.fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` }, allowedOrigins: ["https://management.azure.com"] });
  const response = await get("/resources?api-version=2021-04-01");
  if (!response.ok) { await context.save(record("cloud", base, [check("azure-inventory", "not_assessed", `Azure resource inventory unavailable (HTTP ${response.status}).`)])); return; }
  const resources = response.json?.value ?? [];
  await context.save(record("cloud", base, [check("azure-inventory", "pass", `${resources.length} resources discovered in the explicitly scoped resource group.`)], { assets: resources.map(resource => ({ id: resource.id, kind: resource.type, name: resource.name, region: resource.location })), edges: resources.map(resource => ({ from: `application:${context.target.origin}`, to: resource.id, relation: "declared_connection_scope" })), truncated: Boolean(response.json?.nextLink) }));
  for (const resource of resources.slice(0, 35)) {
    const type = resource.type.toLowerCase();
    const versions = { "microsoft.storage/storageaccounts": "2023-05-01", "microsoft.app/containerapps": "2024-03-01", "microsoft.keyvault/vaults": "2023-07-01", "microsoft.network/networksecuritygroups": "2023-11-01", "microsoft.web/sites": "2023-12-01" };
    if (!versions[type]) continue;
    const read = await context.broker.fetch(`https://management.azure.com${resource.id}?api-version=${versions[type]}`, { headers: { Authorization: `Bearer ${token}` }, allowedOrigins: ["https://management.azure.com"] });
    if (!read.ok) continue;
    const properties = read.json?.properties ?? {}, obs = [];
    if (type === "microsoft.storage/storageaccounts") {
      obs.push(check("azure-storage-https", properties.supportsHttpsTrafficOnly === true ? "pass" : properties.supportsHttpsTrafficOnly === false ? "fail" : "not_assessed", `${resource.name}: HTTPS-only storage setting.`, { assetId: resource.id }));
      obs.push(check("azure-storage-public", properties.allowBlobPublicAccess === false ? "pass" : properties.allowBlobPublicAccess === true ? "fail" : "not_assessed", `${resource.name}: account-level anonymous blob access setting.`, { assetId: resource.id }));
    }
    if (type === "microsoft.keyvault/vaults") obs.push(check("azure-vault-protection", properties.enablePurgeProtection === true ? "pass" : "fail", `${resource.name}: Key Vault purge protection.`, { assetId: resource.id }));
    if (type === "microsoft.app/containerapps") {
      const containers = properties.template?.containers ?? [];
      obs.push(check("azure-runtime-images", containers.length && containers.every(container => /@sha256:/.test(container.image ?? "")) ? "pass" : "fail", `${resource.name}: checks whether deployed container images are pinned by immutable digest.`, { assetId: resource.id, images: containers.map(container => ({ name: container.name, image: container.image })) }));
    }
    const diagnostic = await context.broker.fetch(`https://management.azure.com${resource.id}/providers/microsoft.insights/diagnosticSettings?api-version=2021-05-01-preview`, { headers: { Authorization: `Bearer ${token}` }, allowedOrigins: ["https://management.azure.com"] });
    if (diagnostic.ok) obs.push(check("azure-diagnostics", diagnostic.json?.value?.some(setting => setting.properties?.logs?.some(log => log.enabled)) ? "pass" : "fail", `${resource.name}: enabled diagnostic log export.`, { assetId: resource.id }));
    await context.save(record("cloud", read.source, obs, { assetId: resource.id }));
  }
}

export async function collectGitHubSource(context, profile) {
  const { repository, token } = profile.config;
  const headers = token ? { Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" } : { "X-GitHub-Api-Version": "2022-11-28" };
  const base = `https://api.github.com/repos/${repository}`;
  const read = path => context.broker.fetch(`${base}${path}`, { headers, allowedOrigins: ["https://api.github.com"], limit: 1500000 });
  const metadata = await read("");
  if (!metadata.ok) { await context.save(record("source", base, [check("source-inventory", "not_assessed", `GitHub source unavailable (HTTP ${metadata.status}).`)])); return; }
  const branch = metadata.json.default_branch;
  const tree = await read(`/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  const paths = (tree.json?.tree ?? []).filter(item => item.type === "blob").map(item => item.path);
  const candidates = paths.filter(path => /(^|\/)(Dockerfile|package\.json|requirements\.txt|.*\.tf|.*\.ya?ml|.*\.bicep)$/.test(path) || /^\.github\/workflows\//.test(path)).slice(0, 12);
  const findings = [];
  for (const path of candidates) {
    const file = await read(`/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`);
    if (!file.ok || file.json?.encoding !== "base64" || file.json.size > 150000) continue;
    const text = Buffer.from(file.json.content, "base64").toString("utf8");
    if (/(?:Dockerfile)$/.test(path)) {
      const lastUser = [...text.matchAll(/^USER\s+(\S+)/gm)].at(-1)?.[1];
      findings.push(check("source-container-user", lastUser && !["root", "0", "0:0"].includes(lastUser) ? "pass" : "partial", `${path}: final container USER ${lastUser ? "is declared" : "is not declared; base image defaults need inspection"}.`, { path, commit: file.json.sha }));
    }
    if (/^\.github\/workflows\//.test(path)) findings.push(check("source-workflow-permissions", /permissions:\s*write-all/.test(text) ? "fail" : /permissions:/.test(text) ? "pass" : "partial", `${path}: workflow token-permission declaration inspected.`, { path, commit: file.json.sha }));
    if (/\.tf$/.test(path) && /(?:0\.0\.0\.0\/0|::\/0)/.test(text) && /(?:22|3389)/.test(text)) findings.push(check("source-network-exposure", "partial", `${path}: world-open CIDR and an administrative port occur in the same file; resource-level interpretation is required before concluding exposure.`, { path, commit: file.json.sha }));
  }
  await context.save(record("source", base, [check("source-inventory", "pass", `Source tree read; ${candidates.length} bounded CI/IaC/container files inspected.`, { truncated: Boolean(tree.json?.truncated), inspectedPaths: candidates }), ...findings], { assets: [{ id: `github:${repository}`, kind: "repository", name: repository }], edges: [{ from: `application:${context.target.origin}`, to: `github:${repository}`, relation: "declared_source" }] }));
}

export async function collectExport(context, profile) {
  const url = new URL(profile.config.url);
  const response = await context.broker.fetch(url.toString(), { headers: profile.config.token ? { Authorization: `Bearer ${profile.config.token}` } : {}, allowedOrigins: [url.origin], limit: 500000 });
  const layer = { documents: "governance", auth: "authentication", observability: "monitoring", banking_export: "banking" }[profile.kind];
  const detail = { profileId: profile.id, scope: profile.targetOrigin };
  if (response.ok && profile.kind === "documents") {
    const contentType = String(response.headers["content-type"] ?? "");
    if (!/text\/|json/.test(contentType)) throw new Error("Documents must be exported as UTF-8 text or JSON for evidence review.");
    detail.document = redact(response.text.slice(0, 30000));
    detail.allowModel = profile.config.allowModel === true;
    detail.asOf = profile.config.asOf || response.headers["last-modified"] || null;
  }
  if (response.ok && profile.kind !== "documents") detail.export = redact(response.json);
  const obs = [check(`${profile.kind}-export`, readStatus(response), `Configured ${profile.kind} export returned HTTP ${response.status}. Endpoint availability alone does not establish a control pass.`)];
  await context.save(record(layer, response.source, obs, detail));
}

export async function collectAuthentication(context, profile) {
  const url = new URL(profile.config.url);
  if (url.origin !== context.target.origin) throw new Error("Authentication probes must remain on the assessed application's origin.");
  const anonymous = await context.broker.fetch(url.toString());
  const observations = [check("auth-anonymous-boundary", [401, 403].includes(anonymous.status) ? "pass" : anonymous.ok ? "fail" : "not_assessed", `Explicitly configured protected endpoint returned HTTP ${anonymous.status} without credentials.`)];
  if (profile.config.token) {
    const authenticated = await context.broker.fetch(url.toString(), { headers: { Authorization: `Bearer ${profile.config.token}` } });
    observations.push(check("auth-authenticated-read", authenticated.ok ? "pass" : "not_assessed", `The same endpoint returned HTTP ${authenticated.status} with the configured test identity. Response content was not retained.`));
  }
  if (profile.config.forbiddenUrl && profile.config.token) {
    const forbidden = new URL(profile.config.forbiddenUrl);
    if (forbidden.origin !== context.target.origin) throw new Error("Role-boundary probes cannot leave the application's origin.");
    const response = await context.broker.fetch(forbidden.toString(), { headers: { Authorization: `Bearer ${profile.config.token}` } });
    observations.push(check("auth-role-boundary", [401, 403].includes(response.status) ? "pass" : response.ok ? "fail" : "not_assessed", `Explicitly configured forbidden resource returned HTTP ${response.status} with the configured identity.`));
  }
  await context.save(record("authentication", `${url.origin}${url.pathname}`, observations));
}

export async function collectLayers({ input, profiles, save, audit, owner, jobId, signal, progress }) {
  const target = new URL(input.credentials.chatbotEndpoint);
  const broker = new Broker({ owner, jobId, target: target.toString(), audit, signal });
  const context = { broker, target, save, input };
  const tasks = [
    { layer: "public", run: () => collectPublic(context) },
    ...(input.tier >= 2 ? [{ layer: "browser", run: () => collectBrowser(context) }] : []),
    ...profiles.filter(profile => profile.targetOrigin === target.origin).map(profile => ({ layer: profile.kind, run: async () => {
      if (profile.kind === "azure") return collectAzure(context, profile);
      if (profile.kind === "aws") { const { collectAws } = await import("./collectors-aws.mjs"); return collectAws(context, profile); }
      if (profile.kind === "github") return collectGitHubSource(context, profile);
      if (profile.kind === "auth") return collectAuthentication(context, profile);
      return collectExport(context, profile);
    } })),
  ];
  // Browser resource interception and external collectors share the call budget.
  // Batches bound concurrency and allow cancellation between independent layers.
  for (let index = 0; index < tasks.length; index += 3) {
    await Promise.all(tasks.slice(index, index + 3).map(async task => {
      await progress(`Inspecting ${task.layer} evidence`);
      try { await task.run(); }
      catch (error) { await save(record(task.layer, target.origin, [check(`${task.layer}-unavailable`, "not_assessed", String(redact(error.message)).slice(0, 300))])); }
    }));
    if (signal?.aborted) throw new Error("Review cancelled.");
  }
  return { toolCalls: broker.calls };
}
