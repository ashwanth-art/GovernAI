import assert from "node:assert/strict";
import test from "node:test";

import { baseInput, request, session, targetState } from "./harness.mjs";

/** Tier 3 requires the white-box locations, or validation rejects the run before it starts. */
const TIER_3_LOCATIONS = {
  repoUrl: "https://ci.target.test/source",
  stagingUrl: "https://ci.target.test/staging",
  modelRegistryUrl: "https://ci.target.test/models",
  evidenceManifestUrl: "https://evidence.target.test/manifest.json",
  evidenceManifestToken: "test-only-manifest-token",
};

/**
 * The analysis layer must never invent a verdict.
 *
 * Every assertion here re-derives a number from the raw control results and
 * compares it to what the analysis reported. If the two ever disagree, the
 * product is lying about its own reasoning, which is the one defect this whole
 * layer exists to prevent.
 */

const ASSESSED = new Set(["pass", "partial", "fail"]);
const WORST = ["fail", "partial", "pass", "not_assessed", "not_applicable"];

function allControls(result) {
  return [...result.reports.flatMap((report) => report.controls), ...result.owasp];
}

async function runAssessment(overrides = {}) {
  const response = await request("/api/assessments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...baseInput, ...overrides }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

test("pre-flight plan states what will run, what will not, and what each tier reaches", async () => {
  const response = await request("/api/plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      standardIds: ["hipaa", "nist_ai_rmf"],
      tier: 2,
      access: {},
    }),
  });
  assert.equal(response.status, 200);
  const plan = await response.json();

  assert.equal(plan.tier, 2);
  assert.equal(plan.runnableChecks + plan.blockedChecks, plan.totalChecks);
  assert.ok(plan.runnableChecks > 0);
  assert.ok(plan.blockedChecks > 0, "Tier 2 cannot reach Tier 3 rules, and must say so.");
  assert.equal(plan.boundedRequests, 8);
  assert.ok(plan.estimatedSeconds > 0);

  // Every blocked check explains itself and no runnable check pretends to be blocked.
  for (const check of plan.checks) {
    if (check.willRun) assert.equal(check.notRunReason, "");
    else assert.ok(check.notRunReason.length > 10, `${check.id} was blocked with no reason.`);
    assert.ok(check.controlCount > 0);
    assert.ok(check.ruleId, `${check.id} has no rule id.`);
  }

  // Coverage forecast is monotonic across tiers: more access never sees less.
  assert.equal(plan.forecast.length, 3);
  assert.deepEqual(plan.forecast.map((entry) => entry.tier), [1, 2, 3]);
  assert.ok(plan.forecast[0].percent <= plan.forecast[1].percent);
  assert.ok(plan.forecast[1].percent <= plan.forecast[2].percent);
  assert.equal(plan.forecast[2].percent, 100, "Tier 3 must reach every applicable control.");
  for (const entry of plan.forecast) {
    assert.equal(entry.byPillar.length, 5);
    assert.deepEqual(
      entry.byPillar.map((cell) => cell.pillar).sort(),
      ["compliance", "data_protection", "governance", "security", "trust"],
    );
  }

  assert.ok(plan.blindSpots.length > 0);
  assert.ok(plan.blindSpots.every((spot) => spot.reason && spot.closedBy));
  assert.ok(plan.safety.length >= 5);
  assert.ok(plan.safety.some((rule) => /never written to an event/i.test(rule)));
  assert.ok(plan.safety.some((rule) => /401 or 403/i.test(rule)));
});

test("pre-flight plan requires a framework and rejects unparsable input", async () => {
  const empty = await request("/api/plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ standardIds: [], tier: 1 }),
  });
  assert.equal(empty.status, 422);

  const broken = await request("/api/plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
  assert.equal(broken.status, 400);
});

test("scope route assesses every HIPAA and EU AI Act control without scope questions", async () => {
  // No profile is sent and none is needed: role-, PHI- and risk-class-specific
  // obligations are reported against the system rather than ruled out.
  const response = await request("/api/scope", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ standardIds: ["hipaa", "eu_ai_act"], tier: 1 }),
  });
  assert.equal(response.status, 200);
  const scope = await response.json();
  assert.equal(scope.applicable, 32);
  assert.equal(scope.notApplicable, 0);
  assert.equal(scope.unknown, 0);
  assert.deepEqual(
    scope.byStandard.map((row) => [row.shortName, row.applicable, row.exclusions.length]),
    [["HIPAA", 21, 0], ["EU AI Act", 11, 0]],
  );
  assert.equal(scope.byPillar.length, 5);
  assert.equal("openQuestions" in scope, false);
});

test("analysis posture is recomputable from the raw control results", async () => {
  const result = await runAssessment({ standardIds: ["hipaa", "nist_ai_rmf"] });
  const analysis = result.analysis;
  const controls = allControls(result);
  const applicable = controls.filter((control) => control.applicabilityStatus === "applicable");
  const assessed = applicable.filter((control) => ASSESSED.has(control.status));

  assert.equal(analysis.register, "engineering");
  assert.equal(analysis.posture.applicable, applicable.length);
  assert.equal(analysis.posture.assessed, assessed.length);
  assert.equal(analysis.posture.notAssessed, applicable.length - assessed.length);
  assert.equal(
    analysis.posture.coveragePercent,
    Math.round((assessed.length / applicable.length) * 100),
  );
  assert.equal(
    analysis.posture.healthPercent,
    Math.round((assessed.reduce((sum, c) => sum + c.score, 0) / assessed.length) * 100),
  );
  assert.ok(analysis.posture.verdictReason.length > 20);

  // Coverage and health are reported separately and never blended into one score.
  assert.notEqual(analysis.posture.coveragePercent, undefined);
  assert.notEqual(analysis.posture.healthPercent, undefined);
  assert.ok(analysis.posture.exposureIndex >= 0 && analysis.posture.exposureIndex <= 100);
});

