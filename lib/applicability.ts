import type { Control } from "./types";

/**
 * Whether a control applies to the assessed system.
 *
 * No pack asks scope questions: every condition below applies to every
 * assessed AI/RAG system, so a selected pack is assessed in full and a
 * role- or data-specific requirement is reported rather than ruled out.
 */

type ConditionResult = {
  status: "applicable" | "not_applicable" | "unknown";
  reason: string;
};

const supportedApplicabilityConditions = new Set(["all_assessed_ai_systems", "llm_or_rag_system"]);

export function validateApplicabilityCondition(condition: string): boolean {
  return supportedApplicabilityConditions.has(condition);
}

function evaluateCondition(condition: string): ConditionResult {
  if (supportedApplicabilityConditions.has(condition)) {
    return { status: "applicable", reason: "Applies to the assessed AI/RAG system." };
  }
  return { status: "unknown", reason: `Unsupported applicability condition: ${condition}.` };
}

export function evaluateControlApplicability(control: Control): ConditionResult {
  const conditions = control.applicability ?? ["all_assessed_ai_systems"];
  const results = conditions.map(evaluateCondition);
  const unknown = results.find((result) => result.status === "unknown");
  if (unknown) return unknown;
  return {
    status: "applicable",
    reason: [...new Set(results.map((result) => result.reason))].join(" "),
  };
}
