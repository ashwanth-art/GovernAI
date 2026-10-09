import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { baseInput, request } from "./harness.mjs";

// Compile source helpers in-process so presentation is tested independently of
// the assessment engine and without changing production module resolution.
const require = createRequire(import.meta.url);
require.extensions[".ts"] = (module, path) => module._compile(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, path);
const { evaluatedReportView } = require("../lib/report-view.ts");
const { createReportHtml } = require("../lib/report-html.ts");

test("report includes only pass/fail verdicts and counts its evaluated scope without modifying raw evidence", async () => {
  const response = await request("/api/assessments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...baseInput, tier: 3, industryId: "finance", standardIds: ["iso27001", "rbi_it_governance"], credentials: { ...baseInput.credentials, repoUrl: "https://ci.target.test/source", stagingUrl: "https://ci.target.test/staging", modelRegistryUrl: "https://ci.target.test/models", evidenceManifestUrl: "https://evidence.target.test/manifest.json" } }) });
  assert.equal(response.status, 200);
  const raw = await response.json();
  const original = JSON.stringify(raw);
  const view = evaluatedReportView(raw);
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
});