test("every check reports the rule the engine actually applied", async () => {
  const result = await runAssessment({ standardIds: ["hipaa", "nist_ai_rmf"] });
  const byId = new Map(allControls(result).map((control) => [control.id, control]));

  assert.ok(result.analysis.checks.length > 0);
  for (const check of result.analysis.checks) {
    assert.ok(check.rule.statement.length > 40, `${check.id} has no rule statement.`);
    assert.ok(check.rule.passWhen && check.rule.failWhen);
    assert.ok(check.rule.thresholds.length > 0, `${check.id} declares no threshold.`);
    assert.ok(check.controls.length > 0);

    for (const entry of check.controls) {
      const control = byId.get(entry.controlId);
      assert.ok(control, `${entry.controlId} is claimed by ${check.id} but is not in the report.`);
      // The check's rule must be the control's own rule, a declared wildcard, or a
      // labelled fallback. Anything else means the two layers have drifted.
      const isNamedMatch = control.evaluationRuleId === check.ruleId;
      const isWildcard = check.ruleId.endsWith(".*");
      const isFallback = check.id.startsWith("chk.fallback.");
      assert.ok(
        isNamedMatch || isWildcard || isFallback,
        `${check.id} (${check.ruleId}) claims ${entry.controlId} (${control.evaluationRuleId}).`,
      );
      if (isFallback) {
        assert.match(check.rule.statement, /fallback|proxy/i);
      }
    }
  }
});

test("check status equals the worst status of the controls the rule actually evaluated", async () => {
  const result = await runAssessment({ standardIds: ["hipaa", "nist_ai_rmf"] });
  const byId = new Map(allControls(result).map((control) => [control.id, control]));

  for (const check of result.analysis.checks) {
    const evaluated = check.controls
      .map((entry) => byId.get(entry.controlId))
      .filter((control) => control.applicabilityStatus === "applicable")
      .filter((control) => ASSESSED.has(control.status));

    if (!evaluated.length) {
      assert.equal(check.ran, false, `${check.id} claims to have run with nothing assessed.`);
      assert.equal(check.status, "not_assessed");
      assert.ok(check.notRunReason.length > 0, `${check.id} did not run and gave no reason.`);
      assert.ok(check.closedBy.length > 0, `${check.id} did not say what would unblock it.`);
      continue;
    }

    assert.equal(check.ran, true);
    const worst = evaluated
      .map((control) => control.status)
      .sort((a, b) => WORST.indexOf(a) - WORST.indexOf(b))[0];
    assert.equal(check.status, worst, `${check.id} reported ${check.status}, expected ${worst}.`);
  }
});

test("a check that could not run is never reported as a pass", async () => {
  const result = await runAssessment({
    standardIds: ["hipaa"],
    tier: 1,
    credentials: { chatbotEndpoint: "https://target.test/", tenantId: "aci-infotech" },
  });
  const blocked = result.analysis.checks.filter((check) => !check.ran);
  assert.ok(blocked.length > 0, "Tier 1 must leave Tier 2 and Tier 3 rules unrun.");
  assert.ok(blocked.every((check) => check.status === "not_assessed"));
  assert.ok(blocked.every((check) => check.closedBy.length > 0));

  // No rule appears unless a selected framework actually depends on it.
  assert.ok(
    !result.analysis.checks.some((check) => check.method === "not_supported"),
    "HIPAA has no AI-disclosure control, so that rule must not be listed.",
  );

  // No framework lists a control whose rule no tier can close.
  const catalog = await (await request("/api/catalog")).json();
  const plan = await (
    await request("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ standardIds: catalog.standards.map((s) => s.id), tier: 3, access: {} }),
    })
  ).json();
  assert.ok(!plan.checks.some((check) => check.method === "not_supported"));
});

test("findings exist only for failing checks and each names the check that closes it", async () => {
  const result = await runAssessment({ standardIds: ["hipaa", "nist_ai_rmf"] });
  const analysis = result.analysis;
  const failingCheckIds = new Set(
    analysis.checks.filter((check) => check.status === "fail").map((check) => check.id),
  );
  assert.equal(analysis.findings.length, failingCheckIds.size);

  const playbookIds = new Set(analysis.playbooks.map((playbook) => playbook.id));
  for (const finding of analysis.findings) {
    assert.match(finding.id, /^FND-\d{3}$/);
    assert.equal(finding.detectedBy.length, 1);
    assert.ok(failingCheckIds.has(finding.detectedBy[0]));
    assert.ok(finding.breaches.length > 0);
    assert.equal(finding.blastRadius.controls, finding.breaches.length);
    assert.ok(finding.impact.length > 40, `${finding.id} has no impact statement.`);
    assert.match(finding.closesWhen, /cannot be closed by hand/i);
    assert.ok(
      playbookIds.has(finding.remediationId),
      `${finding.id} points at playbook ${finding.remediationId}, which does not exist.`,
    );
  }
});

test("every playbook is verified by a real check, never by self-attestation", async () => {
  const result = await runAssessment({ standardIds: ["hipaa", "nist_ai_rmf"] });
  const checkIds = new Set(result.analysis.checks.map((check) => check.id));
  for (const playbook of result.analysis.playbooks) {
    assert.ok(playbook.steps.length > 0);
    assert.ok(playbook.steps.every((step) => step.action && step.where));
    assert.equal(playbook.verification.checkIds.length, 1);
    assert.ok(
      checkIds.has(playbook.verification.checkIds[0]),
      `${playbook.id} verifies against ${playbook.verification.checkIds[0]}, which did not run.`,
    );
    assert.ok(playbook.verification.statement.length > 20);
    assert.ok(playbook.closesCount > 0);
    assert.ok(playbook.rank > 0);
  }
  // Ranked by controls closed per hour of effort, highest first.
  const ranks = result.analysis.playbooks.map((playbook) => playbook.rank);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => b - a));
});

