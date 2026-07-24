import assert from "node:assert/strict";
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
    chatbotEndpoint: "https://api.example.com/v1/rag/chat",
    chatbotApiKey: "test-only-key",
    cloudProvider: "AWS",
    cloudApiKey: "test-only-cloud-key",
    monitoringProvider: "Datadog",
    monitoringApiKey: "test-only-monitoring-key",
    cicdUrl: "https://github.com/example/rag/actions",
  },
  architecture: {
    modelProvider: "Anthropic",
    modelName: "Claude",
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
  assert.doesNotMatch(html, /codex-preview/);
  assert.doesNotMatch(html, /react-loading-skeleton/);
});

test("catalog exposes all industries, standards, and tier-specific fields", async () => {
  const response = await request("/api/catalog");
  assert.equal(response.status, 200);
  const catalog = await response.json();
  assert.equal(catalog.industries.length, 10);
  assert.ok(catalog.standards.length >= 23);
  assert.deepEqual(
    catalog.industries.find((item) => item.id === "healthcare").recommendations.map((item) => item.standardId),
    ["hipaa", "iso42001", "nist_ai_rmf"],
  );
  assert.equal(catalog.credentialFields["1"].length, 2);
  assert.equal(catalog.credentialFields["2"].length, 7);
  assert.equal(catalog.credentialFields["3"].length, 10);
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
  assert.ok(body.errors.some((error) => error.includes("between 1 and 3")));
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
  assert.equal(result.owasp.length, 8);
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

test("single-standard assessment omits cross-standard report and respects Tier 1 coverage", async () => {
  const input = {
    ...baseInput,
    standardIds: ["hipaa"],
    tier: 1,
    credentials: {
      chatbotEndpoint: "https://api.example.com/v1/rag/chat",
      chatbotApiKey: "test-only-key",
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
  assert.equal(result.owasp.length, 8);
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
  assert.match(stream, /event: standard_start/);
  assert.match(stream, /event: control_result/);
  assert.match(stream, /event: standard_complete/);
  assert.match(stream, /event: owasp_complete/);
  assert.match(stream, /event: assessment_complete/);
  assert.match(stream, /"standardId":"hipaa"/);
  assert.doesNotMatch(stream, /iso42001/);
});

