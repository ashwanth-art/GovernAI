import type {
  AccessTier,
  Control,
  OfficialReference,
  Pillar,
  StandardKind,
} from "../types";
import { validateApplicabilityCondition } from "../applicability";
import { validateEvidenceProcedureId } from "../evidence-procedures";

export type AssuranceLevel = "screening" | "readiness" | "audit_supported";
export type PackStatus = "draft" | "review" | "approved" | "superseded";
export type ControlSeverity = "critical" | "high" | "medium" | "low";

export interface FrameworkPackManifest {
  id: string;
  release: string;
  status: PackStatus;
  assuranceLevel: AssuranceLevel;
  sourceVersion: string;
  publishedAt: string;
  contentHash: string;
  note: string;
}

export interface FrameworkPackControl extends Control {
  objective: string;
  applicability: string[];
  evidenceProcedureIds: string[];
  evaluationRuleId: string;
  severity: ControlSeverity;
  remediationId: string;
}

export interface FrameworkPack {
  manifest: FrameworkPackManifest;
  standard: {
    id: string;
    shortName: string;
    name: string;
    version: string;
    kind: StandardKind;
    jurisdiction: string;
    description: string;
    reportFormat: string;
    scoringMethod: string;
    passThreshold: string;
    officialReference: OfficialReference;
  };
  controls: FrameworkPackControl[];
}

export interface PackControlInput {
  id: string;
  name: string;
  objective: string;
  category: string;
  tierMinimum: AccessTier;
  pillars: Pillar[];
  testType: Control["testType"];
  evaluationRuleId: string;
  severity: ControlSeverity;
  section: string;
  evidenceProcedureIds: string[];
  remediationId: string;
  remediation: string;
  applicability?: string[];
  mappingType?: NonNullable<Control["sourceCitation"]>["mappingType"];
}

export function createPackControl(
  input: PackControlInput,
  source: OfficialReference,
): FrameworkPackControl {
  return {
    id: input.id,
    name: input.name,
    objective: input.objective,
    category: input.category,
    tierMinimum: input.tierMinimum,
    pillars: input.pillars,
    testType: input.testType,
    evaluationRuleId: input.evaluationRuleId,
    severity: input.severity,
    applicability: input.applicability ?? ["all_assessed_ai_systems"],
    evidenceProcedureIds: input.evidenceProcedureIds,
    remediationId: input.remediationId,
    remediation: input.remediation,
    sourceCitation: {
      authority: source.authority,
      document: source.title,
      section: input.section,
      url: source.url,
      mappingType: input.mappingType ?? "official_requirement",
      note: "ARQ Governance-authored assessment objective mapped to the cited source; it is not a verbatim official questionnaire or a certification conclusion.",
    },
  };
}

export function contentHashForControls(controls: FrameworkPackControl[]): string {
  const content = JSON.stringify(controls);
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function validateFrameworkPack(pack: FrameworkPack): FrameworkPack {
  const errors: string[] = [];
  const ids = new Set<string>();

  if (!pack.manifest.id || pack.manifest.id !== pack.standard.id) {
    errors.push("manifest.id must match standard.id");
  }
  if (!pack.manifest.release || !pack.manifest.sourceVersion) {
    errors.push("manifest release and sourceVersion are required");
  }
  if (!pack.manifest.contentHash) {
    errors.push("manifest contentHash is required");
  }
  if (!pack.standard.officialReference.url.startsWith("https://")) {
    errors.push("officialReference must use HTTPS");
  }
  if (pack.controls.length === 0) {
    errors.push("at least one control is required");
  }

  for (const control of pack.controls) {
    if (ids.has(control.id)) errors.push(`duplicate control id: ${control.id}`);
    ids.add(control.id);
    if (!control.objective.trim()) errors.push(`${control.id}: objective is required`);
    if (control.applicability.length === 0) errors.push(`${control.id}: applicability is required`);
    control.applicability.forEach((condition) => {
      if (!validateApplicabilityCondition(condition)) {
        errors.push(`${control.id}: unsupported applicability condition ${condition}`);
      }
    });
    if (control.evidenceProcedureIds.length === 0) {
      errors.push(`${control.id}: at least one evidence procedure is required`);
    }
    control.evidenceProcedureIds.forEach((procedureId) => {
      if (!validateEvidenceProcedureId(procedureId)) {
        errors.push(`${control.id}: invalid evidence procedure id ${procedureId}`);
      }
    });
    if (!control.evaluationRuleId) errors.push(`${control.id}: evaluation rule is required`);
    if (!control.remediationId) errors.push(`${control.id}: remediation id is required`);
    if (!control.sourceCitation?.section) errors.push(`${control.id}: source section is required`);
  }

  if (errors.length) {
    throw new Error(`Invalid framework pack ${pack.manifest.id}: ${errors.join("; ")}`);
  }
  return pack;
}