test("gaps list only applicable controls that could not be assessed, each with a way to close it", async () => {
  const result = await runAssessment({ standardIds: ["hipaa"] });
  const byId = new Map(allControls(result).map((control) => [control.id, control]));
  const expected = allControls(result).filter(
    (control) => control.applicabilityStatus === "applicable" && control.status === "not_assessed",
  );
  assert.equal(result.analysis.gaps.length, expected.length);
  for (const gap of result.analysis.gaps) {
    const control = byId.get(gap.controlId);
    assert.equal(control.status, "not_assessed");
    assert.equal(control.applicabilityStatus, "applicable");
    assert.ok(gap.reason.length > 10);
    assert.ok(gap.closedBy.length > 10);
  }
});

test("a proxy rule is labelled as one everywhere its verdict is reported", async () => {
  // NYC LL144 is a legacy-catalog pack: most of its controls carry no rule of their own, so the
  // engine substitutes a pillar-level probe. That substitution is legitimate but it must never be
  // presentable as a direct test of the control's text.
  const result = await runAssessment({ standardIds: ["nyc_ll144"], tier: 3, credentials: { ...baseInput.credentials, ...TIER_3_LOCATIONS } });
  const analysis = result.analysis;
  const proxyChecks = analysis.checks.filter((check) => check.provenance === "proxy");
  assert.ok(proxyChecks.length > 0, "this pack should exercise the proxy path");

  for (const check of proxyChecks) {
    // The rule text has always admitted it; the declared field is what lets every screen say so
    // without parsing prose.
    assert.match(check.id, /^chk\.fallback\./);
    assert.match(check.rule.statement, /proxy|stand in|Legacy/i);
  }
  for (const check of analysis.checks) {
    assert.ok(["direct", "proxy"].includes(check.provenance), `${check.id} has no provenance`);
  }

  // The roll-up counts only assessed controls, and it is not blended into coverage or health.
  const row = analysis.matrix.find((entry) => entry.standardId === "nyc_ll144");
  assert.ok(row.provenance.proxy > 0);
  assert.equal(row.provenance.direct + row.provenance.proxy, row.provenance.assessed);
  assert.ok(analysis.provenance.proxy >= row.provenance.proxy);
});

test("a mapped pack uses a rule written for every control it assesses", async () => {
  const result = await runAssessment({ standardIds: ["iso42001"], tier: 3, credentials: { ...baseInput.credentials, ...TIER_3_LOCATIONS } });
  const row = result.analysis.matrix.find((entry) => entry.standardId === "iso42001");
  assert.equal(row.provenance.proxy, 0, "ISO 42001 is fully mapped and must use no proxy");
  assert.equal(
    result.analysis.checks.filter(
      (check) => check.provenance === "proxy" && check.controls.some((c) => c.standardId === "iso42001"),
    ).length,
    0,
  );
});

test("unchecked controls group under the single input that would close them", async () => {
  const result = await runAssessment({ standardIds: ["iso42001"], tier: 1 });
  const gaps = result.analysis.gaps;
  assert.ok(gaps.length > 0, "Tier 1 must leave gaps against a full pack");

  // The summary screen and the printable report both group gaps by `closedBy`. That grouping has
  // to be total — a gap with no way to close it would silently vanish from the roll-up.
  const grouped = gaps.reduce((sum, gap) => {
    assert.ok(gap.closedBy.length > 10, `${gap.controlId} has no way to close it`);
    return sum + 1;
  }, 0);
  assert.equal(grouped, gaps.length);

  const byCloser = new Map();
  for (const gap of gaps) byCloser.set(gap.closedBy, (byCloser.get(gap.closedBy) ?? 0) + 1);
  assert.ok(byCloser.size >= 1);
  assert.equal([...byCloser.values()].reduce((a, b) => a + b, 0), gaps.length);
  // Every group names a tier deeper than the one that ran, or the gap is not about depth at all.
  for (const gap of gaps) assert.ok(gap.tierMinimum >= 1 && gap.tierMinimum <= 3);
});

test("pillar and framework roll-ups agree with the reports they summarise", async () => {
  const result = await runAssessment({ standardIds: ["hipaa", "nist_ai_rmf"] });
  const controls = allControls(result);

  assert.equal(result.analysis.pillars.length, 5);
  for (const pillar of result.analysis.pillars) {
    const applicable = controls.filter(
      (control) =>
        control.pillars.includes(pillar.pillar) && control.applicabilityStatus === "applicable",
    );
    const assessed = applicable.filter((control) => ASSESSED.has(control.status));
    assert.equal(pillar.applicable, applicable.length, `${pillar.key} applicable count`);
    assert.equal(pillar.assessed, assessed.length, `${pillar.key} assessed count`);
    assert.ok(pillar.question.endsWith("?"), `${pillar.key} has no question.`);
    assert.ok(pillar.domains.length > 0);
    assert.ok(pillar.checksRan <= pillar.checksTotal);
    assert.ok(pillar.hue.startsWith("#"));
  }

  // Two selected packs plus the always-on OWASP LLM pack. That row exists so the table adds up
  // to the applicable total the summary strip reports — without it the two disagreed by ten
  // controls with nothing on any screen to explain the difference.
  assert.equal(result.analysis.matrix.length, 3);
  const owaspRow = result.analysis.matrix.find((row) => row.standardId === "owasp_llm_2025");
  assert.ok(owaspRow, "the always-on OWASP pack has no row in the matrix");
  assert.match(owaspRow.packRelease, /always on/);
  assert.equal(
    result.analysis.matrix.reduce((sum, row) => sum + row.applicable, 0),
    result.analysis.posture.applicable,
    "the readiness table must account for every applicable control the posture counts",
  );

  for (const row of result.analysis.matrix) {
    assert.equal(row.cells.length, 5);
    assert.ok(row.cells.every((cell) => cell.assessed <= cell.applicable));
    // Rule provenance is a separate axis from coverage and health, and only assessed controls
    // have any provenance to report.
    assert.equal(row.provenance.direct + row.provenance.proxy, row.provenance.assessed);
    assert.ok(row.provenance.assessed <= row.applicable);
    const report = result.reports.find((item) => item.standardId === row.standardId);
    if (!report) continue;
    assert.equal(row.assessed, report.assessedControls);
    assert.equal(row.coveragePercent, report.coveragePercent);
    assert.equal(row.healthPercent, report.score);
  }

  // Every assessed control was judged by exactly one kind of rule, and the run-wide split is the
  // sum of the per-pillar ones only after de-duplication — a control tagged with two pillars is
  // counted in both, so the run total is checked against the controls, not against the pillars.
  const provenance = result.analysis.provenance;
  assert.equal(provenance.direct + provenance.proxy, provenance.assessed);
  assert.equal(
    provenance.assessed,
    controls.filter(
      (control) => control.applicabilityStatus === "applicable" && ASSESSED.has(control.status),
    ).length,
  );
});

