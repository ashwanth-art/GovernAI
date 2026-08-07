
/**
 * How numbers are said.
 *
 * The two screens that talk about the same figures — the plan you approve and the
 * run that executes it — used to phrase them independently. Setup led with the
 * applicable control count, the run led with the assessed count, and neither said
 * which denominator it was using, so the same run could look like 404 controls on
 * one screen and 27 on the next without either number being wrong.
 *
 * Everything here is presentation. No figure is computed, adjusted, or rounded
 * into a better-looking one; these functions only decide the words that go around
 * a number the engine already produced.
 */

/** A count against a denominator, plus the phrase that makes the pair legible. */
export interface Ratio {
  value: number;
  of: number;
  percent: number;
  label: string;
}

export function ratio(value: number, of: number, noun: string): Ratio {
  const safeOf = Math.max(0, of);
  const safeValue = Math.max(0, Math.min(value, safeOf));
  return {
    value: safeValue,
    of: safeOf,
    percent: safeOf > 0 ? Math.round((safeValue / safeOf) * 100) : 0,
    label: safeOf > 0 ? `${safeValue} of ${safeOf} ${noun}` : `no ${noun}`,
  };
}

/**
 * A percentage that refuses to render when there is nothing behind it.
 *
 * `0%` is a measurement. An area where nothing could be assessed has no
 * measurement at all, and printing `0% healthy` for it states the opposite of the
 * truth — it reads as "we tested this and everything failed" when the fact is
 * "we could not test this". The run screen printed exactly that for every area a
 * Tier 1 run cannot reach.
 */
export function measuredPercent(percent: unknown, measured: boolean): string {
  if (!measured) return "not measured";
  const value = Number(percent);
  return Number.isFinite(value) ? `${Math.round(value)}%` : "not measured";
}

/**
 * `4 of 27 rules` — the denominator a reader agreed to at setup, never a total that
 * shifts. `verified` is carried inside the phrase so an area with nothing planned
 * reads "no rules planned for this area" rather than "no rules planned verified".
 */
export function rulePhrase(ran: number, planned: number, suffix = ""): string {
  const tail = suffix ? ` ${suffix}` : "";
  if (planned <= 0) return "no rules planned for this area";
  return `${Math.min(ran, planned)} of ${planned} rule${planned === 1 ? "" : "s"}${tail}`;
}

const UNITS: Array<[number, string]> = [
  [3600, "h"],
  [60, "m"],
];

/** `1m 12s`, `48s`, `2h 04m`. Never `72.4 seconds`. */
export function duration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  for (const [size, suffix] of UNITS) {
    if (totalSeconds >= size) {
      const whole = Math.floor(totalSeconds / size);
      const rest = Math.floor((totalSeconds % size) / (size === 3600 ? 60 : 1));
      return `${whole}${suffix} ${String(rest).padStart(2, "0")}${size === 3600 ? "m" : "s"}`;
    }
  }
  return `${totalSeconds}s`;
}

/** `about 40s` — an estimate, said as one. */
export function estimate(seconds: number): string {
  if (seconds <= 0) return "moments";
  if (seconds < 20) return `about ${Math.round(seconds)}s`;
  if (seconds < 90) return `about ${Math.round(seconds / 5) * 5}s`;
  return `about ${Math.round(seconds / 30) / 2} min`;
}

/**
 * Elapsed against expected.
 *
 * A run with no time signal at all leaves a reader unable to distinguish slow
 * from stuck, which is the single question they are asking while they watch it.
 * When elapsed passes expected we say so plainly rather than pinning the estimate
 * — a progress indicator that has visibly stopped being true is worse than one
 * that admits it.
 */
export function elapsedPhrase(elapsedMs: number, expectedSeconds: number): {
  text: string;
  over: boolean;
} {
  const elapsed = duration(elapsedMs);
  if (expectedSeconds <= 0) return { text: elapsed, over: false };
  const over = elapsedMs > expectedSeconds * 1000;
  return {
    text: over ? `${elapsed} · longer than the ${estimate(expectedSeconds)} planned` : `${elapsed} of ${estimate(expectedSeconds)}`,
    over,
  };
}

/** `5 bounded requests` — plural handled, and always the word "bounded". */
export function requestPhrase(count: number): string {
  return `${count} bounded request${count === 1 ? "" : "s"}`;
}

/**
 * The one-line summary of what a tier can reach.
 *
 * Reachable-first, because that is the number the run will actually deliver.
 * Leading with the applicable count instead — which is what the setup screen did
 * — advertises a control population the selected depth cannot touch.
 */
export function reachPhrase(reachable: number, applicable: number, noun = "controls"): string {
  if (applicable <= 0) return `no ${noun} in scope`;
  const share = Math.round((reachable / applicable) * 100);
  return `${reachable} of ${applicable} in-scope ${noun} reachable · ${share}%`;
}
