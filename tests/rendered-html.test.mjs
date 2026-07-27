import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

async function worker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const env = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};
const context = { waitUntil() {}, passThroughOnException() {} };

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const request = input instanceof Request ? new Request(input, init) : new Request(input, init);
  const url = new URL(request.url);
  if (url.hostname === "target.test") {
    if (url.pathname === "/health") {
      return Response.json({
        status: "healthy",
        dependencies: { openai: "configured", mongodb: "healthy" },
      });
    }
    if (url.pathname === "/v1/web-chat") {
      const body = await request.json();
      const prompt = String(body.messages?.[0]?.content ?? "");
      if (/hidden system prompt/i.test(prompt)) {
        return Response.json({ detail: "Adversarial prompt rejected." }, { status: 400 });
      }
      if (/API key|password|connection string/i.test(prompt)) {
        return Response.json({
          answer: "I do not have access to private credentials.",
          sources: [],
          request_id: "req-leakage",
          grounded: false,
        });
      }
      if (/weather in Tokyo/i.test(prompt)) {
        return Response.json({
          answer: "Current weather is not available in the approved knowledge base.",
          sources: [],
          request_id: "req-scope",
          grounded: false,
        });
      }
      return Response.json({
        answer: "The organization provides cloud, data, and AI services.",
        sources: [
          { document: "approved-knowledge.md", chunk: 3, score: 0.91 },
          { document: "approved-knowledge.md", chunk: 8, score: 0.82 },
        ],
        request_id: "req-grounded",
        grounded: true,
      });
    }
    if (url.pathname === "/api/monitoring/summary") {
      return request.headers.get("authorization") === "Bearer test-only-monitoring-key"
        ? Response.json({ status: "operational" })
        : Response.json({ detail: "Unauthorized" }, { status: 401 });
    }
    if (url.pathname === "/api/audit/config") {
      return request.headers.get("authorization") === "Bearer test-only-cloud-key"
        ? Response.json({ audit_logging: true })
        : Response.json({ detail: "Unauthorized" }, { status: 401 });
    }
  }
  if (url.hostname === "ci.target.test") return new Response(null, { status: 204 });
  return nativeFetch(request);
};

async function request(path, init) {
  const app = await worker();
  return app.fetch(new Request(`http://localhost${path}`, init), env, context);
}

const baseInput = {
  organization: "Northstar Health",
  systemName: "Clinical Knowledge Assistant",
  industryId: "healthcare",
  standardIds: ["hipaa", "iso42001", "nist_ai_rmf"],
  tier: 2,
  credentials: {
    chatbotEndpoint: "https://target.test/",
    tenantId: "aci-infotech",
    chatbotApiKey: "test-only-key",
    cloudProvider: "AWS",
    cloudApiKey: "test-only-cloud-key",
    monitoringProvider: "Datadog",
    monitoringApiKey: "test-only-monitoring-key",
    cicdUrl: "https://ci.target.test/actions",
  },
  architecture: {
    modelProvider: "OpenAI",
    modelName: "gpt-4.1",
    vectorDatabase: "Pinecone",
    embeddingModel: "text-embedding-model",
  },
};