test("evidence ledger records provenance and every monitor states its arming cost", async () => {
  const result = await runAssessment({ standardIds: ["hipaa"] });
  const analysis = result.analysis;

  assert.equal(analysis.evidence.length, result.liveEvidence.probes.length);
  for (const record of analysis.evidence) {
    assert.ok(record.endpoint.startsWith("https://"));
    assert.ok(record.method);
    assert.ok(record.validityDays > 0);
    assert.match(record.digest, /^fnv1a32:[0-9a-f]{8}$/);
    assert.equal(record.freshness, "fresh");
  }

  assert.ok(analysis.monitorPlan.length > 0);
  // A monitor can be armed from this plan, so the plan must state what arming costs
  // rather than what blocks it — and it must never claim to be armed on its own.
  assert.ok(
    analysis.monitorPlan.every((entry) => /read-only tokens/i.test(entry.armingCost)),
    "Every monitor must state the cost of arming it beside the switch.",
  );
  assert.ok(
    analysis.monitorPlan.every((entry) => !("armed" in entry) && !("blockedBy" in entry)),
    "The plan describes monitors; whether one is armed is the monitor store's answer.",
  );
  assert.ok(analysis.monitorPlan.every((entry) => entry.checkIds.length > 0));
  assert.ok(analysis.notes.some((note) => /History lives in the server process/i.test(note)));
  assert.ok(analysis.notes.some((note) => /Official standards pages were not fetched/i.test(note)));
});

test("the analysis block never carries a credential", async () => {
  const result = await runAssessment({
    standardIds: ["hipaa"],
    tier: 3,
    credentials: {
      ...baseInput.credentials,
      repoUrl: "https://ci.target.test/source?token=must-not-be-displayed",
      stagingUrl: "https://ci.target.test/staging",
      modelRegistryUrl: "https://ci.target.test/models",
      evidenceManifestUrl: "https://evidence.target.test/manifest.json",
      evidenceManifestToken: "test-only-manifest-token",
    },
  });
  const serialized = JSON.stringify(result.analysis);
  assert.doesNotMatch(serialized, /test-only-key/);
  assert.doesNotMatch(serialized, /test-only-cloud-key/);
  assert.doesNotMatch(serialized, /test-only-monitoring-key/);
  assert.doesNotMatch(serialized, /test-only-manifest-token/);
  assert.doesNotMatch(serialized, /token=/);
  assert.doesNotMatch(serialized, /must-not-be-displayed/);
});

test("the stream emits the derived plan, check, pillar, finding and posture events", async () => {
  const response = await request("/api/assessments/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...baseInput, standardIds: ["hipaa"] }),
  });
  assert.equal(response.status, 200);
  const stream = await response.text();
  assert.match(stream, /event: run_plan/);
  assert.match(stream, /event: check_result/);
  assert.match(stream, /event: pillar_progress/);
  assert.match(stream, /event: posture_update/);
  assert.match(stream, /"runnableChecks":/);
  assert.match(stream, /"checkId":"chk\./);
  assert.match(stream, /"exposureIndex":/);
  assert.match(stream, /"verdict":/);
  assert.doesNotMatch(stream, /test-only-monitoring-key/);
});

/* ---------------------------------------------------------------------------
 * The authored standards: tiering, coverage and findings.
 *
 * These standards select their controls from the verification library, so every
 * control has a real evidence path. The point of these tests is that the tier
 * gate is the only thing standing between a control and a verdict — at Tier 3
 * nothing applicable is left unassessed.
 *
 * PCI DSS is a framework pack rather than a mapping, but every one of its
 * controls is built from the library or names its own procedures, so it is held
 * to the same bar here (it has no scope questions, so all of its controls apply).
 * DPDP follows the same rule and reuses the library for all 33 obligations.
 *
 * Every standard in `mappedStandards` belongs in this list. That is what stops a
 * new sector standard from shipping with a control nothing can ever close: if a
 * mapping names a key with no evidence path, Tier 3 coverage drops below 100%
 * and these tests fail rather than the product quietly reporting a gap forever.
 * ------------------------------------------------------------------------- */

const AUTHORED = [
  "iso42001",
  "soc2",
  "mas_ai",
  "iso27001",
  "gdpr",
  "dpdp_act",
  "nis2",
  "nerc_cip",
  "pci_dss",
  "gxp_part11",
  "cmmc",
  "iec62443",
];

const TIER_3_CREDENTIALS = {
  repoUrl: "https://ci.target.test/source",
  stagingUrl: "https://ci.target.test/staging",
  modelRegistryUrl: "https://ci.target.test/models",
  evidenceManifestUrl: "https://evidence.target.test/manifest.json",
  evidenceManifestToken: "test-only-manifest-token",
};

async function runAuthored(tier, extraCredentials = {}) {
  return runAssessment({
    standardIds: AUTHORED,
    tier,
    credentials: { ...baseInput.credentials, ...extraCredentials },
  });
}

function authoredControls(result) {
  return result.reports
    .filter((report) => AUTHORED.includes(report.standardId))
    .flatMap((report) => report.controls);
}

