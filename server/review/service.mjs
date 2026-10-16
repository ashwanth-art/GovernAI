import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ReviewStore, digest } from "./store.mjs";
import { validateProfile, redact, resolvePublic } from "./broker.mjs";
import { collectLayers } from "./collectors.mjs";
import { technicalManifest, exportedManifest, reviewWithModels } from "./evaluate.mjs";
import { enterpriseIdentity } from "./identity.mjs";

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value ?? "");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const encoder = new TextEncoder();
async function readJson(request) {
  if (!request.body) throw new Error("Request body is required.");
  const reader = request.body.getReader(); let bytes = 0; const chunks = [];
  while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 300000) { await reader.cancel(); throw new Error("Review input exceeded its size budget."); } chunks.push(Buffer.from(value)); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function sessionIdentity(request, key) {
  const sign = id => createHmac("sha256", key).update(id).digest("hex");
  const supplied = (request.headers.get("cookie") ?? "").split(";").map(item => item.trim()).find(item => item.startsWith("arq_review_session="))?.split("=")[1];
  let id, fresh = false;
  if (supplied) {
    const [value, signature] = supplied.split(".");
    const expected = sign(value ?? "");
    if (/^[a-f0-9]{64}$/.test(value ?? "") && /^[a-f0-9]{64}$/.test(signature ?? "") && timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) id = value;
  }
  if (!id) { id = randomBytes(32).toString("hex"); fresh = true; }
  const secure = new URL(request.url).protocol === "https:";
  return { owner: sign(`owner:${id}`), cookie: fresh ? `arq_review_session=${id}.${sign(id)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure ? "; Secure" : ""}` : null };
}