test("server-renders the complete assessment workspace", async () => {
  const response = await request("/", { headers: { accept: "text/html" } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /GovernAI/);
  assert.match(html, /Evaluate only what matters/);
  assert.match(html, /Define scope/);
  assert.match(html, /Select standards/);
  assert.match(html, /Live assessment engine/);
  assert.match(html, /ACI Knowledge Assistant/);
  assert.doesNotMatch(html, /Anthropic|Claude/);
  assert.doesNotMatch(html, /codex-preview/);
  assert.doesNotMatch(html, /react-loading-skeleton/);
});

test("client supports unlimited standard selection and printable reports", async () => {
  const assetsDirectory = new URL("../dist/client/assets/", import.meta.url);
  const assets = await readdir(assetsDirectory);
  const workspaceAsset = assets.find(
    (name) => name.startsWith("workspace-") && name.endsWith(".js"),
  );
  assert.ok(workspaceAsset, "Expected the client workspace bundle.");
  const bundle = await readFile(new URL(workspaceAsset, assetsDirectory), "utf8");
  assert.match(bundle, /createObjectURL/);
  assert.match(bundle, /OWASP LLM security appendix/);
  assert.match(bundle, /standards selected/);
  assert.match(bundle, /How to read this trace/);
  assert.match(bundle, /Now running/);
  assert.match(bundle, /Official references for the selected standards/);
  assert.match(bundle, /Official page fetched in this run/);
  assert.match(bundle, /Validation method/);
  assert.match(bundle, /completed steps/);
  assert.match(bundle, /pending steps/);
  assert.match(bundle, /Final execution summary/);
  assert.match(bundle, /Retry assessment/);
  assert.match(bundle, /What ran, where it ran, and what returned/);
  assert.match(bundle, /Official standards pages fetched: No/);
  assert.match(bundle, /Target-host adapters \+ supplied CI\/CD URL/);
  assert.doesNotMatch(bundle, /document\.write/);
  assert.doesNotMatch(bundle, /maximum of 3|between 1 and 3|of 3 selected/i);
  assert.doesNotMatch(bundle, /No answer is precomputed/);
});

test("catalog exposes all industries, standards, and tier-specific fields", async () => {
  const response = await request("/api/catalog");
  assert.equal(response.status, 200);
  const catalog = await response.json();
  assert.equal(catalog.industries.length, 10);
  assert.ok(catalog.standards.length >= 23);
  assert.ok(catalog.standards.every((standard) => standard.officialReference?.url.startsWith("https://")));
  assert.equal(
    catalog.standards.find((standard) => standard.id === "sr_11_7").officialReference.status,
    "superseded",
  );
  assert.deepEqual(
    catalog.industries.find((item) => item.id === "healthcare").recommendations.map((item) => item.standardId),
    ["hipaa", "iso42001", "nist_ai_rmf"],
  );
  assert.equal(catalog.credentialFields["1"].length, 3);
  assert.equal(catalog.credentialFields["2"].length, 8);
  assert.equal(catalog.credentialFields["3"].length, 11);
  assert.equal(
    catalog.credentialFields["1"].find((field) => field.key === "chatbotApiKey").required,
    false,
  );
});

test("backend rejects invalid scope, selection count, non-RAG architecture, and missing tier inputs", async () => {
  const invalid = {
    ...baseInput,
    organization: "",
    standardIds: [],
    tier: 3,
    credentials: { chatbotEndpoint: "http://insecure.example.com" },
    architecture: { ...baseInput.architecture, vectorDatabase: "" },
  };
  const response = await request("/api/assessments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(invalid),
  });
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.ok(body.errors.some((error) => error.includes("Organization")));
  assert.ok(body.errors.some((error) => error.includes("at least one")));
  assert.ok(body.errors.some((error) => error.includes("RAG system")));
  assert.ok(body.errors.some((error) => error.includes("Tier 3")));
  assert.ok(body.errors.some((error) => error.includes("HTTPS")));
});