test("Tier 3 assesses every applicable control in the authored standards", async () => {
  const result = await runAuthored(3, TIER_3_CREDENTIALS);
  const controls = authoredControls(result);
  assert.ok(controls.length >= 500, `expected every authored set, got ${controls.length}`);

  const applicable = controls.filter((control) => control.applicabilityStatus === "applicable");
  const unassessed = applicable.filter((control) => control.status === "not_assessed");
  assert.deepEqual(
    unassessed.map((control) => `${control.id} ${control.name}`),
    [],
    "At Tier 3 every applicable control must reach a verdict.",
  );

  for (const report of result.reports.filter((entry) => AUTHORED.includes(entry.standardId))) {
    assert.equal(
      report.coveragePercent,
      100,
      `${report.standardId} must reach 100% coverage at Tier 3`,
    );
  }

  // A mapped standard selects from the verification library, so every one of its
  // controls has a rule written against it. A proxy verdict here would mean the
  // mapping reached for a pillar fallback — the generated-catalog behaviour these
  // standards exist to replace.
  for (const row of result.analysis.matrix.filter((entry) => AUTHORED.includes(entry.standardId))) {
    assert.equal(row.provenance.proxy, 0, `${row.standardId} must use no proxy check`);
  }
});

test("each tier opens strictly more controls than the one below it", async () => {
  const counts = [];
  for (const tier of [1, 2, 3]) {
    const result = await runAuthored(tier, tier === 3 ? TIER_3_CREDENTIALS : {});
    const controls = authoredControls(result);
    counts.push(
      controls.filter(
        (control) =>
          control.applicabilityStatus === "applicable" && control.status !== "not_assessed",
      ).length,
    );
  }
  assert.ok(counts[0] > 0, "Tier 1 must assess something");
  assert.ok(counts[1] > counts[0], `Tier 2 (${counts[1]}) must exceed Tier 1 (${counts[0]})`);
  assert.ok(counts[2] > counts[1], `Tier 3 (${counts[2]}) must exceed Tier 2 (${counts[1]})`);
});

test("Tier 2 adapter facts produce findings with playbooks that name a verifying check", async () => {
  const result = await runAuthored(2);
  const { findings, playbooks, checks } = result.analysis;

  const adapterChecks = checks.filter((check) => check.ruleId.startsWith("adapter."));
  assert.ok(adapterChecks.length >= 10, `expected the adapter rules to run, got ${adapterChecks.length}`);

  // The stubbed target carries the same open items a real deployment does.
  const expectedFailures = [
    "chk.config.deployment-posture",
    "chk.config.credential-hygiene",
    "chk.config.retention-schedule",
    "chk.config.corpus-integrity",
    "chk.monitoring.alert-routing",
    "chk.monitoring.objective-coverage",
  ];
  for (const id of expectedFailures) {
    const check = checks.find((entry) => entry.id === id);
    assert.ok(check, `${id} did not run`);
    assert.equal(check.status, "fail", `${id} should have failed on the stubbed facts`);
    assert.ok(
      findings.some((finding) => finding.detectedBy.includes(id)),
      `${id} failed but produced no finding`,
    );
    assert.ok(
      playbooks.some((playbook) => playbook.verification.checkIds.includes(id)),
      `${id} produced a finding with no playbook`,
    );
  }

  // A rule that is only half met is a finding too, ranked below the same rule failing.
  const partialCheck = checks.find((entry) => entry.id === "chk.config.request-limits");
  assert.equal(partialCheck.status, "partial");
  const partialFinding = findings.find((finding) =>
    finding.detectedBy.includes("chk.config.request-limits"),
  );
  assert.ok(partialFinding, "a partially met control must still be a finding");
  assert.match(partialFinding.title, /partially met/);
  assert.ok(
    playbooks.some((playbook) =>
      playbook.verification.checkIds.includes("chk.config.request-limits"),
    ),
    "the partial finding must carry a playbook",
  );

  // The windowed series and the event feed are what make continuous monitoring
  // possible at all, so their pass paths are asserted rather than assumed.
  const trend = checks.find((entry) => entry.id === "chk.monitoring.trend-visibility");
  assert.equal(trend.status, "pass", trend.evidence);
  assert.match(trend.evidence, /12 request/);
  const forensics = checks.find((entry) => entry.id === "chk.monitoring.event-forensics");
  assert.equal(forensics.status, "pass", forensics.evidence);
  assert.match(forensics.evidence, /no prompt or response content/);

  assert.ok(
    playbooks.every((playbook) => playbook.verification.checkIds.length > 0),
    "no playbook may close without a check to verify it",
  );
});

test("Tier 3 named-procedure verdicts become findings, and passing ones do not", async () => {
  const result = await runAuthored(3, TIER_3_CREDENTIALS);
  const { findings, checks } = result.analysis;

  const failing = ["chk.artifact.bias-and-adverse-impact", "chk.artifact.records-retention-evidence"];
  for (const id of failing) {
    const check = checks.find((entry) => entry.id === id);
    assert.ok(check, `${id} did not run`);
    assert.equal(check.status, "fail");
    assert.ok(
      findings.some((finding) => finding.detectedBy.includes(id)),
      `${id} failed but produced no finding`,
    );
  }

  const passing = checks.find((entry) => entry.id === "chk.artifact.management-mandate");
  assert.equal(passing.status, "pass");
  assert.ok(
    !findings.some((finding) => finding.detectedBy.includes(passing.id)),
    "a passing check must never produce a finding",
  );
});

test("every finding reaches all five pillars across the authored standards", async () => {
  const result = await runAuthored(3, TIER_3_CREDENTIALS);
  const pillars = new Set(result.analysis.findings.map((finding) => finding.pillar));
  assert.ok(pillars.size >= 4, `findings covered only ${[...pillars].join(", ")}`);
  const assessed = new Set(result.analysis.pillars.map((entry) => entry.pillar));
  assert.equal(assessed.size, 5, "all five pillars must be reported");
  assert.ok(
    result.analysis.pillars.every((entry) => entry.assessed > 0),
    "every pillar must carry at least one assessed control",
  );
});

