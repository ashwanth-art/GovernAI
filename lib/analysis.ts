import { resolveCheck, unblockedBy } from "./checks";
import { domainFor, pillarLabel, pillarOrder, pillarRegistry, primaryPillar } from "./pillars";
import { buildPlaybook, fallbackSeed, playbookSeedByCheck } from "./remediation";
import { computePosture, emptySeverityCounts, isAssessed } from "./posture";
import type {
  AccessTier,
  AssessmentAnalysis,
  AssessmentResult,
  CheckExecution,
  ControlResult,
  ControlStatus,
  CoverageGap,
  DomainPosture,
  EvidenceRecordView,
  Finding,
  FrameworkMatrixRow,
  MonitorPlanEntry,
  Pillar,
  PillarPosture,
  ProvenanceSplit,
  RemediationPlaybook,
  RuleProvenance,
  Severity,
  StandardReport,
} from "./types";

/**
 * Derives the engineering-register analysis layer from a completed assessment.
 *
 * This module adds no evidence. Every status it reports is a status the engine
 * already produced; every rule it names is the rule the engine already applied.
 * Its whole job is to reorganise that output around the four questions a reader
 * actually asks: what ran, what broke, what did we miss, what do we fix.
 */

const STATUS_RANK: Record<ControlStatus, number> = {
  fail: 0,
  partial: 1,
  pass: 2,
  not_assessed: 3,
  not_applicable: 4,
};

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const OWNER_BY_PILLAR: Record<Pillar, string> = {
  trust: "Application engineering",
  security: "Platform security",
  data_protection: "Data governance",
  governance: "Engineering management",
  compliance: "Compliance",
};

const VALIDITY_DAYS: Record<string, number> = {
  chatbot_probe: 1,
  target_service: 1,
  target_trace: 1,
  target_adapter: 7,
  provider_api: 30,
  artifact_manifest: 180,
  provided_url: 7,
};

const MONITOR_CADENCE: Record<string, { label: string; minutes: number }> = {
  live_probe: { label: "every 6 hours", minutes: 360 },
  adapter_read: { label: "every 12 hours", minutes: 720 },
  provider_api: { label: "daily", minutes: 1440 },
};