export function createReviewService({ engineFetch, store: suppliedStore, enabled = Boolean(process.env.REVIEW_DATABASE_URL), sessionKey = process.env.REVIEW_SESSION_KEY } = {}) {
  let store = suppliedStore, ready = false, stopped = false, busy = false, catalog;
  const aborts = new Map();
  const init = (async () => {
    if (!enabled || !sessionKey) return;
    store ??= new ReviewStore();
    await store.init(); ready = true;
  })().catch(() => { console.error("[review] Persistent review service initialization failed; inspect database connectivity and secret references."); });

  async function loadCatalog() {
    if (!catalog) catalog = await (await engineFetch(new Request("http://review.internal/api/review-catalog"))).json();
    return catalog;
  }
  async function validate(input) {
    if (!input || typeof input !== "object") throw new Error("Assessment input must be an object.");
    const validation = await engineFetch(new Request("http://review.internal/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ standardIds: input.standardIds, tier: input.tier, access: {} }) }));
    if (!validation.ok) throw new Error("Select valid standards and access depth before starting a review.");
    const target = new URL(input.credentials?.chatbotEndpoint);
    if (!["https:", "http:"].includes(target.protocol) || target.username || target.password) throw new Error("Review target must be an HTTP(S) URL without embedded credentials.");
    if (process.env.NODE_ENV === "production" && target.protocol !== "https:") throw new Error("Production review targets require HTTPS.");
    // The legacy engine also performs endpoint reads. Reject private locations
    // before dispatch, including optional evidence/staging/repository inputs.
    for (const [field, value] of Object.entries(input.credentials ?? {})) {
      if (typeof value === "string" && /(?:Url|Endpoint)$/.test(field) && value.trim()) {
        const url = new URL(value);
        if (url.username || url.password || !["https:", "http:"].includes(url.protocol)) throw new Error("Evidence locations must be HTTP(S) URLs without embedded credentials.");
        await resolvePublic(url.hostname);
      }
    }
    if (![1, 2, 3].includes(input.tier) || !input.organization?.trim() || !input.systemName?.trim()) throw new Error("System, organization and tier are required.");
    if (!input.architecture || typeof input.credentials !== "object") throw new Error("Application connection information is missing.");
    return input;
  }
  async function evaluate(job, signal) {
    const input = job.input;
    const ownerProfiles = await store.profiles(job.owner, true);
    const profiles = ownerProfiles.filter(profile => profile.targetOrigin === new URL(input.credentials.chatbotEndpoint).origin);
    const { standards } = await loadCatalog();
    const selected = standards.filter(standard => input.standardIds.includes(standard.id));
    const controls = selected.flatMap(standard => standard.controls.map(control => ({ ...control, standardId: standard.id, packRelease: standard.pack?.release })));
    const evidence = [];
    const save = async value => { const saved = await store.evidence(job, redact(value)); evidence.push(saved); return saved; };
    const progress = message => store.stage(job.id, message);
    await progress("Discovering application assets and required control evidence");
    const assets = [{ id: `application:${new URL(input.credentials.chatbotEndpoint).origin}`, kind: "application", name: input.systemName }, { id: `domain:${new URL(input.credentials.chatbotEndpoint).hostname}`, kind: "domain", name: new URL(input.credentials.chatbotEndpoint).hostname }];
    const plan = controls.map(control => ({ standardId: control.standardId, controlId: control.id, objective: control.objective ?? control.name, tier: control.tierMinimum, procedures: control.evidenceProcedureIds ?? [], rule: control.evaluationRuleId ?? "legacy-proxy", sourceCitation: control.sourceCitation, packRelease: control.packRelease }));
    const collection = await collectLayers({ input, profiles: input.tier >= 2 ? profiles : [], save, audit: store.audit.bind(store), owner: job.owner, jobId: job.id, signal, progress });
    // One bounded retry for transient collection failure. Access denials and
    // absent profiles are recorded as gaps, not repeatedly requested.
    const transient = evidence.some(record => record.observations?.some(observation => /timed out/i.test(observation.summary)));
    if (transient && !signal.aborted) {
      await progress("Investigating transient evidence gaps with one bounded retry");
      await collectLayers({ input: { ...input, tier: 1 }, profiles: [], save, audit: store.audit.bind(store), owner: job.owner, jobId: job.id, signal, progress });
    }
    const model = await reviewWithModels({ controls, evidence, signal, progress, save });
    const procedures = { ...model.procedures, ...exportedManifest(evidence), ...technicalManifest(evidence) };
    if (signal.aborted) throw new Error("Review cancelled.");
    await progress("Evaluating selected standards against verified evidence");
    const response = await engineFetch(new Request("http://review.internal/api/assessments/stream", {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", "x-arq-review-token": process.env.REVIEW_ENCRYPTION_KEY ?? "" },
      body: JSON.stringify({ ...input, reviewManifest: { schemaVersion: "1.0", generatedAt: new Date().toISOString(), procedures } }),
    }));
    if (!response.ok || !response.body) throw new Error("Assessment engine rejected the review connection settings.");
    const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = "", result;
    while (true) {
      const { value, done } = await reader.read(); pending += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const chunks = pending.split("\n\n"); pending = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const name = chunk.match(/^event:\s*(.+)$/m)?.[1];
        const text = chunk.match(/^data:\s*(.+)$/m)?.[1]; if (!name || !text) continue;
        const data = JSON.parse(text);
        if (signal.aborted) { await reader.cancel(); throw new Error("Review cancelled."); }
        if (name === "assessment_complete") result = data;
        else if (name === "assessment_error") throw new Error(data.message || "Assessment engine failed.");
        else await store.emit(job.id, name, data);
      }
      if (done) break;
    }
    if (!result) throw new Error("Assessment stream ended without a final result.");
    const all = [...result.reports.flatMap(report => report.controls), ...result.owasp];
    const observed = all.filter(control => ["pass", "fail", "partial"].includes(control.status));
    const unresolved = all.filter(control => control.status === "not_assessed").map(control => ({ controlId: control.id, name: control.name, procedures: control.evidenceProcedureIds ?? [], reason: control.evidence }));
    result.review = {
      jobId: job.id, mode: "durable", rounds: transient ? 2 : 1, toolCalls: collection.toolCalls,
      assets: [...new Map([...assets, ...evidence.flatMap(record => record.assets ?? [])].map(asset => [asset.id, asset])).values()],
      edges: [{ from: assets[0].id, to: assets[1].id, relation: "served_at" }, ...evidence.flatMap(record => record.edges ?? [])],
      layers: [...new Set(evidence.map(record => record.layer))].map(layer => ({ layer, evidenceCount: evidence.filter(record => record.layer === layer).length, failedObservations: evidence.filter(record => record.layer === layer).flatMap(record => record.observations ?? []).filter(observation => observation.status === "fail").length })),
      evidence: evidence.map(record => ({ id: record.id, layer: record.layer, source: record.source, collectedAt: record.collectedAt, hash: record.hash })),
      controlPlan: plan, unresolved, originalCoverage: { evaluated: observed.length, total: all.length, percent: all.length ? Math.round(observed.length / all.length * 100) : 0 },
      modelReviews: model.reviews, connectionCount: profiles.length, connectionsNotConfigured: ["azure", "aws", "auth", "documents", "banking_export"].filter(kind => !profiles.some(profile => profile.kind === kind)),
      integrity: digest(evidence.map(record => ({ id: record.id, hash: record.hash }))),
    };
    await progress("Persisting evidence, review history and control outcomes");
    return result;
  }
  async function tick() {
    if (!ready || stopped || busy) return;
    busy = true;
    try {
      await store.enqueueDue();
      const job = await store.claim(); if (!job) return;
      const controller = new AbortController(); aborts.set(job.id, controller);
      let timedOut = false;
      const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, 600000);
      const heartbeat = setInterval(async () => { try { if (!await store.heartbeat(job.id, job.lease)) controller.abort(); } catch { controller.abort(); } }, 20000);
      try {
        await store.audit(job.owner, "review.started", job.id, { attempt: job.attempts });
        const result = await evaluate(job, controller.signal);
        if (!controller.signal.aborted) {
          const completed = await store.finish(job.id, job.lease, result);
          if (completed.rowCount) { await store.emit(job.id, "assessment_complete", result); await store.audit(job.owner, "review.completed", job.id, { evidence: result.review.evidence.length }); }
        }
      } catch (error) {
        if (!controller.signal.aborted || timedOut) {
          const message = timedOut ? "The review exceeded its ten-minute execution budget. Partial evidence is retained; no final compliance verdict was issued." : String(redact(error.message)).slice(0, 500);
          await store.finish(job.id, job.lease, null, message);
          await store.emit(job.id, "assessment_error", { message, errorCode: "REVIEW_FAILED" });
        }
      } finally { clearTimeout(deadline); clearInterval(heartbeat); aborts.delete(job.id); }
    } catch { console.error("[review] Worker iteration failed; queued work remains durable for retry."); }
    finally { busy = false; }
  }
  const timer = setInterval(() => void tick(), 2000); timer.unref();
  init.then(() => void tick());
  async function route(request) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith("/api/reviews")) return null;
    await init;
    if (path === "/api/reviews/health") return json({ enabled, ready, durable: ready, worker: "postgres-leased", evidenceStorage: Boolean(store?.blobs), authentication: process.env.REVIEW_OIDC_ISSUER ? "oidc" : "isolated-demo-session", modelConfigured: Boolean(process.env.OPENAI_API_KEY), modes: ["rules", "small-model", "complex-model"] }, ready ? 200 : 503);
    if (!ready) return json({ errors: ["The persistent review service is not configured or is starting. Use the existing assessment runner until it is ready."] }, 503);
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return json({ errors: ["Cross-origin review requests are not permitted."] }, 403);
    let enterprise;
    try { enterprise = await enterpriseIdentity(request); } catch (error) { return json({ errors: [error.message] }, 401); }
    const session = sessionIdentity(request, sessionKey), owner = enterprise ? createHmac("sha256", sessionKey).update(enterprise.subject).digest("hex") : session.owner;
    const headers = session.cookie ? { "Set-Cookie": session.cookie } : {};
    try {
      if (path === "/api/reviews/connections") {
        if (request.method === "GET") return json({ connections: await store.profiles(owner) }, 200, headers);
        if (request.method === "POST") { if ((await store.profiles(owner)).length >= 10) throw new Error("A workspace supports at most ten scoped connections."); const profile = validateProfile(await readJson(request)); return json({ id: await store.saveProfile(owner, profile) }, 201, headers); }
      }
      const profileId = path.match(/^\/api\/reviews\/connections\/([\w-]+)$/)?.[1];
      if (profileId && uuid(profileId) && request.method === "DELETE") { await store.deleteProfile(owner, profileId); return json({ removed: true }, 200, headers); }
      if (path === "/api/reviews/schedules") {
        if (request.method === "GET") return json({ schedules: await store.schedules(owner) }, 200, headers);
        if (request.method === "POST") {
          const body = await readJson(request), input = await validate(body.input), interval = Number(body.intervalSeconds);
          if (!Number.isInteger(interval) || interval < 900 || interval > 2592000) throw new Error("Schedule interval must be 15 minutes to 30 days.");
          return json({ id: await store.schedule(owner, input, interval) }, 201, headers);
        }
      }
      const scheduleId = path.match(/^\/api\/reviews\/schedules\/([\w-]+)$/)?.[1];
      if (scheduleId && uuid(scheduleId) && request.method === "DELETE") { await store.disableSchedule(owner, scheduleId); return json({ disabled: true }, 200, headers); }
      if (path === "/api/reviews") {
        if (request.method === "GET") return json({ jobs: await store.list(owner) }, 200, headers);
        if (request.method === "POST") {
          const input = await validate(await readJson(request));
          const active = (await store.list(owner)).filter(job => ["queued", "running"].includes(job.status));
          if (active.length >= 3) return json({ errors: ["Three reviews are already queued or running in this session."] }, 429, headers);
          const recent = (await store.list(owner)).filter(job => Date.now() - Date.parse(job.created_at) < 3600000);
          if (recent.length >= 12) return json({ errors: ["Hourly review limit reached for this identity."] }, 429, headers);
          const id = await store.submit(owner, input); void tick(); return json({ id, status: "queued", eventsUrl: `/api/reviews/${id}/events` }, 202, headers);
        }
      }
      const match = path.match(/^\/api\/reviews\/([\w-]+)(?:\/(events|evidence|cancel))?$/);
      if (!match || !uuid(match[1])) return json({ errors: ["Review endpoint not found."] }, 404, headers);
      const [, id, action] = match;
      const job = await store.get(owner, id, !action);
      if (!job) return json({ errors: ["Review not found in this session."] }, 404, headers);
      if (action === "cancel" && request.method === "POST") { await store.cancel(owner, id); aborts.get(id)?.abort(); return json({ cancelled: true }, 200, headers); }
      if (action === "evidence" && request.method === "GET") return json({ evidence: await store.readEvidence(owner, id) }, 200, headers);
      if (!action && request.method === "GET") return json(job, 200, headers);
      if (action === "events" && request.method === "GET") {
        let after = Math.max(0, Number(new URL(request.url).searchParams.get("after") ?? request.headers.get("last-event-id") ?? 0));
        if (!Number.isSafeInteger(after)) return json({ errors: ["Invalid event cursor."] }, 400, headers);
        let closed = false;
        const stream = new ReadableStream({
          async start(controller) {
            const send = (name, data, sequence) => { if (!closed) controller.enqueue(encoder.encode(`${sequence ? `id: ${sequence}\n` : ""}event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)); };
            try {
              for (let poll = 0; poll < 300 && !closed && !request.signal.aborted; poll++) {
                const events = await store.events(id, after);
                for (const item of events) { send(item.name, item.data, item.sequence); after = item.sequence; }
                const status = await store.get(owner, id);
                if (["completed", "failed", "cancelled"].includes(status?.status)) {
                  // Finish may commit just before its terminal event. Fetch once
                  // more or return the persisted result to close that race.
                  const remaining = await store.events(id, after);
                  for (const item of remaining) { send(item.name, item.data, item.sequence); after = item.sequence; }
                  if (!events.concat(remaining).some(item => item.name === "assessment_complete") && status.status === "completed") send("assessment_complete", (await store.get(owner, id, true)).result);
                  if (status.status === "failed" && !events.concat(remaining).some(item => item.name === "assessment_error")) send("assessment_error", { message: status.error, errorCode: "REVIEW_FAILED" });
                  if (status.status === "cancelled") send("review_cancelled", { message: "Review cancelled." });
                  break;
                }
                if (!events.length && poll % 10 === 0) send("review_progress", { message: status?.summary?.stage ?? "Queued", jobId: id });
                await wait(750);
              }
            } catch { if (!closed) send("review_reconnect", { after }); }
            finally { if (!closed) { closed = true; controller.close(); } }
          }, cancel() { closed = true; },
        });
        return new Response(stream, { headers: { ...headers, "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
      }
      return json({ errors: ["Method not supported."] }, 405, headers);
    } catch (error) { return json({ errors: [String(redact(error.message)).slice(0, 500)] }, 400, headers); }
  }
  return { route, init, tick, close: async () => { stopped = true; clearInterval(timer); for (const controller of aborts.values()) controller.abort(); await store?.pool?.end(); } };
}
