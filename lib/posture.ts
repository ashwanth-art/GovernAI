import type { ControlResult, PostureNumbers, Severity } from "./types";

/**
 * Three numbers, one verdict.
 *
 * Nothing here invents a blended "compliance %". Coverage answers "how much of
 * the applicable set did we see", health answers "how good was what we saw",
 * and exposure answers "how bad is what is open". A reader needs all three;
 * any one of them alone is misleading, which is why the UI never shows one
 * without the others.
 */

export const severityWeights: Record<Severity, number> = {
  critical: 40,
  high: 15,
  medium: 5,
  low: 1,
};

const EXPOSURE_SCALE = 60;

export function emptySeverityCounts(): Record<Severity, number> {
  return { critical: 0, high: 0, medium: 0, low: 0 };
}

export function exposureIndex(counts: Record<Severity, number>): number {
  const weighted =
    counts.critical * severityWeights.critical +
    counts.high * severityWeights.high +
    counts.medium * severityWeights.medium +
    counts.low * severityWeights.low;
  if (weighted === 0) return 0;
  return Math.round(100 * (1 - Math.exp(-weighted / EXPOSURE_SCALE)));
}

export function isAssessed(control: Pick<ControlResult, "status">): boolean {
  return !["not_assessed", "not_applicable"].includes(control.status);
}

export interface PostureInput {
  controls: ControlResult[];
  severityCounts: Record<Severity, number>;
  openFindings: number;
}

export function computePosture({
  controls,
  severityCounts,
  openFindings,
}: PostureInput): PostureNumbers {
  const applicableControls = controls.filter((control) => control.applicabilityStatus === "applicable");
  const unknown = controls.filter((control) => control.applicabilityStatus === "unknown").length;
  const notApplicable = controls.filter(
    (control) => control.applicabilityStatus === "not_applicable",
  ).length;
  const assessedControls = applicableControls.filter(isAssessed);
  const applicable = applicableControls.length;
  const assessed = assessedControls.length;
  const coveragePercent = applicable ? Math.round((assessed / applicable) * 100) : 0;
  const healthPercent = assessed
    ? Math.round((assessedControls.reduce((sum, control) => sum + control.score, 0) / assessed) * 100)
    : 0;
  const failures = assessedControls.filter((control) => control.status === "fail").length;
  const exposure = exposureIndex(severityCounts);

  let verdict = "conditionally_ready";
  let verdictReason = "";
  if (applicable === 0 && notApplicable > 0 && unknown === 0) {
    verdict = "not_applicable";
    verdictReason = `All ${notApplicable} controls were excluded by the applicability engine, each with a recorded reason.`;
  } else if (unknown > 0) {
    verdict = "applicability_incomplete";
    verdictReason = `${unknown} controls have unresolved applicability. Nothing was scored on a guess.`;
  } else if (severityCounts.critical > 0) {
    verdict = "remediation_required";
    verdictReason = `${severityCounts.critical} critical finding${severityCounts.critical === 1 ? "" : "s"} open. Critical failures override coverage.`;
  } else if (coveragePercent < 90) {
    verdict = "insufficient_evidence";
    verdictReason = `Only ${assessed} of ${applicable} applicable controls could be assessed (${coveragePercent}%). ${applicable - assessed} are reported not_assessed, never as passing.`;
  } else if (failures === 0 && healthPercent >= 90) {
    verdict = "ready";
    verdictReason = `${assessed} of ${applicable} applicable controls assessed with no failures and ${healthPercent}% health.`;
  } else {
    verdictReason = `${failures} assessed control${failures === 1 ? "" : "s"} failed at ${healthPercent}% health.`;
  }

  return {
    applicable,
    assessed,
    notAssessed: applicable - assessed,
    notApplicable,
    coveragePercent,
    healthPercent,
    exposureIndex: exposure,
    severityCounts,
    openFindings,
    verdict,
    verdictReason,
  };
}

/**
 * The verdict is a heading and an identifier at the same time, and those two jobs
 * want different words. As a heading it is the first line a reader lands on, so it
 * is written to be read; the token stays alongside it, verbatim, because that is
 * what appears in the exported JSON and in the API response. Printing only the
 * token made the loudest line in the report the one thing on the page nobody
 * outside the codebase can parse.
 */
export const verdictLabels: Record<string, string> = {
  ready: "Ready",
  conditionally_ready: "Conditionally ready",
  remediation_required: "Remediation required",
  insufficient_evidence: "Not enough evidence to judge",
  applicability_incomplete: "Applicability unresolved",
  not_applicable: "Nothing in scope applied",
};

export const verdictTone: Record<string, "pass" | "partial" | "fail"> = {
  ready: "pass",
  conditionally_ready: "partial",
  remediation_required: "fail",
  insufficient_evidence: "partial",
  applicability_incomplete: "partial",
  not_applicable: "partial",
};
