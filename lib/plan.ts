import { evaluateControlApplicability } from "./applicability";
import { standardById } from "./catalog";
import { resolveCheck, unblockedBy } from "./checks";
import { pillarLabel, pillarOrder } from "./pillars";
import type {
  AccessTier,
  ApplicabilityProfile,
  AssessmentInput,
  CheckDefinition,
  CheckPlan,
  Control,
  Pillar,
} from "./types";

/**
 * The pre-flight plan.
 *
 * Answers three questions before a single request is sent: what will run, what
 * will not run and why, and how much of the applicable control set each tier
 * can actually reach. A client who reads this page cannot later be surprised by
 * the coverage number, because they agreed to it in advance.
 */

const TIER_LABEL: Record<AccessTier, string> = {
  1: "Tier 1 — black box",
  2: "Tier 2 — authorized reads",
  3: "Tier 3 — artifacts and provider APIs",
};

/** Per-check wall-clock budget, matched to the engine's paced probe steps. */
const SECONDS_PER_CHECK: Record<string, number> = {
  live_probe: 2,
  adapter_read: 1.5,
  provider_api: 2,
  named_artifact: 0.2,
  declared_scope: 0.05,
  not_supported: 0,
};

export const SAFETY_RULES = [
  "Every probe is a single bounded request. No repetition, no chaining, no load generation.",
  "Reads only. No write, delete, or state-changing request is ever issued against the target.",
  "Tier 2 and Tier 3 requests are sent only to hosts you entered, and only with tokens you supplied.",
  "Credentials are held for the duration of the run and never written to an event, a log, a report, or an export.",
  "A 401 or 403 is recorded as missing authorization, never as a control failure.",
  "Probe responses are pattern-matched for verdicts. Response bodies are not stored.",
  "Official standards pages are never fetched during a run. Citations are recorded reference links.",
];

/**
 * What the run has access to, expressed without any secret value.
 *
 * The pre-flight endpoint takes this instead of a credential bag, so planning a
 * run never requires sending a token to the server.
 */
export interface AccessSignals {
  hasEvidenceManifest?: boolean;
  repoHost?: string;
  monitoringProvider?: string;
  hasMonitoringKey?: boolean;
}

/**
 * The number of bounded requests a run will issue. `runAssessment` uses this
 * too, so the plan the client approves and the run the engine performs cannot
 * drift.
 */
export function boundedRequestCount(tier: AccessTier, access: AccessSignals = {}): number {
  const base = tier === 1 ? 5 : tier === 2 ? 8 : 11;
  if (tier < 3) return base;
  return (
    base +
    (access.hasEvidenceManifest ? 1 : 0) +
    (/github\.com/i.test(access.repoHost ?? "") ? 1 : 0) +
    (/datadog|grafana/i.test(access.monitoringProvider ?? "") && access.hasMonitoringKey ? 1 : 0)
  );
}

export function accessSignalsFromCredentials(
  credentials: Record<string, string> = {},
): AccessSignals {
  return {
    hasEvidenceManifest: Boolean(credentials.evidenceManifestUrl?.trim()),
    repoHost: credentials.repoUrl ?? "",
    monitoringProvider: credentials.monitoringProvider ?? "",
    hasMonitoringKey: Boolean(credentials.providerMonitoringApiKey?.trim()),
  };
}

export function expectedLiveChecks(input: Pick<AssessmentInput, "tier" | "credentials">): number {
  return boundedRequestCount(input.tier, accessSignalsFromCredentials(input.credentials));
}

/**
 * Per pack, how many of its controls have a rule written for them — known without running.
 *
 * Measured at best-case depth (Tier 3 with a manifest), so the number is the ceiling: a pack
 * showing proxies here will show at least that many at any lower tier. This is what lets the
 * picker say `native mapping` or `N by proxy` at selection time, instead of a reader discovering
 * after the run that a pack's verdicts came from pillar-level stand-ins.
 */
export const packProvenance = new Map<string, { direct: number; proxy: number }>(
  [...standardById.values()].map((standard) => {
    let direct = 0;
    let proxy = 0;
    for (const control of standard.controls) {
      if (resolveCheck(control, { hasNamedEvidence: true }).provenance === "proxy") proxy += 1;
      else direct += 1;
    }
    return [standard.id, { direct, proxy }];
  }),
);

