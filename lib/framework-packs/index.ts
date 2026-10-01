import type { AccessTier, StandardDefinition } from "../types";
import { euAiActPack } from "./eu-ai-act-2024";
import { hipaaCurrentPack } from "./hipaa-current";
import { nistAiRmfPack } from "./nist-ai-rmf-1.0";
import { owaspLlm2025Pack } from "./owasp-llm-2025";
import { pciDss401Pack } from "./pci-dss-4.0.1";
import type { FrameworkPack } from "./schema";
import { libraryProcedureIds } from "../verification-library";

export {
  euAiActPack,
  hipaaCurrentPack,
  nistAiRmfPack,
  owaspLlm2025Pack,
  pciDss401Pack,
};
export type { FrameworkPack, FrameworkPackControl } from "./schema";

export const pilotFrameworkPacks = [
  hipaaCurrentPack,
  nistAiRmfPack,
  euAiActPack,
  pciDss401Pack,
] as const;

/**
 * Procedures named only by controls a pack release has since dropped — the scope
 * questionnaires, and the requirements no Tier 3 run could reach a verdict on.
 * They stay accepted so a manifest written for an earlier release still loads
 * without errors; no control consumes them, so they change no verdict.
 */
const retiredProcedureIds = [
  "artifact-approval-records",
  "artifact-assessment-history",
  "artifact-breach-exercise",
  "artifact-cde-mfa-configuration",
  "artifact-ce-marking",
  "artifact-chat-pan-detection",
  "artifact-conformity-records",
  "artifact-disposal-records",
  "artifact-downstream-information",
  "artifact-operational-records",
  "artifact-payment-page-script-inventory",
  "artifact-payment-page-tamper-detection",
  "artifact-quality-records",
  "artifact-recall-exercise",
  "artifact-registration-record",
  "artifact-rollback-test",
  "artifact-sanction-records",
  "artifact-scope-questionnaire",
  "artifact-secret-scan",
  "artifact-stakeholder-notices",
  "artifact-tenant-separation-pentest",
  "artifact-training-content-summary",
  "artifact-use-case-controls",
  "document-ai-value-chain",
  "document-assurance-model",
  "document-breach-runbook",
  "document-conformity-assessment",
  "document-contingency-plan",
  "document-copyright-policy",
  "document-corrective-action",
  "document-deployer-procedure",
  "document-distributor-checklist",
  "document-eu-declaration",
  "document-eu-registration",
  "document-eu-risk-classification",
  "document-evaluation-program",
  "document-facility-controls",
  "document-fundamental-rights-impact",
  "document-gpai-technical-documentation",
  "document-impact-assessment",
  "document-importer-checklist",
  "document-individual-rights-procedure",
  "document-media-policy",
  "document-misuse-analysis",
  "document-obligations-register",
  "document-pan-messaging-policy",
  "document-pci-scope",
  "document-phi-use-policy",
  "document-policy-register",
  "document-prohibited-practice-screening",
  "document-quality-management-system",
  "document-regulatory-scope",
  "document-risk-communication",
  "document-safe-shutdown",
  "document-sanction-policy",
  "document-stakeholder-record",
  "document-test-data-policy",
  "document-tpsp-responsibility-matrix",
  "document-unexpected-pan-procedure",
  "document-workstation-policy",
  "probe-ai-disclosure",
];

/**
 * Every procedure id an Evidence Manifest may declare. Unknown ids are rejected,
 * so this set is the union of the framework packs, the verification library, and
 * the retired ids above — a control that names a procedure nobody accepts could
 * never be closed.
 */
export const pilotEvidenceProcedureIds = new Set([
  ...[...pilotFrameworkPacks, owaspLlm2025Pack].flatMap((pack) =>
    pack.controls.flatMap((control) => control.evidenceProcedureIds),
  ),
  ...libraryProcedureIds,
  ...retiredProcedureIds,
]);

function packToStandard(pack: FrameworkPack): StandardDefinition {
  const coverage = ([1, 2, 3] as AccessTier[]).reduce(
    (result, tier) => {
      result[tier] = pack.controls.filter((control) => control.tierMinimum <= tier).length;
      return result;
    },
    { 1: 0, 2: 0, 3: 0 } as Record<AccessTier, number>,
  );
  const {
    release,
    status,
    assuranceLevel,
    sourceVersion,
    publishedAt,
    contentHash,
    note,
  } = pack.manifest;
  return {
    ...pack.standard,
    controls: pack.controls,
    coverage,
    pack: {
      release,
      status,
      assuranceLevel,
      sourceVersion,
      publishedAt,
      contentHash,
      note,
    },
  };
}

export const pilotStandardsById = new Map(
  pilotFrameworkPacks.map((pack) => [pack.manifest.id, packToStandard(pack)]),
);