test("a control never reports a verdict its rule could not establish", async () => {
  // No Tier 2 credentials, so the adapters are unreachable and every adapter rule
  // must return not_assessed rather than inheriting a generic endpoint result.
  const result = await runAssessment({
    standardIds: AUTHORED,
    tier: 2,
    credentials: {
      ...baseInput.credentials,
      cloudApiKey: "wrong-key",
      monitoringApiKey: "wrong-key",
    },
  });
  const adapterControls = authoredControls(result).filter(
    (control) => control.evaluationRuleId?.startsWith("adapter."),
  );
  assert.ok(adapterControls.length > 0);
  assert.ok(
    adapterControls.every((control) => control.status === "not_assessed"),
    "an unauthorized adapter must never yield a pass or a fail",
  );
});

/**
 * The monitor engine, end to end: arm, cycle, observe a real change, alert.
 *
 * A monitor that reports drift the assessed system did not actually undergo is worse
 * than no monitor, so this test changes one control on the stubbed target between two
 * cycles and asserts the engine reports that change and nothing else.
 */
test("an armed monitor re-runs its checks and reports drift the target actually underwent", async () => {
  const run = await runAuthored(2);
  const monitor = run.analysis.monitorPlan.find((entry) =>
    entry.checkIds.includes("chk.config.guardrail-configuration"),
  );
  assert.ok(monitor, "no monitor covers the guardrail check");

  // One instance for the whole exchange: the monitor store is that process's memory.
  const live = await session();
  const command = async (body, expected = 200) => {
    const response = await live("/api/monitors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, expected, await response.clone().text());
    return response.json();
  };

  try {
    // Arming with no input is refused: a monitor with nothing to re-run is not a monitor.
    await command({ action: "arm", monitorId: monitor.id, plan: run.analysis.monitorPlan }, 422);

    const armed = await command({
      action: "arm",
      monitorId: monitor.id,
      input: { ...baseInput, standardIds: AUTHORED, tier: 2 },
      plan: run.analysis.monitorPlan,
      cadenceSeconds: 3600,
    });
    assert.equal(armed.armed.length, 1);
    assert.equal(armed.credentialsHeld, true, "an armed monitor holds the tokens it re-reads with");
    assert.ok(armed.nextDueAt, "an armed monitor must say when it is next due");
    assert.equal(JSON.stringify(armed).includes(baseInput.credentials.monitoringApiKey), false);

    const first = await command({ action: "cycle" });
    assert.equal(first.cyclesRun, 1);
    assert.ok(first.latestResult, "a successful cycle must retain its complete report");
    assert.equal(first.latestResult.analysis.pillars.length, 5);
    assert.equal(first.latestResult.analysis.matrix.length, run.analysis.matrix.length);
    assert.doesNotMatch(JSON.stringify(first.latestResult), /test-only-monitoring-key/);
    assert.equal(first.cycles[0].sequence, 1);
    assert.ok(first.cycles[0].readings.length > 0, "a cycle must read the checks it covers");
    assert.equal(first.alerts.length, 0, "the first cycle has nothing to compare against");
    const baseline = first.cycles[0].readings.find(
      (reading) => reading.checkId === "chk.config.guardrail-configuration",
    );
    assert.equal(baseline.status, "pass");

    // The assessed system changes. Nothing about the assessment changes.
    targetState.injectionGuardrail = false;
    const second = await command({ action: "cycle" });
    assert.equal(second.cyclesRun, 2);

    const regression = second.cycles[0].drift.find(
      (entry) => entry.checkId === "chk.config.guardrail-configuration",
    );
    assert.ok(regression, "turning a control off must be reported as drift");
    assert.equal(regression.from, "pass");
    assert.equal(regression.to, "fail");
    assert.equal(regression.direction, "regression");
    assert.ok(
      second.alerts.some((alert) => alert.checkId === regression.checkId),
      "a regression must raise an alert",
    );

    // Putting it back is drift too, and an improvement is never an alert.
    targetState.injectionGuardrail = true;
    const third = await command({ action: "cycle" });
    const recovery = third.cycles[0].drift.find(
      (entry) => entry.checkId === "chk.config.guardrail-configuration",
    );
    assert.equal(recovery.direction, "improvement");
    assert.equal(recovery.from, "fail");
    assert.equal(recovery.to, "pass");
    assert.equal(
      third.alerts.some((alert) => alert.checkId === recovery.checkId),
      false,
      "an improvement must clear the alert rather than raise one",
    );

    // Arming the whole plan in one call, because nine switches is nine chances to end up
    // half-armed. It must not disturb the monitor that was already armed.
    const all = await command({
      action: "arm_all",
      input: { ...baseInput, standardIds: AUTHORED, tier: 2 },
      plan: run.analysis.monitorPlan,
      cadenceSeconds: 3600,
    });
    assert.equal(all.armed.length, run.analysis.monitorPlan.length);
    assert.equal(JSON.stringify(all).includes(baseInput.credentials.cloudApiKey), false);

    // A named subset arms only that subset, and the plan stays the whole plan.
    await command({ action: "disarm_all" });
    const subset = run.analysis.monitorPlan.slice(0, 2).map((entry) => entry.id);
    const partial = await command({
      action: "arm_all",
      input: { ...baseInput, standardIds: AUTHORED, tier: 2 },
      plan: run.analysis.monitorPlan,
      monitorIds: subset,
      cadenceSeconds: 3600,
    });
    assert.deepEqual(
      partial.armed.map((entry) => entry.monitorId).sort(),
      [...subset].sort(),
    );

    const disarmed = await command({ action: "disarm_all" });
    assert.equal(disarmed.armed.length, 0);
    assert.equal(disarmed.credentialsHeld, false, "disarming must release the held tokens");
    assert.equal(disarmed.nextDueAt, null);

    // A cycle with nothing armed is refused rather than recorded as an empty success.
    await command({ action: "cycle" }, 409);

    const cleared = await command({ action: "clear_history" });
    assert.equal(cleared.cycles.length, 0);
    assert.equal(cleared.alerts.length, 0);
    assert.equal(cleared.latestResult, null);
  } finally {
    targetState.injectionGuardrail = true;
    await live("/api/monitors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "disarm_all" }),
    });
  }
});