export interface PlanInput {
  standardIds: string[];
  tier: AccessTier;
  applicability: ApplicabilityProfile;
  access?: AccessSignals;
}

interface Scoped {
  control: Control;
  standardId: string;
  shortName: string;
  applicable: boolean;
  unknown: boolean;
}

function scopeControls(input: PlanInput): Scoped[] {
  return input.standardIds.flatMap((standardId) => {
    const standard = standardById.get(standardId);
    if (!standard) return [];
    return standard.controls.map((control) => {
      const verdict = evaluateControlApplicability(control, input.applicability);
      return {
        control,
        standardId,
        shortName: standard.shortName,
        applicable: verdict.status === "applicable",
        unknown: verdict.status === "unknown",
      };
    });
  });
}

export function buildCheckPlan(input: PlanInput): CheckPlan {
  const hasManifest = Boolean(input.access?.hasEvidenceManifest);
  const scoped = scopeControls(input);
  const inScope = scoped.filter((entry) => entry.applicable || entry.unknown);

  /* ---------- which check governs each control, and will it run ---------- */
  const grouped = new Map<string, { check: CheckDefinition; controls: Scoped[] }>();
  for (const entry of inScope) {
    const check = resolveCheck(entry.control, { hasNamedEvidence: hasManifest });
    const bucket = grouped.get(check.id);
    if (bucket) bucket.controls.push(entry);
    else grouped.set(check.id, { check, controls: [entry] });
  }

  const checks = [...grouped.values()]
    .map(({ check, controls }) => {
      const willRun = check.tierMinimum <= input.tier && check.method !== "not_supported";
      return {
        ...check,
        willRun,
        notRunReason: willRun
          ? ""
          : check.method === "not_supported"
            ? "No rule exists for this check. It is listed so the gap stays visible."
            : `Needs Tier ${check.tierMinimum} access. You selected Tier ${input.tier}.`,
        controlCount: controls.length,
      };
    })
    .sort(
      (a, b) =>
        Number(b.willRun) - Number(a.willRun) ||
        a.tierMinimum - b.tierMinimum ||
        b.controlCount - a.controlCount,
    );

  const runnableChecks = checks.filter((check) => check.willRun).length;

  /* ---------- coverage forecast, per tier and per pillar ---------- */
  const applicableOnly = scoped.filter((entry) => entry.applicable);
  const forecast = ([1, 2, 3] as AccessTier[]).map((tier) => {
    const byPillar = pillarOrder.map((pillar) => {
      const inPillar = applicableOnly.filter((entry) => entry.control.pillars.includes(pillar));
      const reachable = inPillar.filter((entry) => entry.control.tierMinimum <= tier);
      return {
        pillar,
        label: pillarLabel(pillar),
        reachable: reachable.length,
        applicable: inPillar.length,
        percent: inPillar.length ? Math.round((reachable.length / inPillar.length) * 100) : 0,
      };
    });
    const reachable = applicableOnly.filter((entry) => entry.control.tierMinimum <= tier).length;
    return {
      tier,
      label: TIER_LABEL[tier],
      byPillar,
      reachable,
      applicable: applicableOnly.length,
      percent: applicableOnly.length
        ? Math.round((reachable / applicableOnly.length) * 100)
        : 0,
    };
  });

  /* ---------- blind spots: what this tier cannot see, grouped by cause ---------- */
  const unreachable = applicableOnly.filter((entry) => entry.control.tierMinimum > input.tier);
  const blindSpotBuckets = new Map<string, { controls: number; closedBy: string }>();
  for (const entry of unreachable) {
    const check = resolveCheck(entry.control, { hasNamedEvidence: hasManifest });
    const reason = `Requires Tier ${entry.control.tierMinimum} access (${check.method.replace(/_/g, " ")}).`;
    const bucket = blindSpotBuckets.get(reason);
    if (bucket) bucket.controls += 1;
    else blindSpotBuckets.set(reason, { controls: 1, closedBy: unblockedBy(check) });
  }
  const unknownCount = scoped.filter((entry) => entry.unknown).length;
  if (unknownCount) {
    blindSpotBuckets.set(
      `${unknownCount} control${unknownCount === 1 ? "" : "s"} have unresolved applicability, so nothing will be scored against them.`,
      {
        controls: unknownCount,
        closedBy: "Answer the outstanding questions on the What applies page.",
      },
    );
  }
  // Only count unsupported rules that actually govern a control in this scope.
  const unsupported = checks.filter((check) => check.method === "not_supported");
  if (unsupported.length) {
    blindSpotBuckets.set(
      `${unsupported.length} check${unsupported.length === 1 ? "" : "s"} have no rule at any tier and can never pass.`,
      {
        controls: unsupported.length,
        closedBy: "Requires a target-side signal that does not exist yet. No tier closes this.",
      },
    );
  }
  const blindSpots = [...blindSpotBuckets.entries()]
    .map(([reason, value]) => ({ reason, ...value }))
    .sort((a, b) => b.controls - a.controls);

  /* ---------- wall clock and request count ----------
     The estimate is the live requests plus a fixed allowance for everything local:
     control mapping, paced rule evaluation and roll-up. It used to add 0.05s per
     in-scope control, which charged ~7s of imaginary wall clock to arithmetic that
     completes in milliseconds — and grew that lie with every pack selected, so
     widening scope appeared to make the run longer when it does not. */
  const boundedRequests = boundedRequestCount(input.tier, input.access);
  const LOCAL_SECONDS = 3;
  const estimatedSeconds = Math.max(
    3,
    Math.round(
      checks
        .filter((check) => check.willRun)
        .reduce((sum, check) => sum + (SECONDS_PER_CHECK[check.method] ?? 1), 0) +
        LOCAL_SECONDS,
    ),
  );

  return {
    tier: input.tier,
    totalChecks: checks.length,
    runnableChecks,
    blockedChecks: checks.length - runnableChecks,
    applicableControls: applicableOnly.length,
    reachableControls: applicableOnly.filter((entry) => entry.control.tierMinimum <= input.tier)
      .length,
    estimatedSeconds,
    boundedRequests,
    forecast,
    checks,
    blindSpots,
    safety: SAFETY_RULES,
  };
}

