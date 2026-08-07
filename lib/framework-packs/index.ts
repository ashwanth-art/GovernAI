import type { AccessTier, StandardDefinition } from "../types";
import { euAiActPack } from "./eu-ai-act-2024";
import { hipaaCurrentPack } from "./hipaa-current";
import { nistAiRmfPack } from "./nist-ai-rmf-1.0";
import { owaspLlm2025Pack } from "./owasp-llm-2025";
import type { FrameworkPack } from "./schema";
import { libraryProcedureIds } from "../verification-library";

export {
  euAiActPack,
  hipaaCurrentPack,
  nistAiRmfPack,
  owaspLlm2025Pack,
};
export type { FrameworkPack, FrameworkPackControl } from "./schema";

export const pilotFrameworkPacks = [
  hipaaCurrentPack,
  nistAiRmfPack,
  euAiActPack,
] as const;

/**
 * Every procedure id an Evidence Manifest may declare. Unknown ids are rejected,
 * so this set is the union of the framework packs and the verification library —
 * a control that names a procedure nobody accepts could never be closed.
 */
export const pilotEvidenceProcedureIds = new Set([
  ...[...pilotFrameworkPacks, owaspLlm2025Pack].flatMap((pack) =>
    pack.controls.flatMap((control) => control.evidenceProcedureIds),
  ),
  ...libraryProcedureIds,
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