/** Content digest for the evidence ledger. Not a cryptographic binding, and labelled as such in the UI. */
function digest(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function worstStatus(statuses: ControlStatus[]): ControlStatus {
  return statuses.reduce<ControlStatus>(
    (worst, status) => (STATUS_RANK[status] < STATUS_RANK[worst] ? status : worst),
    "not_applicable",
  );
}

function worstSeverity(severities: Severity[]): Severity {
  if (!severities.length) return "medium";
  return severities.reduce((worst, severity) =>
    SEVERITY_RANK[severity] < SEVERITY_RANK[worst] ? severity : worst,
  );
}

function playbookId(checkId: string): string {
  return `fix-${checkId.replace(/^chk\./, "").replace(/\./g, "-")}`;
}

const FAILURE_NARRATIVE: Record<string, { title: string; impact: string }> = {
  "chk.trust.grounding": {
    title: "Answers are returned without retrieval support",
    impact:
      "A user cannot tell a sourced answer from an unsourced one. In a regulated setting an unsupported answer presented as authoritative is the failure mode that produces harm, and the one an auditor asks about first.",
  },
  "chk.security.injection": {
    title: "Instructions in the input can override the system's rules",
    impact:
      "Anything the model has been told not to do can be re-enabled by text placed in a document or a message. Every other guardrail sits behind this one.",
  },
  "chk.data.disclosure": {
    title: "Secret-shaped content reaches the response",
    impact:
      "Credential or identifier material can leave the system inside an answer. In most regimes that is a reportable disclosure, not merely a defect.",
  },
  "chk.security.rag-combined": {
    title: "The three safety boundaries do not hold together",
    impact:
      "Two of three holding is not a safe system. A release gate that accepts partial success will ship the failing third boundary.",
  },
  "chk.compliance.monitoring": {
    title: "The monitoring contract is incomplete",
    impact:
      "Without the declared fields there is no reconstructable audit trail, so the audit-trail obligations cannot be evidenced at all.",
  },
  "chk.governance.audit-config": {
    title: "The audit configuration contract is incomplete",
    impact:
      "The data controls the system claims to enforce are not declared in a readable form, so nothing downstream can verify them.",
  },
  "chk.fallback.data-disclosure": {
    title: "The disclosure boundary did not hold",
    impact:
      "This control carries no named rule, so the disclosure probe stands in for it. The probe itself failed, which is a real signal even though the mapping is a proxy.",
  },
  "chk.fallback.security-boundary": {
    title: "A security boundary did not hold",
    impact:
      "This control carries no named rule, so the injection and disclosure probes stand in for it. One of them failed.",
  },
  "chk.fallback.trust-answer": {
    title: "The answer-quality boundary did not hold",
    impact:
      "This control carries no named rule, so grounding and out-of-scope behaviour stand in for it. One of them failed.",
  },
  "chk.fallback.service-health": {
    title: "The service or a declared dependency is unhealthy",
    impact:
      "Every downstream check inherits this. Nothing else in the run can be trusted while the target itself is degraded.",
  },
};

function narrative(checkId: string, checkTitle: string, evidence: string) {
  return FAILURE_NARRATIVE[checkId] ?? { title: `${checkTitle} did not hold`, impact: evidence };
}

/**
 * A partially met control is a real gap with a real fix, so it becomes a finding.
 * It is deliberately ranked one step below the same check failing outright: the
 * control is doing something, just not enough, and the queue should say so.
 */
const ONE_STEP_LOWER: Record<Severity, Severity> = {
  critical: "high",
  high: "medium",
  medium: "low",
  low: "low",
};

type Owned = { report: StandardReport | null; control: ControlResult };

export interface AnalysisSource {
  tier: AccessTier;
  reports: StandardReport[];
  owasp: ControlResult[];
  liveEvidence: {
    probes: AssessmentResult["liveEvidence"]["probes"];
    startedAt: string;
  };
  /** Procedure ids the run actually loaded evidence for. Mirrors combineProcedureEvidence(). */
  availableProcedureIds: string[];
}

export function buildAnalysis(source: AnalysisSource): AssessmentAnalysis {
  const { tier, reports, owasp, liveEvidence } = source;
  const availableProcedures = new Set(source.availableProcedureIds);
  const owned: Owned[] = [
    ...reports.flatMap((report) => report.controls.map((control) => ({ report, control }))),
    ...owasp.map((control) => ({ report: null as StandardReport | null, control })),
  ];
  const allControls = owned.map((entry) => entry.control);
  const controlById = new Map(allControls.map((control) => [control.id, control]));
  const probeById = new Map(liveEvidence.probes.map((probe) => [probe.id, probe]));

  /** True when the run loaded evidence for at least one of this control's named procedures. */
  const hasNamedEvidence = (control: ControlResult) =>
    (control.evidenceProcedureIds ?? []).some((id) => availableProcedures.has(id));

  /* ---------- checks: what ran, and under which rule ---------- */
  const grouped = new Map<string, { check: ReturnType<typeof resolveCheck>; entries: Owned[] }>();
  for (const entry of owned) {
    if (entry.control.applicabilityStatus === "not_applicable") continue;
    const check = resolveCheck(entry.control, {
      hasNamedEvidence: hasNamedEvidence(entry.control),
    });
    const bucket = grouped.get(check.id);
    if (bucket) bucket.entries.push(entry);
    else grouped.set(check.id, { check, entries: [entry] });
  }

  const checks: CheckExecution[] = [...grouped.values()]
    .map(({ check, entries }) => {
      const controls = entries.map((entry) => entry.control);
      const applicable = entries.filter(
        (entry) => entry.control.applicabilityStatus === "applicable",
      );
      const evaluated = applicable.filter((entry) => isAssessed(entry.control));
      const ran = evaluated.length > 0;
      const status: ControlStatus = ran
        ? worstStatus(evaluated.map((entry) => entry.control.status))
        : "not_assessed";
      const representative = (evaluated[0] ?? applicable[0] ?? entries[0]).control;
      const probe = check.probeId ? probeById.get(check.probeId) : undefined;

      const observations: Array<{ key: string; value: string }> = [];
      if (probe) {
        if (probe.httpStatus !== undefined)
          observations.push({ key: "http status", value: String(probe.httpStatus) });
        if (probe.latencyMs !== undefined)
          observations.push({ key: "latency", value: `${probe.latencyMs} ms` });
        if (probe.sourceCount !== undefined)
          observations.push({ key: "sources returned", value: String(probe.sourceCount) });
        if (probe.bestSourceScore !== undefined)
          observations.push({ key: "best source score", value: probe.bestSourceScore.toFixed(2) });
        if (probe.requestId) observations.push({ key: "request id", value: probe.requestId });
        observations.push({ key: "probe verdict", value: probe.status });
      }
      observations.push({ key: "controls governed", value: String(controls.length) });
      observations.push({ key: "executed", value: ran ? "yes" : "no" });

      return {
        ...check,
        status,
        ran,
        notRunReason: ran ? "" : representative.evidence,
        closedBy: ran ? "" : unblockedBy(check),
        evidence: representative.evidence,
        confidence: representative.confidence,
        latencyMs: probe?.latencyMs,
        httpStatus: probe?.httpStatus,
        requestId: probe?.requestId,
        observations,
        controls: entries.map((entry) => ({
          standardId: entry.report?.standardId ?? "owasp_llm_2025",
          shortName: entry.report?.shortName ?? "OWASP LLM",
          controlId: entry.control.id,
          controlName: entry.control.name,
          section: entry.control.sourceCitation?.section,
        })),
        severity: worstSeverity(
          controls.map((control) => (control.severity ?? "medium") as Severity),
        ),
      } satisfies CheckExecution;
    })
    .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.id.localeCompare(b.id));

  /**
   * Which kind of rule judged each control, and a roll-up of that at any altitude.
   *
   * `resolveCheck` silently substitutes a pillar-level proxy when no rule exists for a control.
   * The proxy rules say so in their own titles and thresholds, but that only helps a reader who
   * opens one control. Summing it is what turns a per-control footnote into a number a reviewer
   * can act on — and only assessed controls are counted, because an unjudged control was not
   * judged by anything.
   */
  /* Keyed on the control object, not on `control.id`. Two packs may legitimately use the same
     clause identifier — MAS FEAT and SOC 2 both have an `A1.2` — and an id-keyed map would let
     one pack's provenance overwrite the other's. Every consumer below filters the same object
     instances this map was built from, so identity is both exact and cheaper. */
  const provenanceByControl = new Map<ControlResult, RuleProvenance>();
  for (const { check, entries } of grouped.values()) {
    for (const entry of entries) provenanceByControl.set(entry.control, check.provenance);
  }
  const splitProvenance = (controls: ControlResult[]): ProvenanceSplit => {
    const assessed = controls.filter(isAssessed);
    const proxy = assessed.filter((control) => provenanceByControl.get(control) === "proxy").length;
    return { direct: assessed.length - proxy, proxy, assessed: assessed.length };
  };

  /* ---------- findings: one per failing or partially met check ---------- */
  const findings: Finding[] = checks
    .filter((check) => check.status === "fail" || check.status === "partial")
    .map((check) => {
      const partial = check.status === "partial";
      const target = partial ? "partial" : "fail";
      const matching = check.controls.filter(
        (entry) => controlById.get(entry.controlId)?.status === target,
      );
      const breaches = matching.length ? matching : check.controls;
      const pillars = new Set<Pillar>();
      const severities: Severity[] = [];
      breaches.forEach((entry) => {
        const control = controlById.get(entry.controlId);
        if (!control) return;
        severities.push((control.severity ?? "medium") as Severity);
        control.pillars.forEach((pillar) => pillars.add(pillar));
      });
      const text = narrative(check.id, check.title, check.evidence);
      const worst = worstSeverity(severities);
      return {
        id: "",
        title: partial ? `${check.title} is only partially met` : text.title,
        detail: check.evidence,
        impact: partial
          ? `The control is doing part of its job but not enough to pass. ${check.evidence}`
          : text.impact,
        severity: partial ? ONE_STEP_LOWER[worst] : worst,
        pillar: check.pillar,
        domainId: check.domainId,
        owner: OWNER_BY_PILLAR[check.pillar],
        detectedBy: [check.id],
        breaches,
        blastRadius: {
          controls: breaches.length,
          standards: new Set(breaches.map((entry) => entry.standardId)).size,
          pillars: [...pillars],
        },
        remediationId: playbookId(check.id),
        closesWhen: `Closes when ${check.id} passes on a later run. It cannot be closed by hand.`,
      } satisfies Finding;
    })
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        b.blastRadius.controls - a.blastRadius.controls,
    )
    .map((finding, index) => ({ ...finding, id: `FND-${String(index + 1).padStart(3, "0")}` }));

  /* ---------- gaps: applicable but not assessed, with what would close each ---------- */
  const gaps: CoverageGap[] = owned
    .filter(
      (entry) =>
        entry.control.applicabilityStatus === "applicable" &&
        entry.control.status === "not_assessed",
    )
    .map((entry) => {
      const check = resolveCheck(entry.control, { hasNamedEvidence: false });
      return {
        controlId: entry.control.id,
        controlName: entry.control.name,
        standardId: entry.report?.standardId ?? "owasp_llm_2025",
        shortName: entry.report?.shortName ?? "OWASP LLM",
        pillar: primaryPillar(entry.control),
        tierMinimum: entry.control.tierMinimum,
        reason: entry.control.evidence,
        closedBy: unblockedBy(check),
      } satisfies CoverageGap;
    })
    .sort((a, b) => a.tierMinimum - b.tierMinimum || a.standardId.localeCompare(b.standardId));

  /* ---------- playbooks: ranked by controls closed per hour of effort ---------- */
  const playbookGroups = new Map<string, Finding[]>();
  findings.forEach((finding) => {
    const key = finding.detectedBy[0];
    playbookGroups.set(key, [...(playbookGroups.get(key) ?? []), finding]);
  });
  const playbooks: RemediationPlaybook[] = [...playbookGroups.entries()]
    .map(([checkId, group]) => {
      const check = checks.find((candidate) => candidate.id === checkId);
      const seed =
        playbookSeedByCheck.get(checkId) ?? fallbackSeed(checkId, check?.title ?? checkId);
      const closes = group.flatMap((finding) =>
        finding.breaches.map((entry) => ({
          standardId: entry.standardId,
          shortName: entry.shortName,
          controlId: entry.controlId,
        })),
      );
      return buildPlaybook(seed, {
        findingIds: group.map((finding) => finding.id),
        closes,
        severity: worstSeverity(group.map((finding) => finding.severity)),
      });
    })
    .sort((a, b) => b.rank - a.rank || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  /* ---------- posture: three numbers, one verdict ---------- */
  const severityCounts = emptySeverityCounts();
  findings.forEach((finding) => {
    severityCounts[finding.severity] += 1;
  });
  const posture = computePosture({
    controls: allControls,
    severityCounts,
    openFindings: findings.length,
  });

  /* ---------- pillars and their domains ---------- */
  const pillars: PillarPosture[] = pillarRegistry.map((definition) => {
    const pillar = definition.pillar;
    const pillarControls = allControls.filter((control) => control.pillars.includes(pillar));
    const applicableControls = pillarControls.filter(
      (control) => control.applicabilityStatus === "applicable",
    );
    const assessedControls = applicableControls.filter(isAssessed);
    const pillarChecks = checks.filter((check) => check.pillar === pillar);
    const pillarFindings = findings.filter((finding) => finding.pillar === pillar);
    const counts = emptySeverityCounts();
    pillarFindings.forEach((finding) => {
      counts[finding.severity] += 1;
    });

    const domains: DomainPosture[] = [];
    for (const domain of definition.domains) {
      const domainControls = applicableControls.filter(
        (control) => domainFor(pillar, control).id === domain.id,
      );
      const domainChecks = pillarChecks.filter((check) => check.domainId === domain.id);
      if (!domainControls.length && !domainChecks.length) continue;
      domains.push({
        id: domain.id,
        label: domain.label,
        question: domain.question,
        checksRan: domainChecks.filter((check) => check.ran).length,
        checksTotal: domainChecks.length,
        status: domainChecks.length
          ? worstStatus(domainChecks.map((check) => check.status))
          : "not_assessed",
        findings: pillarFindings.filter((finding) => finding.domainId === domain.id).length,
      });
    }

    return {
      pillar,
      key: pillar,
      label: pillarLabel(pillar),
      question: definition.question,
      hue: definition.hue,
      applicable: applicableControls.length,
      assessed: assessedControls.length,
      coveragePercent: applicableControls.length
        ? Math.round((assessedControls.length / applicableControls.length) * 100)
        : 0,
      healthPercent: assessedControls.length
        ? Math.round(
            (assessedControls.reduce((sum, control) => sum + control.score, 0) /
              assessedControls.length) *
              100,
          )
        : 0,
      checksRan: pillarChecks.filter((check) => check.ran).length,
      checksTotal: pillarChecks.length,
      provenance: splitProvenance(applicableControls),
      severityCounts: counts,
      domains,
    } satisfies PillarPosture;
  });

  /* ---------- framework × pillar matrix ---------- */
  const matrix: FrameworkMatrixRow[] = reports.map((report) => {
    const assessedControls = report.controls.filter(
      (control) => control.applicabilityStatus === "applicable" && isAssessed(control),
    );
    return {
      standardId: report.standardId,
      shortName: report.shortName,
      readiness: report.readiness,
      coveragePercent: report.coveragePercent ?? 0,
      healthPercent: report.score,
      applicable: report.applicableControls ?? 0,
      assessed: report.assessedControls,
      excluded: report.notApplicableControls ?? 0,
      unknown: report.unknownApplicabilityControls ?? 0,
      packRelease: report.packRelease,
      provenance: splitProvenance(
        report.controls.filter((control) => control.applicabilityStatus === "applicable"),
      ),
      cells: pillarOrder.map((pillar) => {
        const inPillar = report.controls.filter(
          (control) =>
            control.pillars.includes(pillar) && control.applicabilityStatus === "applicable",
        );
        const done = assessedControls.filter((control) => control.pillars.includes(pillar));
        return {
          pillar,
          applicable: inPillar.length,
          assessed: done.length,
          coveragePercent: inPillar.length ? Math.round((done.length / inPillar.length) * 100) : 0,
        };
      }),
    } satisfies FrameworkMatrixRow;
  });

  /**
   * The always-on OWASP LLM pack gets a row of its own.
   *
   * Its controls have always counted toward `posture` but never appeared in this table, so the
   * summary strip read 147 applicable while the table added up to 137 — a ten-control gap with
   * no explanation on any screen. It is also a real capability that was invisible: every run
   * assesses it whether or not anyone selected it.
   */
  if (owasp.length) {
    const applicable = owasp.filter((control) => control.applicabilityStatus === "applicable");
    const assessed = applicable.filter(isAssessed);
    const passed = assessed.filter((control) => control.status === "pass").length;
    matrix.push({
      standardId: "owasp_llm_2025",
      shortName: "OWASP LLM Top 10",
      readiness: assessed.length
        ? passed === assessed.length
          ? "Assessed — no gap found"
          : "Remediation required"
        : "Insufficient evidence",
      coveragePercent: applicable.length
        ? Math.round((assessed.length / applicable.length) * 100)
        : 0,
      healthPercent: assessed.length ? Math.round((passed / assessed.length) * 100) : 0,
      applicable: applicable.length,
      assessed: assessed.length,
      excluded: owasp.filter((control) => control.applicabilityStatus === "not_applicable").length,
      unknown: owasp.filter((control) => control.applicabilityStatus === "unknown").length,
      packRelease: "always on — not a selection",
      provenance: splitProvenance(applicable),
      cells: pillarOrder.map((pillar) => {
        const inPillar = applicable.filter((control) => control.pillars.includes(pillar));
        const done = assessed.filter((control) => control.pillars.includes(pillar));
        return {
          pillar,
          applicable: inPillar.length,
          assessed: done.length,
          coveragePercent: inPillar.length ? Math.round((done.length / inPillar.length) * 100) : 0,
        };
      }),
    });
  }

  /* ---------- evidence ledger ---------- */
  const checksByProbe = new Map<string, number>();
  checks.forEach((check) => {
    if (!check.probeId) return;
    checksByProbe.set(check.probeId, (checksByProbe.get(check.probeId) ?? 0) + 1);
  });
  const evidence: EvidenceRecordView[] = liveEvidence.probes.map((probe) => ({
    id: probe.id,
    label: probe.label,
    sourceType: probe.sourceType,
    method: probe.method,
    endpoint: probe.endpoint,
    status: probe.status,
    httpStatus: probe.httpStatus,
    latencyMs: probe.latencyMs,
    requestId: probe.requestId,
    collectedAt: liveEvidence.startedAt,
    validityDays: VALIDITY_DAYS[probe.sourceType] ?? 7,
    freshness: "fresh",
    digest: digest(`${probe.id}:${probe.endpoint}:${probe.summary}`),
    usedByChecks: checksByProbe.get(probe.id) ?? 0,
    summary: probe.summary,
  }));

  /* ---------- monitor plan: what can be re-verified, and what that costs ---------- */
  const monitorGroups = new Map<string, CheckExecution[]>();
  checks
    .filter((check) => check.ran && MONITOR_CADENCE[check.method])
    .forEach((check) => {
      const key = `${check.pillar}:${check.method}`;
      monitorGroups.set(key, [...(monitorGroups.get(key) ?? []), check]);
    });
  const monitorPlan: MonitorPlanEntry[] = [...monitorGroups.entries()].map(([key, group]) => {
    const [pillar, method] = key.split(":") as [Pillar, MonitorPlanEntry["method"]];
    const cadence = MONITOR_CADENCE[method];
    return {
      id: `mon.${pillar}.${method}`,
      label: `${pillarLabel(pillar)} · ${method.replace(/_/g, " ")} re-verification`,
      pillar,
      cadence: cadence.label,
      cadenceMinutes: cadence.minutes,
      method,
      checkIds: group.map((check) => check.id),
      requestsPerMonth: Math.round((43200 / cadence.minutes) * group.length),
      armingCost:
        "Arming keeps this run's read-only tokens in the server's memory until you disarm, " +
        "and spends the requests above against your system on every cycle.",
    } satisfies MonitorPlanEntry;
  });

  const ran = checks.filter((check) => check.ran).length;
  const notes = [
    `Derived from ${allControls.length} control results across ${reports.length} framework pack(s) plus the OWASP appendix.`,
    `${checks.length} distinct rules were resolved; ${ran} executed at tier ${tier}.`,
    "No status here is invented. Every check status is the status the engine produced for the controls that rule governs.",
    "Monitors re-run these same checks on a cadence. History lives in the server process only, so a restart resets it.",
    "Official standards pages were not fetched. Citations are recorded reference links.",
  ];

  return {
    register: "engineering",
    posture,
    pillars,
    checks,
    findings,
    gaps,
    playbooks,
    matrix,
    provenance: splitProvenance(
      allControls.filter((control) => control.applicabilityStatus === "applicable"),
    ),
    evidence,
    monitorPlan,
    notes,
  };
}
