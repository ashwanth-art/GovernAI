import { primaryPillar } from "./pillars";
import { tierLabel } from "./terms";
import type { AssessmentResult, ControlResult, Pillar, Severity } from "./types";

/**
 * The high-stakes view of a result.
 *
 * Every area and every pack carries a handful of critical- and high-severity
 * checks — the ones a breach, a regulator, or an auditor would look at first.
 * This lists them with what each one guards against and what the run found:
 * a weakness it caught, a safeguard it verified, or a check the access level
 * did not reach. Nothing here judges anything; each outcome is read straight
 * from the status the engine already produced, so a "caught" is always a real
 * failing rule and a "held" is always a real pass.
 */

export type StakeOutcome = "caught" | "held" | "unreached";

export interface StakeItem {
  key: string;
  title: string;
  /** What a failure here would expose. */
  why: string;
  severity: Severity;
  pillar: Pillar;
  outcome: StakeOutcome;
  /** The finding raised, when the check caught something. */
  finding?: string;
  /** The clause cited, on a pack's view. */
  clause?: string;
  /** What would bring an unreached check into reach. */
  reach?: string;
}

export interface StakeSummary {
  items: StakeItem[];
  caught: number;
  criticalCaught: number;
  held: number;
  unreached: number;
}

const HIGH_STAKES = new Set<Severity>(["critical", "high"]);
const OUTCOME_RANK: Record<StakeOutcome, number> = { caught: 0, held: 1, unreached: 2 };
const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function outcomeOf(status: string): StakeOutcome {
  if (status === "fail" || status === "partial") return "caught";
  if (status === "pass") return "held";
  return "unreached";
}

function summarize(items: StakeItem[]): StakeSummary {
  items.sort(
    (a, b) =>
      OUTCOME_RANK[a.outcome] - OUTCOME_RANK[b.outcome] ||
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.title.localeCompare(b.title),
  );
  return {
    items,
    caught: items.filter((item) => item.outcome === "caught").length,
    criticalCaught: items.filter((item) => item.outcome === "caught" && item.severity === "critical")
      .length,
    held: items.filter((item) => item.outcome === "held").length,
    unreached: items.filter((item) => item.outcome === "unreached").length,
  };
}

/** One area: its critical and high-severity rules, across every selected pack. */
export function stakesForPillar(result: AssessmentResult, pillar: Pillar): StakeSummary {
  const { analysis } = result;
  return summarize(
    analysis.checks
      .filter((check) => check.pillar === pillar && HIGH_STAKES.has(check.severity))
      .map((check) => {
        const outcome = check.ran ? outcomeOf(check.status) : "unreached";
        return {
          key: check.id,
          title: check.title,
          why: check.intent,
          severity: check.severity,
          pillar,
          outcome,
          finding:
            outcome === "caught"
              ? analysis.findings.find((finding) => finding.detectedBy.includes(check.id))?.title
              : undefined,
          reach:
            outcome === "unreached"
              ? check.ran
                ? "Ran, but the target gave no evidence to judge"
                : `Needs ${tierLabel(check.tierMinimum)}`
              : undefined,
        };
      }),
  );
}

/** One pack: its own critical and high-severity clauses that apply to this system. */
export function stakesForStandard(result: AssessmentResult, standardId: string): StakeSummary {
  const { analysis } = result;
  const report = result.reports.find((entry) => entry.standardId === standardId);
  const controls: ControlResult[] = report?.controls ?? (standardId === "owasp_llm_2025" ? result.owasp : []);
  return summarize(
    controls
      .filter(
        (control) =>
          control.status !== "not_applicable" &&
          control.applicabilityStatus !== "not_applicable" &&
          HIGH_STAKES.has(control.severity as Severity),
      )
      .map((control) => {
        const outcome = outcomeOf(control.status);
        const check = analysis.checks.find((entry) =>
          entry.controls.some((c) => c.standardId === standardId && c.controlId === control.id),
        );
        return {
          key: `${standardId}:${control.id}`,
          title: control.name,
          why: control.objective ?? check?.intent ?? control.remediation,
          severity: control.severity as Severity,
          pillar: primaryPillar(control),
          outcome,
          clause: control.id,
          finding:
            outcome === "caught"
              ? analysis.findings.find((finding) =>
                  finding.breaches.some((b) => b.standardId === standardId && b.controlId === control.id),
                )?.title
              : undefined,
          reach: outcome === "unreached" ? `Needs ${tierLabel(control.tierMinimum)}` : undefined,
        };
      }),
  );
}

/** The whole run, for the headline: every high-stakes rule, once. */
export function stakesOverall(result: AssessmentResult): StakeSummary {
  const items = result.analysis.pillars.flatMap((entry) => stakesForPillar(result, entry.pillar).items);
  return summarize(items);
}

/** "3 critical and 2 high-severity weaknesses", spelled for a headline. */
export function caughtPhrase(summary: StakeSummary): string {
  const high = summary.caught - summary.criticalCaught;
  const parts = [
    summary.criticalCaught ? `${summary.criticalCaught} critical` : "",
    high ? `${high} high-severity` : "",
  ].filter(Boolean);
  const noun = summary.caught === 1 ? "weakness" : "weaknesses";
  return parts.length ? `${parts.join(" and ")} ${noun}` : `no ${noun}`;
}
