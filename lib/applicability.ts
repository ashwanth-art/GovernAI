import type { ApplicabilityProfile, AssessmentInput, Control } from "./types";

export const defaultApplicabilityProfile: ApplicabilityProfile = {
  hipaaRole: "unknown",
  handlesPhi: false,
  handlesEphi: false,
  usesPhiSubprocessors: false,
  maintainsDesignatedRecordSet: false,
  euTerritorialScope: "unknown",
  euRole: "unknown",
  euRiskClass: "unknown",
  euArticle27Deployer: false,
  directHumanInteraction: true,
};

type ConditionResult = {
  status: "applicable" | "not_applicable" | "unknown";
  reason: string;
};

const supportedApplicabilityConditions = new Set([
  "all_assessed_ai_systems",
  "llm_or_rag_system",
  "covered_entity_or_business_associate",
  "covered_entity",
  "handles_phi",
  "handles_ephi",
  "handles_phi_or_ephi",
  "uses_phi_subprocessors",
  "maintains_designated_record_set",
  "eu_market_or_output_used_in_eu",
  "eu_ai_act_in_scope",
  "provider_or_deployer",
  "high_risk_ai_system",
  "high_risk_ai_system_provider",
  "high_risk_ai_system_deployer",
  "article_27_deployer",
  "direct_human_ai_interaction",
  "eu_importer",
  "eu_distributor",
  "gpai_provider",
]);

export function validateApplicabilityCondition(condition: string): boolean {
  return supportedApplicabilityConditions.has(condition);
}

/**
 * Which profile answers a condition actually consumes.
 *
 * Setup asks for an answer only when a selected pack contains a control that
 * depends on it — the same way the credential fields follow the access tier.
 * A condition that applies to every assessed system consumes nothing, which is
 * why most packs ask for nothing at all.
 */
export const applicabilityKeysByCondition: Record<string, Array<keyof ApplicabilityProfile>> = {
  all_assessed_ai_systems: [],
  llm_or_rag_system: [],
  covered_entity_or_business_associate: ["hipaaRole"],
  covered_entity: ["hipaaRole"],
  handles_phi: ["handlesPhi"],
  handles_ephi: ["handlesEphi"],
  handles_phi_or_ephi: ["handlesPhi", "handlesEphi"],
  uses_phi_subprocessors: ["usesPhiSubprocessors"],
  maintains_designated_record_set: ["maintainsDesignatedRecordSet"],
  eu_market_or_output_used_in_eu: ["euTerritorialScope", "euRole"],
  eu_ai_act_in_scope: ["euTerritorialScope", "euRole"],
  provider_or_deployer: ["euTerritorialScope", "euRole"],
  high_risk_ai_system: ["euRiskClass"],
  high_risk_ai_system_provider: ["euRiskClass", "euRole"],
  high_risk_ai_system_deployer: ["euRiskClass", "euRole"],
  article_27_deployer: ["euArticle27Deployer"],
  direct_human_ai_interaction: ["directHumanInteraction"],
  eu_importer: ["euRole"],
  eu_distributor: ["euRole"],
  gpai_provider: ["euRole"],
};

function hipaaRoleCondition(
  profile: ApplicabilityProfile,
  allowed: ApplicabilityProfile["hipaaRole"][],
): ConditionResult {
  if (profile.hipaaRole === "unknown") {
    return { status: "unknown", reason: "HIPAA organizational role has not been determined." };
  }
  if (!allowed.includes(profile.hipaaRole)) {
    return { status: "not_applicable", reason: `HIPAA role is ${profile.hipaaRole.replaceAll("_", " ")}.` };
  }
  return { status: "applicable", reason: `HIPAA role is ${profile.hipaaRole.replaceAll("_", " ")}.` };
}

function euInScope(profile: ApplicabilityProfile): ConditionResult {
  if (profile.euTerritorialScope === "unknown" || profile.euRole === "unknown") {
    return { status: "unknown", reason: "EU territorial scope or organizational role is undetermined." };
  }
  if (profile.euTerritorialScope === "out_of_scope" || profile.euRole === "not_in_scope") {
    return { status: "not_applicable", reason: "The supplied profile places the system outside EU AI Act scope." };
  }
  return { status: "applicable", reason: `EU role is ${profile.euRole.replaceAll("_", " ")}.` };
}