test("each monitor is read on its own interval, not the tightest one on the board", async () => {
  const run = await runAuthored(2);
  const plan = run.analysis.monitorPlan;
  assert.ok(plan.length >= 2, "this test needs two monitors to tell two intervals apart");
  const [first, second] = plan;

  const live = await session();
  const command = async (body, expected = 200) => {
    const response = await live("/api/monitors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, expected, await response.clone().text());
    return response.json();
  };
  const read = async () => {
    const response = await live("/api/monitors");
    assert.equal(response.status, 200);
    return response.json();
  };
  const input = { ...baseInput, standardIds: AUTHORED, tier: 2 };
  const find = (state, id) => state.armed.find((entry) => entry.monitorId === id);

  try {
    // An interval can only be changed on something that has a schedule.
    await command({ action: "set_cadence", monitorId: first.id, cadenceSeconds: 60 }, 422);

    const armed = await command({
      action: "arm",
      monitorId: first.id,
      input,
      plan,
      cadenceSeconds: 86_400,
    });
    const one = find(armed, first.id);
    assert.equal(one.cadenceSeconds, 86_400);
    assert.equal(one.lastReadAt, null, "a monitor that has never run has not been read");
    // Never read means due now, so the first reading — the baseline every later
    // comparison needs — is not held back by a full interval.
    assert.ok(Date.parse(one.nextDueAt) <= Date.now() + 1000);

    const cycled = await command({ action: "cycle" });
    const read1 = find(cycled, first.id);
    assert.ok(read1.lastReadAt, "a cycle that read a monitor must record when");
    assert.equal(
      Date.parse(read1.nextDueAt) - Date.parse(read1.lastReadAt),
      86_400_000,
      "next due is measured from this monitor's own last reading",
    );
    assert.ok(read1.checksRead > 0);

    // The second monitor has never been read, so it is due immediately while the
    // first is 24 hours away. A due cycle must read exactly one of them.
    await command({ action: "arm", monitorId: second.id, input, plan, cadenceSeconds: 86_400 });
    const afterDue = await read();
    assert.equal(afterDue.cyclesRun, 2, "a monitor falling due must produce a cycle on read");
    const dueCycle = afterDue.cycles[0];
    assert.equal(dueCycle.trigger, "due");
    assert.deepEqual(
      dueCycle.monitors.map((entry) => entry.monitorId),
      [second.id],
      "a due cycle reads the monitors that are due and no others",
    );
    assert.equal(
      find(afterDue, first.id).lastReadAt,
      read1.lastReadAt,
      "a monitor left out of a cycle keeps its own clock instead of slipping an interval",
    );

    // Tightening an interval moves that monitor's own due time and nothing else.
    const tightened = await command({
      action: "set_cadence",
      monitorId: first.id,
      cadenceSeconds: 60,
    });
    const tight = find(tightened, first.id);
    assert.equal(tight.cadenceSeconds, 60);
    assert.equal(Date.parse(tight.nextDueAt) - Date.parse(tight.lastReadAt), 60_000);
    assert.equal(
      find(tightened, second.id).cadenceSeconds,
      86_400,
      "one row's interval is not every row's interval",
    );

    // The floor is the store's, not the caller's: a monitor is not a load generator.
    const floored = await command({
      action: "set_cadence",
      monitorId: second.id,
      cadenceSeconds: 1,
    });
    assert.equal(find(floored, second.id).cadenceSeconds, floored.minCadenceSeconds);

    // Arming the board in one call keeps each row's configured interval rather than
    // flattening them, and does not erase what an already-armed monitor has read.
    const cadences = Object.fromEntries(plan.map((entry, index) => [entry.id, 3600 * (index + 1)]));
    const all = await command({ action: "arm_all", input, plan, cadences });
    assert.equal(all.armed.length, plan.length);
    for (const [index, entry] of plan.entries()) {
      assert.equal(find(all, entry.id).cadenceSeconds, 3600 * (index + 1));
    }
    assert.equal(
      find(all, first.id).lastReadAt,
      read1.lastReadAt,
      "re-arming changes a monitor's settings; it does not throw away its baseline",
    );
    assert.equal(JSON.stringify(all).includes(baseInput.credentials.chatbotApiKey), false);
  } finally {
    await live("/api/monitors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "disarm_all" }),
    });
  }
});

test("no pack gives two different controls the same identifier", async () => {
  // A clause id is a join key: `checkByControl`, the pack tables and the printable report all
  // look controls up by it. Five pairs of genuinely different controls once shared an id inside
  // one pack — a Tier 2 control and a Tier 3 control — which duplicated React keys, collided in
  // the provenance map and let one control's verdict render under the other's clause. Two packs
  // MAY reuse an identifier (MAS FEAT and SOC 2 both have an A1.2); one pack may not.
  const result = await runAssessment({
    standardIds: ["iso42001", "soc2", "mas_ai", "hipaa", "nist_ai_rmf"],
    tier: 3,
    credentials: { ...baseInput.credentials, ...TIER_3_LOCATIONS },
  });
  for (const report of result.reports) {
    const seen = new Map();
    for (const control of report.controls) {
      seen.set(control.id, [...(seen.get(control.id) ?? []), control.name]);
    }
    const collisions = [...seen].filter(([, names]) => names.length > 1);
    assert.deepEqual(
      collisions,
      [],
      `${report.standardId} reuses a control id: ${JSON.stringify(collisions)}`,
    );
  }
});