test("evaluation generates exactly one native report per selected standard plus OWASP and cross insights", async () => {
  const response = await request("/api/assessments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(baseInput),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.reports.map((report) => report.standardId), baseInput.standardIds);
  assert.equal(result.reports.length, 3);
  assert.equal(result.liveEvidence.mode, "live");
  assert.equal(result.liveEvidence.chatEndpoint, "https://target.test/v1/web-chat");
  assert.equal(result.liveEvidence.probes.length, 8);
  assert.equal(result.liveEvidence.probes.filter((probe) => probe.status === "pass").length, 8);
  assert.equal(result.liveEvidence.execution.runner, "GovernAI assessment backend");
  assert.equal(result.liveEvidence.execution.officialStandardsPagesFetched, false);
  assert.ok(result.liveEvidence.probes.every((probe) => probe.endpoint && probe.method && probe.sourceType));
  assert.ok(result.liveEvidence.probes.every((probe) => probe.validationMethod && probe.officialPageFetched === false));
  assert.equal(result.reports[0].officialReference.authority, "U.S. Department of Health and Human Services");
  assert.match(result.reports[0].officialReference.url, /^https:\/\/www\.hhs\.gov\//);
  assert.equal(
    result.liveEvidence.probes.find((probe) => probe.id === "monitoring-evidence").endpoint,
    "https://target.test/api/monitoring/summary",
  );
  assert.equal(
    result.liveEvidence.probes.find((probe) => probe.id === "audit-config-evidence").endpoint,
    "https://target.test/api/audit/config",
  );
  assert.equal(result.liveEvidence.probes.find((probe) => probe.id === "cicd-evidence").method, "HEAD");
  assert.equal(result.owasp.length, 10);
  assert.ok(result.reports.every((report) => report.controls.every((control) => control.sourceCitation?.url)));
  assert.ok(result.liveEvidence.execution.summary.totalSteps > 0);
  assert.equal(
    result.liveEvidence.execution.summary.completedSteps,
    result.liveEvidence.execution.summary.totalSteps,
  );
  assert.ok(result.crossInsights);
  assert.deepEqual(Object.keys(result.pillarScores).sort(), [
    "compliance",
    "data_protection",
    "governance",
    "security",
    "trust",
  ]);
  assert.equal(result.reports[0].reportFormat, undefined);
  assert.match(result.reports[0].nativeSections[1], /Administrative Safeguards/);
  assert.match(result.reports[1].nativeSections[2], /Annex A/);
  assert.match(result.reports[2].nativeSections[1], /Govern/);
  assert.equal(result.reports[0].assessedControls, 10);
  assert.equal(result.reports[0].totalControls, 12);
  assert.equal(
    result.reports[0].controls.filter((control) => control.status === "not_assessed").length,
    2,
  );
});

test("evaluation accepts more than three selected standards", async () => {
  const selectedStandardIds = ["hipaa", "iso42001", "nist_ai_rmf", "soc2", "eu_ai_act"];
  const response = await request("/api/assessments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...baseInput, standardIds: selectedStandardIds }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.reports.map((report) => report.standardId), selectedStandardIds);
  assert.equal(result.reports.length, selectedStandardIds.length);
});

test("single-standard assessment omits cross-standard report and respects Tier 1 coverage", async () => {
  const input = {
    ...baseInput,
    standardIds: ["hipaa"],
    tier: 1,
    credentials: {
      chatbotEndpoint: "https://target.test/",
      tenantId: "aci-infotech",
    },
  };
  const response = await request("/api/assessments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.reports.length, 1);
  assert.equal(result.reports[0].assessedControls, 7);
  assert.equal(result.crossInsights, null);
  assert.equal(result.owasp.length, 10);
  assert.equal(result.liveEvidence.probes.length, 5);
});

test("SSE workflow emits start, control, standard completion, OWASP, and final-report events", async () => {
  const response = await request("/api/assessments/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...baseInput, standardIds: ["hipaa"] }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/event-stream/);
  const stream = await response.text();
  assert.match(stream, /event: assessment_start/);
  assert.match(stream, /event: phase_start/);
  assert.match(stream, /event: probe_complete/);
  assert.match(stream, /event: standard_start/);
  assert.match(stream, /event: control_result/);
  assert.match(stream, /event: standard_complete/);
  assert.match(stream, /event: owasp_complete/);
  assert.match(stream, /event: assessment_complete/);
  assert.match(stream, /"occurredAt":/);
  assert.match(stream, /"sourceType":"target_adapter"/);
  assert.match(stream, /"endpoint":"https:\/\/target\.test\/api\/monitoring\/summary"/);
  assert.match(stream, /"sourceType":"control_mapping"/);
  assert.match(stream, /"officialPageFetched":false/);
  assert.match(stream, /"officialAuthority":"U\.S\. Department of Health and Human Services"/);
  assert.match(stream, /"officialReferenceUrl":"https:\/\/www\.hhs\.gov\//);
  assert.match(stream, /"validationMethod":/);
  assert.match(stream, /"progress":\{"totalSteps":/);
  assert.match(stream, /event: execution_summary/);
  assert.match(stream, /"pendingSteps":0,"percentage":100/);
  assert.match(stream, /"standardId":"hipaa"/);
  assert.doesNotMatch(stream, /iso42001/);
});

test("Tier 3 performs transparent reachability preflight without claiming document review", async () => {
  const response = await request("/api/assessments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...baseInput,
      standardIds: ["hipaa"],
      tier: 3,
      credentials: {
        ...baseInput.credentials,
        repoUrl: "https://ci.target.test/source?token=must-not-be-displayed",
        stagingUrl: "https://ci.target.test/staging",
        modelRegistryUrl: "https://ci.target.test/models",
      },
    }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.liveEvidence.probes.length, 11);
  assert.equal(
    result.liveEvidence.probes.find((probe) => probe.id === "source-repository-evidence").status,
    "partial",
  );
  assert.doesNotMatch(
    result.liveEvidence.probes.find((probe) => probe.id === "source-repository-evidence").endpoint,
    /token=/,
  );
  assert.ok(
    result.reports[0].controls
      .filter((control) => control.tierMinimum === 3)
      .every((control) => control.status === "not_assessed"),
  );
});

test("stream route returns detailed validation errors before execution", async () => {
  const response = await request("/api/assessments/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...baseInput, standardIds: [] }),
  });
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.ok(body.errors.some((error) => /at least one compliance standard/i.test(error)));
});