function evaluateCondition(
  condition: string,
  profile: ApplicabilityProfile,
): ConditionResult {
  switch (condition) {
    case "all_assessed_ai_systems":
    case "llm_or_rag_system":
      return { status: "applicable", reason: "Applies to the assessed AI/RAG system." };
    case "covered_entity_or_business_associate":
      return hipaaRoleCondition(profile, ["covered_entity", "business_associate"]);
    case "covered_entity":
      return hipaaRoleCondition(profile, ["covered_entity"]);
    case "handles_phi":
      return profile.handlesPhi
        ? { status: "applicable", reason: "The system handles PHI." }
        : { status: "not_applicable", reason: "The supplied profile says the system does not handle PHI." };
    case "handles_ephi":
      return profile.handlesEphi
        ? { status: "applicable", reason: "The system handles ePHI." }
        : { status: "not_applicable", reason: "The supplied profile says the system does not handle ePHI." };
    case "handles_phi_or_ephi":
      return profile.handlesPhi || profile.handlesEphi
        ? { status: "applicable", reason: "The system handles PHI or ePHI." }
        : { status: "not_applicable", reason: "The supplied profile says the system handles neither PHI nor ePHI." };
    case "uses_phi_subprocessors":
      return profile.usesPhiSubprocessors
        ? { status: "applicable", reason: "The system uses subprocessors that handle PHI." }
        : { status: "not_applicable", reason: "No PHI-handling subprocessor is declared." };
    case "maintains_designated_record_set":
      return profile.maintainsDesignatedRecordSet
        ? { status: "applicable", reason: "The system maintains data in a designated record set." }
        : { status: "not_applicable", reason: "No designated record set is declared." };
    case "eu_market_or_output_used_in_eu":
    case "eu_ai_act_in_scope":
      return euInScope(profile);
    case "provider_or_deployer": {
      const scope = euInScope(profile);
      if (scope.status !== "applicable") return scope;
      return ["provider", "deployer"].includes(profile.euRole)
        ? { status: "applicable", reason: `EU role is ${profile.euRole}.` }
        : { status: "not_applicable", reason: `This obligation is limited to providers or deployers; role is ${profile.euRole.replaceAll("_", " ")}.` };
    }
    case "high_risk_ai_system":
      if (profile.euRiskClass === "unknown") {
        return { status: "unknown", reason: "EU AI Act risk classification is undetermined." };
      }
      return profile.euRiskClass === "high_risk"
        ? { status: "applicable", reason: "The system is classified as high-risk." }
        : { status: "not_applicable", reason: `The system is classified as ${profile.euRiskClass.replaceAll("_", " ")}.` };
    case "high_risk_ai_system_provider":
      if (profile.euRiskClass === "unknown" || profile.euRole === "unknown") {
        return { status: "unknown", reason: "EU risk class or provider role is undetermined." };
      }
      return profile.euRiskClass === "high_risk" &&
        ["provider", "product_manufacturer"].includes(profile.euRole)
        ? { status: "applicable", reason: "The organization is a provider of a high-risk AI system." }
        : { status: "not_applicable", reason: "The organization is not a provider of a high-risk AI system." };
    case "high_risk_ai_system_deployer":
      if (profile.euRiskClass === "unknown" || profile.euRole === "unknown") {
        return { status: "unknown", reason: "EU risk class or deployer role is undetermined." };
      }
      return profile.euRiskClass === "high_risk" && profile.euRole === "deployer"
        ? { status: "applicable", reason: "The organization deploys a high-risk AI system." }
        : { status: "not_applicable", reason: "The organization is not a deployer of a high-risk AI system." };
    case "article_27_deployer":
      return profile.euArticle27Deployer
        ? { status: "applicable", reason: "The deployer has declared Article 27 FRIA applicability." }
        : { status: "not_applicable", reason: "Article 27 deployer applicability is not declared." };
    case "direct_human_ai_interaction":
      return profile.directHumanInteraction
        ? { status: "applicable", reason: "The AI system interacts directly with natural persons." }
        : { status: "not_applicable", reason: "No direct natural-person interaction is declared." };
    case "eu_importer":
      if (profile.euRole === "unknown") {
        return { status: "unknown", reason: "EU AI Act organizational role is undetermined." };
      }
      return profile.euRole === "importer"
        ? { status: "applicable", reason: "The organization is an importer." }
        : { status: "not_applicable", reason: "The organization is not an importer." };
    case "eu_distributor":
      if (profile.euRole === "unknown") {
        return { status: "unknown", reason: "EU AI Act organizational role is undetermined." };
      }
      return profile.euRole === "distributor"
        ? { status: "applicable", reason: "The organization is a distributor." }
        : { status: "not_applicable", reason: "The organization is not a distributor." };
    case "gpai_provider":
      if (profile.euRole === "unknown") {
        return { status: "unknown", reason: "EU AI Act organizational role is undetermined." };
      }
      return profile.euRole === "gpai_provider"
        ? { status: "applicable", reason: "The organization is a GPAI provider." }
        : { status: "not_applicable", reason: "The organization is not a GPAI provider." };
    default:
      return { status: "unknown", reason: `Unsupported applicability condition: ${condition}.` };
  }
}

export function evaluateControlApplicability(
  control: Control,
  profile: ApplicabilityProfile,
): ConditionResult {
  const conditions = control.applicability ?? ["all_assessed_ai_systems"];
  const results = conditions.map((condition) => evaluateCondition(condition, profile));
  const notApplicable = results.find((result) => result.status === "not_applicable");
  if (notApplicable) return notApplicable;
  const unknown = results.find((result) => result.status === "unknown");
  if (unknown) return unknown;
  return {
    status: "applicable",
    reason: [...new Set(results.map((result) => result.reason))].join(" "),
  };
}

export function validateApplicability(input: AssessmentInput): string[] {
  const errors: string[] = [];
  if (input.standardIds.includes("hipaa") && input.applicability.hipaaRole === "unknown") {
    errors.push("Select the organization’s HIPAA role before assessing HIPAA.");
  }
  if (input.standardIds.includes("eu_ai_act")) {
    if (input.applicability.euTerritorialScope === "unknown") {
      errors.push("Determine EU AI Act territorial scope before assessing the EU AI Act.");
    }
    if (
      input.applicability.euTerritorialScope === "in_scope" &&
      input.applicability.euRole === "unknown"
    ) {
      errors.push("Select the organization’s EU AI Act role.");
    }
    if (
      input.applicability.euTerritorialScope === "in_scope" &&
      input.applicability.euRiskClass === "unknown"
    ) {
      errors.push("Select the system’s EU AI Act risk classification.");
    }
  }
  return errors;
}