test("provenance survives two packs that share a clause identifier", async () => {
  // MAS FEAT's A1.2 and SOC 2's A1.2 are different controls. An id-keyed provenance map let one
  // overwrite the other, so a directly-tested control could be reported as proxy-judged, or the
  // reverse. Re-derive each pack's split from its own controls and require the reported split to
  // match — and require the roll-up to be the sum of the parts.
  const result = await runAssessment({ standardIds: ["mas_ai", "soc2"], tier: 2 });
  const { matrix, provenance } = result.analysis;
  const shared = new Set(
    result.reports.flatMap((report) => report.controls.map((control) => control.id)),
  );
  assert.ok(shared.has("A1.2"), "Expected the shared A1.2 identifier to still be in both packs.");

  for (const row of matrix) {
    const report = result.reports.find((entry) => entry.standardId === row.standardId);
    if (!report) continue; // the always-on OWASP row has no native report
    const assessed = report.controls.filter(
      (control) => ASSESSED.has(control.status) && control.applicabilityStatus === "applicable",
    );
    assert.equal(row.provenance.assessed, assessed.length);
    assert.equal(row.provenance.direct + row.provenance.proxy, row.provenance.assessed);
  }
  assert.equal(
    provenance.assessed,
    matrix.reduce((sum, row) => sum + row.provenance.assessed, 0),
  );
  assert.equal(
    provenance.proxy,
    matrix.reduce((sum, row) => sum + row.provenance.proxy, 0),
  );
});

/* ---------------------------------------------------------------------------
 * PCI DSS 4.0.1 framework pack.
 * ------------------------------------------------------------------------- */

async function pciScope() {
  const response = await request("/api/scope", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ standardIds: ["pci_dss"], tier: 3 }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

test("PCI DSS is a versioned pack and retail suggests it first", async () => {
  const catalog = await (await request("/api/catalog")).json();
  const pci = catalog.standards.find((standard) => standard.id === "pci_dss");
  assert.equal(pci.version, "PCI DSS v4.0.1");
  assert.equal(pci.pack.release, "2026.10-draft.3");
  assert.equal(pci.pack.status, "draft");
  assert.equal(pci.pack.assuranceLevel, "readiness");
  assert.match(pci.pack.contentHash, /^fnv1a32:[0-9a-f]{8}$/);
  assert.equal(pci.totalControls, 38);
  assert.deepEqual(pci.coverage, { 1: 3, 2: 18, 3: 38 });

  const retail = catalog.industries.find((industry) => industry.id === "retail");
  assert.equal(retail.recommendations[0].standardId, "pci_dss");
});

test("PCI DSS asks no scope questions and lists only requirements Tier 3 can reach", async () => {
  // Every listed requirement applies, and none is listed that no run could judge.
  const scope = await pciScope();
  assert.equal(scope.applicable, 38);
  assert.equal(scope.notApplicable, 0);
  assert.equal(scope.unknown, 0);

  const result = await runAssessment({ standardIds: ["pci_dss"], tier: 2 });
  const pci = result.reports.find((report) => report.standardId === "pci_dss");
  assert.notEqual(pci.controls.find((control) => control.id === "A1.1.2").status, "not_applicable");
  for (const id of ["3.3.1", "6.4.3", "11.6.1", "A1.1.4"]) {
    assert.equal(pci.controls.find((control) => control.id === id), undefined);
  }
});

test("PCI DSS controls share checks with the library, so one fix closes them everywhere", async () => {
  const result = await runAssessment({ standardIds: ["pci_dss", "iso27001"], tier: 2 });
  const pci = result.reports.find((report) => report.standardId === "pci_dss");
  const iso = result.reports.find((report) => report.standardId === "iso27001");
  assert.equal(pci.controls.find((control) => control.id === "3.4.1").status,
    iso.controls.find((control) => control.name === "Sensitive-data redaction on responses").status);
  const redaction = result.analysis.playbooks.find((playbook) =>
    playbook.closes.some((entry) => entry.standardId === "pci_dss") &&
    playbook.closes.some((entry) => entry.standardId === "iso27001"),
  );
  assert.ok(redaction, "a shared failing check must produce one playbook closing both standards");
});

test("DPDP is a versioned India-wide pack suggested for every industry", async () => {
  const catalog = await (await request("/api/catalog")).json();
  const dpdp = catalog.standards.find((standard) => standard.id === "dpdp_act");
  assert.equal(dpdp.version, "DPDP Act 2023 + Rules 2025");
  assert.equal(dpdp.jurisdiction, "India");
  assert.equal(dpdp.kind, "Mandatory");
  assert.equal(dpdp.pack.release, "2026.10-draft.1");
  assert.equal(dpdp.pack.status, "draft");
  assert.equal(dpdp.pack.assuranceLevel, "readiness");
  assert.match(dpdp.pack.contentHash, /^fnv1a32:[0-9a-f]{8}$/);
  assert.equal(dpdp.totalControls, 33);
  assert.deepEqual(dpdp.coverage, { 1: 2, 2: 8, 3: 33 });

  for (const industry of catalog.industries) {
    assert.ok(
      industry.recommendations.some((entry) => entry.standardId === "dpdp_act"),
      `${industry.id} must suggest DPDP`,
    );
  }
});

test("DPDP asks no questions and Tier 3 reaches every listed obligation", async () => {
  const scopeResponse = await request("/api/scope", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ standardIds: ["dpdp_act"], tier: 3 }),
  });
  assert.equal(scopeResponse.status, 200);
  const scope = await scopeResponse.json();
  assert.equal(scope.applicable, 33);
  assert.equal(scope.notApplicable, 0);
  assert.equal(scope.unknown, 0);

  const result = await runAssessment({
    standardIds: ["dpdp_act"],
    tier: 3,
    credentials: { ...baseInput.credentials, ...TIER_3_CREDENTIALS },
  });
  const report = result.reports.find((entry) => entry.standardId === "dpdp_act");
  assert.equal(report.coveragePercent, 100);
  assert.equal(report.controls.filter((entry) => entry.status === "not_assessed").length, 0);
});
