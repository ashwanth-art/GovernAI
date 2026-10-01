/**
 * One vocabulary.
 *
 * This file used to hold three registers — engineering, compliance, executive —
 * behind an audience toggle, so every noun in the product had three spellings and
 * every call site had to thread a register through to reach one of them. The
 * toggle is gone and only the engineering register survives.
 *
 * What "engineering register" means here, precisely:
 *
 *   - Where a string is an IDENTIFIER, it is printed verbatim. `not_assessed` is
 *     the status the API returns, the event stream carries and the export
 *     contains; renaming it on screen to "Couldn't check" would mean the thing a
 *     reader searches for is not the thing they saw.
 *   - Where a string is a HEADING, it is written to be read. A heading is not an
 *     identifier, so `data_protection` becomes "Privacy & data" and no precision
 *     is lost.
 *
 * That split is the whole design. Identifiers stay exact so they can be traced;
 * headings stay legible so someone who has never run an assessment can follow
 * what they are looking at.
 */

const TERMS: Record<string, string> = {
  areas: "Areas",
  area: "area",
  requirement: "control",
  requirements: "controls",
  check: "rule",
  checks: "Rules",
  rule: "Rule spec",
  coverage: "assessed ÷ applicable",
  coverageShort: "assessed/applicable",
  health: "Health",
  healthNote: "share of the controls we could assess that passed",
  exposure: "Exposure index",
  provenance: "Directly tested",
  proxy: "area proxy",
  findings: "Findings",
  finding: "finding",
  blast: "Blast radius",
  proof: "Evidence ledger",
  standards: "Framework packs",
  monitors: "Monitors",
  depth: "Access depth",
  posture: "Posture",
  insufficient: "insufficient_evidence",
  remediation: "Remediation playbooks",
  profile: "Scope",
  applies: "What applies to you",
  fresh: "fresh",
  stale: "stale",
};

export function term(key: string): string {
  return TERMS[key] ?? key;
}

export function Term(key: string): string {
  const value = term(key);
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Statuses are identifiers, so they are returned verbatim.
 *
 * Kept as a function rather than inlined at call sites because the status set is
 * closed and this is the one place that fact is written down.
 */
export function statusLabel(status: string): string {
  return status;
}

/** What each status means, in a sentence. Used wherever a status first appears. */
export const statusMeaning: Record<string, string> = {
  pass: "the rule's pass condition was met by the evidence collected",
  fail: "the rule's fail condition was met",
  partial: "some of the rule's pass condition was met",
  not_assessed: "no evidence could be collected at this depth, so no verdict was reached",
  not_applicable: "ruled out of scope before the run, with a stated reason",
};

export const tierNames: Record<number, string> = {
  1: "Tier 1 · black-box",
  2: "Tier 2 · gray-box",
  3: "Tier 3 · white-box",
};

/** Plain-language version of the same three, for a first-time reader. */
export const tierPlain: Record<number, string> = {
  1: "From the outside only",
  2: "Outside, plus your own settings",
  3: "Everything, including named documents",
};

export function tierLabel(tier: number): string {
  return tierNames[tier] ?? `Tier ${tier}`;
}

export const methodNames: Record<string, string> = {
  live_probe: "live_probe",
  adapter_read: "adapter_read",
  provider_api: "provider_api",
  named_artifact: "named_artifact",
  not_supported: "not_supported",
};

/** What each collection method actually does. Identifier plus explanation. */
export const methodPlain: Record<string, string> = {
  live_probe: "a bounded question sent to your assistant",
  adapter_read: "a read of your own configuration endpoint",
  provider_api: "a read-only call to your cloud or monitoring provider",
  named_artifact: "a named procedure verdict from your evidence manifest",
  not_supported: "cannot be tested safely at any depth",
};

export function methodLabel(method: string): string {
  return methodNames[method] ?? method;
}
