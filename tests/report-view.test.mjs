import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { baseInput, request } from "./harness.mjs";

// Compile source helpers in-process so presentation is tested independently of
// the assessment engine and without changing production module resolution.
const require = createRequire(import.meta.url);
require.extensions[".ts"] = (module, path) => module._compile(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, path);
const { evaluatedReportView } = require("../lib/report-view.ts");
const { createReportHtml } = require("../lib/report-html.ts");
const { fallbackSeed } = require("../lib/remediation.ts");
const { artifactCheck, resolveCheck } = require("../lib/checks.ts");
const { deploymentReviewPack } = require("../lib/framework-packs/deployment-review.ts");
const { primaryPillar, domainFor } = require("../lib/pillars.ts");
const { buildApplicationMap, mapStandardsFromResult } = require("../lib/application-map.ts");
const { supportingTechnicalChecks, assessmentMethod } = require("../lib/deployment-evaluation.ts");

test("application map includes only selected controls, all seven layers and truthful planned/evidence-gap states", () => {
  const selected = [{ id: deploymentReviewPack.standard.id, shortName: "Deployment Review", controls: deploymentReviewPack.controls }];
  const plan = buildApplicationMap(selected, 3);
  assert.equal(plan.total, 69); assert.equal(plan.evaluated, 0); assert.equal(plan.layers.length, 7);
  assert.ok(plan.layers.every(layer => layer.controls.length > 0));
  assert.ok(plan.layers.flatMap(layer => layer.controls).every(control => control.state === "planned"));
  const shallow = buildApplicationMap(selected, 1);
  assert.ok(shallow.layers.flatMap(layer => layer.controls).every(control => control.state === "needs_deeper_tier"));
  const result = { reports: [{ standardId: "deployment_review", shortName: "Deployment Review", controls: deploymentReviewPack.controls.map((control, index) => ({ ...control, status: index === 0 ? "pass" : index === 1 ? "fail" : "not_assessed" })) }] };
  const completed = buildApplicationMap([{ ...result.reports[0], id: "deployment_review" }], 3);
  assert.equal(completed.evaluated, 2); assert.equal(completed.total, 69);
  assert.equal(completed.layers.flatMap(layer => layer.controls).filter(control => control.state === "not_assessed").length, 67);
  assert.deepEqual(buildApplicationMap([], 3).layers.map(layer => layer.controls.length), [0, 0, 0, 0, 0, 0, 0]);
});

test("technical checks support explicit selected control rules without replacing regulatory verdicts", () => {
  const check = { ...deploymentReviewPack.controls.find(control => control.evaluationRuleId === "artifact.review-frontend-csp"), status: "fail", evidence: "Live GET: enforcing CSP header absent." };
  const control = { ...check, id: "ISO-EXAMPLE", evaluationRuleId: "adapter.deployment-posture", status: "not_assessed", evidence: "Deployment configuration source not connected." };
  const result = { reports: [{ standardId: "iso27001", shortName: "ISO 27001", controls: [control] }], review: { technicalAssessments: [check] } };
  const rows = mapStandardsFromResult(result);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].controls[0].status, "not_assessed");
  assert.equal(rows[0].controls[0].evidence, control.evidence);
  assert.equal(rows[0].controls[0].supportingChecks[0].status, "fail");
  assert.match(rows[0].controls[0].method, /configuration/);
  assert.deepEqual(supportingTechnicalChecks({ ...control, evaluationRuleId: "artifact.bank-customer-diligence" }, [check]), []);
  assert.match(assessmentMethod({ ...control, evaluationRuleId: "probe.grounding" }), /live endpoint probe/);
  const legacy = mapStandardsFromResult({ reports: [{ standardId: "deployment_review", controls: [check] }, ...result.reports] });
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].controls[0].supportingChecks[0].evidence, check.evidence);
});

