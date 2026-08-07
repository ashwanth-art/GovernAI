import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { baseInput, request } from "./harness.mjs";

test("server-renders the first step of the track, and nothing that comes after it", async () => {
  const response = await request("/", { headers: { accept: "text/html" } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /GovernAI/);

  // The rail: a fill, the mark, one dot per step, and a note. It is not navigation
  // to a set of destinations — it reports position on a track this run computed.
  assert.match(html, /class="rail"/);
  assert.match(html, /<nav class="dots" aria-label="Setup steps">/);
  assert.match(html, /aria-current="step"/);
  assert.match(html, /class="rail-note"/);

  // Exactly one dot per step on the track, and the fill is the reader's position in
  // it. `trackFor` adds and drops steps with the selection, so both are read off the
  // step count in the heading rather than hardcoded — the invariant is that the rail
  // and the heading can never disagree about how long the track is.
  const steps = Number(html.match(/ of <!-- -->(\d+)</)?.[1]);
  assert.ok(steps >= 6, `Expected a step count in the heading, read ${steps}.`);
  assert.deepEqual(
    [...html.matchAll(/title="(\d+)\. /g)].map((match) => Number(match[1])),
    Array.from({ length: steps }, (_, index) => index + 1),
  );
  assert.equal(
    Number(html.match(/class="rail-fill" style="width:(\d+)%"/)?.[1]),
    Math.round((1 / steps) * 100),
  );
  // Every step after the current one is disabled. A step the reader has not reached
  // is not a place they may go: its question has not been asked yet, and the answers
  // that decide whether it exists at all have not been given.
  assert.equal([...html.matchAll(/disabled=""/g)].length, steps - 1);

  // One decision on the screen: its number, its question, why it is being asked, the
  // fields, and the consequence of answering.
  assert.match(html, /class="stage"/);
  assert.match(html, /class="step fwd"/);
  assert.match(html, /class="q-n">Step /);
  assert.match(html, /<h1 class="q">What are we assessing\?<\/h1>/);
  assert.match(html, /class="q-sub">Two names, so the report knows whose system it is describing\./);
  assert.match(html, /<span>System name<\/span>/);
  assert.match(html, /<span>Organization<\/span>/);
  assert.match(html, /ACI Knowledge Assistant/);
  assert.match(html, /ACI Infotech/);
  assert.match(html, /class="because flat"/);
  assert.match(html, /The retrieval stack is set to/);
  assert.match(html, /class="btn primary"/);
  assert.match(html, /Continue /);
  // Before the applicability engine has answered, the rail says so rather than
  // printing a control count it does not have yet.
  assert.match(html, /planning…/);

  // What the redesign removed. The permanent left panel and its destinations, the
  // three-register audience toggle, and the document shell that framed a run as a
  // book with unwritten chapters.
  assert.doesNotMatch(html, /class="nav"/);
  assert.doesNotMatch(html, /class="masthead"/);
  assert.doesNotMatch(html, /class="toc"/);
  assert.doesNotMatch(html, /class="doc-head"/);
  assert.doesNotMatch(html, /class="colophon"/);
  assert.doesNotMatch(html, /class="posture-strip"/);
  assert.doesNotMatch(html, /class="mode-toggle"/);
  assert.doesNotMatch(html, /class="acc-item/);
  assert.doesNotMatch(html, /Engineering/);
  assert.doesNotMatch(html, /not yet written|being written/);
  assert.doesNotMatch(html, /Part I · The assessment/);

  // The trail is the only navigation and it holds the reader's own answers, so
  // before the first answer there is nothing in it and it is not rendered at all.
  assert.doesNotMatch(html, /class="trail"/);
  assert.doesNotMatch(html, /class="receipt"/);

  // Neither the run nor the report has happened, and the shell does not pre-draw
  // either of them.
  assert.doesNotMatch(html, /class="ring/);
  assert.doesNotMatch(html, /class="segs"/);
  assert.doesNotMatch(html, /class="report/);
  assert.doesNotMatch(html, /Chapter I/);

  assert.doesNotMatch(html, /Anthropic|Claude/);
  assert.doesNotMatch(html, /codex-preview/);
  assert.doesNotMatch(html, /react-loading-skeleton/);
  assert.doesNotMatch(html, /Design prototype · sample data/);
});

test("client bundle carries the track, the run, and the six-chapter report", async () => {
  const assetsDirectory = new URL("../dist/client/assets/", import.meta.url);
  const assets = await readdir(assetsDirectory);
  const workspaceAsset = assets.find(
    (name) => name.startsWith("workspace-") && name.endsWith(".js"),
  );
  assert.ok(workspaceAsset, "Expected the client workspace bundle.");
  const bundle = await readFile(new URL(workspaceAsset, assetsDirectory), "utf8");
  assert.match(bundle, /createObjectURL/);

  // The track. Every screen is one question, phrased as a question.
  assert.match(bundle, /What are we assessing\?/);
  assert.match(bundle, /What kind of business runs it\?/);
  assert.match(bundle, /Which rulebooks should it be held to\?/);
  assert.match(bundle, /How much of the system can we see\?/);
  assert.match(bundle, /Where is it, and what may we use\?/);
  assert.match(bundle, /This is exactly what will run/);
  // The scope step exists only when a selected pack's controls consume a profile
  // answer, which is what makes the track a computed length rather than a fixed one.
  assert.match(bundle, /A few questions your rulebooks need answered/);
  // Navigation is the reader's own answers, docked as receipts.
  assert.match(bundle, /className:`trail`/);
  assert.match(bundle, /receipt/);

  // Each step states the consequence of the answer in this run's real numbers, read
  // from the same applicability and planning engines that the assessment runs on.
  assert.match(bundle, / reachable · /);
  assert.match(bundle, /reachable at /);
  assert.match(bundle, /apply to you/);
  // Pre-flight answers "did I type this right" at the field, rather than several
  // seconds into a run wearing the costume of a control failure.
  assert.match(bundle, /Check the connection/);

  // The run. Each stage is named in the words someone would say out loud.
  assert.match(bundle, /Asking your assistant questions/);
  assert.match(bundle, /Matching what we found to each rulebook/);
  assert.match(bundle, /Applying each pass condition/);
  assert.match(bundle, /Adding it up/);
  assert.match(bundle, /Stop the run/);
  assert.match(bundle, /Read the result/);
  // Rules the depth cannot reach are counted, not listed: fifty-odd rows of
  // not_assessed would bury the handful of verdicts actually reached.
  assert.match(bundle, /could not be reached at /);
  assert.match(bundle, /nothing written to your system/);
  // A run that stops produces no number at all, because a number from an interrupted
  // run looks exactly like a number from a finished one.
  assert.match(bundle, /The run stopped before it reached a verdict/);
  assert.match(bundle, /no half-assessment/);

  // The report: six chapters, in the order a reader asks the questions.
  assert.match(bundle, /Where you stand/);
  assert.match(bundle, /What is broken/);
  assert.match(bundle, /What to fix first/);
  assert.match(bundle, /Area by area/);
  assert.match(bundle, /What we could not see/);
  assert.match(bundle, /The full trace/);
  // The chapter most products leave out is the one that says what was not seen.
  assert.match(bundle, /The most important chapter/);

  // Health is a rate over what was assessed, and the card says which denominator it
  // used instead of printing its own figure back at the reader a second time.
  assert.match(bundle, /averaged over the /);
  assert.doesNotMatch(bundle, /% health`/);
  // The verdict is a heading and an identifier at once, so both forms ship: the
  // sentence for the reader, the token for the export.
  assert.match(bundle, /Not enough evidence to judge/);
  assert.match(bundle, /insufficient_evidence/);
  // Findings come from rules. Nothing on this screen is inferred or model-judged.
  assert.match(bundle, /raised by a rule, never inferred/);
  assert.match(bundle, /assessed ÷ applicable/);
  assert.match(bundle, /not_assessed/);
  // An area with nothing planned reads as a sentence rather than "0 of 0 rules".
  assert.match(bundle, /no rules planned/);
  // The printable report is generated in the browser, so its wording ships here too.
  assert.match(bundle, /<th>Provenance<\/th>/);
  assert.match(bundle, /How these verdicts were reached/);

  // The previous two front ends. The dashboard's panels and drawers, and the
  // document's parts, running heads, colophon and blank pages.
  assert.doesNotMatch(bundle, /className:`colophon`/);
  assert.doesNotMatch(bundle, /className:`blankpage`/);
  assert.doesNotMatch(bundle, /className:`bucket`/);
  assert.doesNotMatch(bundle, /className:`settled`/);
  assert.doesNotMatch(bundle, /being written/);
  assert.doesNotMatch(bundle, /Go to the setup sections/);
  assert.doesNotMatch(bundle, /Set up the run/);
  assert.doesNotMatch(bundle, /Watching your assistant get tested/);
  assert.doesNotMatch(bundle, /Posture summary/);
  assert.doesNotMatch(bundle, /field-lamped/);
  assert.doesNotMatch(bundle, /Guided/);
  // One register only. The other two are gone from the shipped strings, not hidden
  // behind a toggle.
  assert.doesNotMatch(bundle, /Engineering/);
  assert.doesNotMatch(bundle, /Nothing here is armed/);

  assert.doesNotMatch(bundle, /document\.write/);
  assert.doesNotMatch(bundle, /maximum of 3|between 1 and 3|of 3 selected/i);
});

test("catalog exposes all industries, standards, and tier-specific fields", async () => {
  const response = await request("/api/catalog");
  assert.equal(response.status, 200);
  const catalog = await response.json();
  assert.equal(catalog.industries.length, 16);
  assert.ok(catalog.standards.length >= 30);
  assert.ok(catalog.standards.every((standard) => standard.officialReference?.url.startsWith("https://")));
  assert.equal(
    catalog.standards.find((standard) => standard.id === "sr_11_7").officialReference.status,
    "superseded",
  );
  assert.deepEqual(
    catalog.industries.find((item) => item.id === "healthcare").recommendations.map((item) => item.standardId),
    ["hipaa", "iso42001", "nist_ai_rmf"],
  );

  // Every industry must recommend standards that exist. A typo here would ship a
  // sector whose suggested set silently resolves to nothing in the pack picker.
  const standardIds = new Set(catalog.standards.map((standard) => standard.id));
  for (const industry of catalog.industries) {
    assert.ok(industry.recommendations.length > 0, `${industry.id} recommends nothing`);
    for (const entry of industry.recommendations) {
      assert.ok(standardIds.has(entry.standardId), `${industry.id} recommends unknown ${entry.standardId}`);
    }
  }
  assert.equal(catalog.credentialFields["1"].length, 3);
  assert.equal(catalog.credentialFields["2"].length, 8);
  assert.equal(catalog.credentialFields["3"].length, 17);
  assert.equal(
    catalog.credentialFields["1"].find((field) => field.key === "chatbotApiKey").required,
    false,
  );
  const hipaa = catalog.standards.find((standard) => standard.id === "hipaa");
  assert.equal(hipaa.pack.status, "draft");
  assert.equal(hipaa.pack.assuranceLevel, "readiness");
  assert.equal(hipaa.totalControls, 31);
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
  assert.equal(result.liveEvidence.traces.length, 3);
  assert.ok(
    result.liveEvidence.traces.every(
      (trace) => trace.stages.length === 2 && trace.stages[0].name === "retrieval",
    ),
  );
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
  assert.equal(result.reports[0].assessedControls, 9);
  assert.equal(result.reports[0].totalControls, 31);
  assert.equal(result.reports[0].coveragePercent, 29);
  assert.equal(result.reports[0].assuranceLevel, "readiness");
  assert.match(result.reports[0].packRelease, /draft/);
  assert.equal(
    result.reports[0].controls.filter((control) => control.status === "not_assessed").length,
    22,
  );
  assert.ok(
    result.reports[0].controls.every(
      (control) =>
        control.objective &&
        control.evaluationRuleId &&
        control.evidenceProcedureIds?.length > 0 &&
        control.applicability?.length > 0,
    ),
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
  const euReport = result.reports.find((report) => report.standardId === "eu_ai_act");
  assert.equal(euReport.totalControls, 26);
  assert.equal(euReport.unknownApplicabilityControls, 0);
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
  assert.equal(result.reports[0].assessedControls, 1);
  assert.equal(result.reports[0].readiness, "Insufficient evidence");
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
  assert.match(stream, /event: rag_trace/);
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

test("Tier 3 evidence manifest assesses only named artifact procedures", async () => {
  const response = await request("/api/assessments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...baseInput,
      standardIds: ["hipaa"],
      tier: 3,
      credentials: {
        ...baseInput.credentials,
        repoUrl: "https://ci.target.test/source",
        stagingUrl: "https://ci.target.test/staging",
        modelRegistryUrl: "https://ci.target.test/models",
        evidenceManifestUrl: "https://evidence.target.test/manifest.json",
      },
    }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(
    result.liveEvidence.probes.find((probe) => probe.id === "evidence-manifest").status,
    "pass",
  );
  const riskAnalysis = result.reports[0].controls.find(
    (control) => control.id === "HIPAA-S-01",
  );
  assert.equal(riskAnalysis.status, "pass");
  assert.equal(riskAnalysis.applicabilityStatus, "applicable");
  assert.match(riskAnalysis.evidence, /risk analysis/i);
  assert.equal(
    result.reports[0].controls.find((control) => control.id === "HIPAA-S-02").status,
    "partial",
  );
});

test("Tier 3 GitHub collector supplies named read-only provider evidence", async () => {
  const response = await request("/api/assessments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...baseInput,
      standardIds: ["nist_ai_rmf"],
      tier: 3,
      credentials: {
        ...baseInput.credentials,
        repoUrl: "https://github.com/northstar/clinical-assistant",
        stagingUrl: "https://ci.target.test/staging",
        modelRegistryUrl: "https://ci.target.test/models",
        githubToken: "test-only-github-token",
      },
    }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  const collector = result.liveEvidence.execution.collectors.find(
    (item) => item.id === "github",
  );
  assert.equal(collector.status, "pass");
  assert.match(collector.summary, /branch protection verified/i);
  assert.doesNotMatch(JSON.stringify(result), /test-only-github-token/);
  const reproducibility = result.reports[0].controls.find(
    (control) => control.id === "NIST-MEASURE-07",
  );
  assert.equal(reproducibility.status, "partial");
  assert.match(reproducibility.evidence, /default branch main/i);
});

test("HIPAA applicability excludes controls for a non-regulated organization", async () => {
  const response = await request("/api/assessments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...baseInput,
      standardIds: ["hipaa"],
      applicability: {
        ...baseInput.applicability,
        hipaaRole: "not_regulated",
        handlesPhi: false,
        handlesEphi: false,
        usesPhiSubprocessors: false,
        maintainsDesignatedRecordSet: false,
      },
    }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.ok(result.reports[0].notApplicableControls >= 30);
  assert.equal(
    result.reports[0].controls.find((control) => control.id === "HIPAA-S-01").status,
    "not_applicable",
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