/** Applicable-control counts per pillar, used by the What applies page before any run. */
export function scopeSummary(input: PlanInput): {
  applicable: number;
  notApplicable: number;
  unknown: number;
  byPillar: Array<{ pillar: Pillar; label: string; applicable: number }>;
  byStandard: Array<{
    standardId: string;
    shortName: string;
    applicable: number;
    notApplicable: number;
    unknown: number;
    exclusions: Array<{ controlId: string; controlName: string; reason: string }>;
  }>;
} {
  const scoped = scopeControls(input);
  const byStandard = input.standardIds
    .map((standardId) => {
      const standard = standardById.get(standardId);
      if (!standard) return null;
      const entries = scoped.filter((entry) => entry.standardId === standardId);
      return {
        standardId,
        shortName: standard.shortName,
        applicable: entries.filter((entry) => entry.applicable).length,
        notApplicable: entries.filter((entry) => !entry.applicable && !entry.unknown).length,
        unknown: entries.filter((entry) => entry.unknown).length,
        exclusions: entries
          .filter((entry) => !entry.applicable && !entry.unknown)
          .map((entry) => ({
            controlId: entry.control.id,
            controlName: entry.control.name,
            reason: evaluateControlApplicability(entry.control, input.applicability).reason,
          })),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  return {
    applicable: scoped.filter((entry) => entry.applicable).length,
    notApplicable: scoped.filter((entry) => !entry.applicable && !entry.unknown).length,
    unknown: scoped.filter((entry) => entry.unknown).length,
    // A control counts in every area it is tagged with, exactly as the tier
    // forecast and the area pages count it. The parts therefore sum to more than
    // the total, and the UI says so rather than hiding the overlap.
    byPillar: pillarOrder.map((pillar) => ({
      pillar,
      label: pillarLabel(pillar),
      applicable: scoped.filter((entry) => entry.applicable && entry.control.pillars.includes(pillar))
        .length,
    })),
    byStandard,
  };
}