test("new evaluations map into their existing report pillars and specific domains", () => {
  const expected = {
    "DEP-SECURITY-IAM-MFA": ["security", "security.iam"],
    "DEP-SECURITY-IAM-REVIEWS": ["governance", "gov.accessreviews"],
    "DEP-SECURITY-DEVICE-EDR": ["security", "security.endpoint"],
    "DEP-SECURITY-NETWORK-SEGMENTATION": ["security", "security.network"],
    "DEP-SECURITY-DATA-ACCESS": ["data_protection", "data.access"],
    "DEP-SECURITY-DATA-CRYPTO": ["data_protection", "data.crypto"],
    "DEP-SECURITY-DATA-RECOVERY": ["governance", "gov.resilience"],
    "DEP-SECURITY-AUTOMATION-RESPONSE": ["governance", "gov.automation"],
    "DEP-SECURITY-VISIBILITY-ALERTS": ["compliance", "comp.detection"],
    "DEP-SECURITY-APP-AI-VALIDATION": ["trust", "trust.oversight"],
    "DEP-ENTRA-MFA-REGISTRATION": ["security", "security.iam"],
    "DEP-FRONTEND-HSTS": ["security", "security.network"],
  };
  for (const [id, [pillar, domain]] of Object.entries(expected)) {
    const control = deploymentReviewPack.controls.find(item => item.id === id);
    assert.ok(control, id); assert.equal(primaryPillar(control), pillar, id);
    assert.equal(domainFor(pillar, control).id, domain, id);
    assert.equal(artifactCheck(control).domainId, domain, id);
  }
  assert.deepEqual([...new Set(deploymentReviewPack.controls.map(primaryPillar))].sort(), ["compliance", "data_protection", "governance", "security", "trust"]);
});

test("existing canonical adapter checks stay aligned with the new pillar subdomains", () => {
  const control = deploymentReviewPack.controls[0];
  for (const [rule, domain] of Object.entries({ "adapter.credential-hygiene": "security.iam", "adapter.deployment-posture": "security.endpoint", "adapter.transport-encryption": "data.crypto", "adapter.alert-routing": "comp.detection", "probe.service-health": "gov.resilience" })) {
    const check = resolveCheck({ ...control, evaluationRuleId: rule, testType: rule.startsWith("probe.") ? "adversarial_probe" : "config_check" }, { hasNamedEvidence: false });
    assert.equal(check.domainId, domain, rule);
  }
});

test("deployment findings prescribe scoped fixes and require fresh observation or typed evidence", () => {
  for (const control of deploymentReviewPack.controls) {
    const check = artifactCheck(control), fix = fallbackSeed(check.id, check.title);
    assert.equal(check.request.endpoint, "{scopedReviewConnection}");
    assert.match(check.request.note, /Target-published manifest verdicts cannot/);
    assert.equal(fix.owner, "Platform engineering");
    assert.match(fix.verification, /direct observation or fresh, complete typed tool export/);
    assert.ok(!fix.steps.some(step => /Add the named evidence procedure/.test(step.action)));
  }
  assert.match(fallbackSeed("chk.artifact.review-frontend-csp", "CSP").steps[1].action, /enforcing Content-Security-Policy/);
  assert.match(fallbackSeed("chk.artifact.review-security-iam-sod", "SoD").steps[1].action, /Separate initiating and approving permissions/);
});

test("report includes only pass/fail verdicts and counts its evaluated scope without modifying raw evidence", async () => {
  const response = await request("/api/assessments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...baseInput, tier: 3, industryId: "finance", standardIds: ["iso27001", "rbi_it_governance", "rbi_it_outsourcing", "rbi_free_ai", "rbi_digital_payments"], credentials: { ...baseInput.credentials, repoUrl: "https://ci.target.test/source", stagingUrl: "https://ci.target.test/staging", modelRegistryUrl: "https://ci.target.test/models", evidenceManifestUrl: "https://evidence.target.test/manifest.json" } }) });
  assert.equal(response.status, 200);
  const raw = await response.json();
  const original = JSON.stringify(raw);
  const view = evaluatedReportView(raw);
  assert.deepEqual(view.reports.map(report => report.standardId), ["iso27001"]);
  assert.deepEqual(view.scope.selectedStandards, ["ISO/IEC 27001"]);
  assert.ok(!view.analysis.matrix.some(row => row.standardId === "rbi_it_governance"));
  assert.ok(raw.reports.some(report => report.controls.some(control => control.status === "not_assessed")));
  assert.ok(view.reports.every(report => report.controls.every(control => ["pass", "fail"].includes(control.status))));
  assert.equal(view.analysis.posture.assessed, view.analysis.posture.applicable);
  assert.equal(view.analysis.posture.coveragePercent, 100);
  assert.equal(view.analysis.gaps.length, 0);
  assert.ok(view.analysis.findings.length > 0);
  assert.equal(JSON.stringify(raw), original);
  const html = createReportHtml(raw);
  assert.ok(!html.includes("Banking governance"));
  assert.ok(!html.includes("RBI_IT_GOVERNANCE-01"));
  assert.ok(!html.includes("RBI IT Governance"));
  assert.ok(!html.includes("No pass/fail verdicts available"));
});
