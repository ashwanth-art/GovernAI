import type { ControlStatus, EvidenceSourceType } from "./types";

export type EvidenceProcedureKind =
  | "probe"
  | "adapter"
  | "document"
  | "artifact";

export interface ProcedureEvidence {
  procedureId: string;
  status: Exclude<ControlStatus, "not_applicable">;
  summary: string;
  confidence: number;
  sourceType: EvidenceSourceType;
  collectedAt?: string;
  artifactRef?: string;
}

export type ProcedureEvidenceMap = Record<string, ProcedureEvidence>;

export interface EvidenceManifest {
  schemaVersion: "1.0";
  generatedAt?: string;
  procedures: Record<
    string,
    {
      status: "pass" | "partial" | "fail" | "not_assessed";
      summary: string;
      confidence?: number;
      collectedAt?: string;
      artifactRef?: string;
    }
  >;
}

export function evidenceProcedureKind(id: string): EvidenceProcedureKind | null {
  if (id.startsWith("probe-")) return "probe";
  if (id.startsWith("adapter-")) return "adapter";
  if (id.startsWith("document-")) return "document";
  if (id.startsWith("artifact-")) return "artifact";
  return null;
}

export function validateEvidenceProcedureId(id: string): boolean {
  return Boolean(evidenceProcedureKind(id) && /^[a-z][a-z0-9-]+$/.test(id));
}

export function parseEvidenceManifest(
  value: unknown,
  acceptedProcedureIds?: ReadonlySet<string>,
): {
  evidence: ProcedureEvidenceMap;
  errors: string[];
} {
  const errors: string[] = [];
  const evidence: ProcedureEvidenceMap = {};
  if (!value || typeof value !== "object") {
    return { evidence, errors: ["Evidence manifest must be a JSON object."] };
  }
  const manifest = value as Partial<EvidenceManifest>;
  if (manifest.schemaVersion !== "1.0") {
    errors.push("Evidence manifest schemaVersion must be 1.0.");
  }
  if (!manifest.procedures || typeof manifest.procedures !== "object") {
    errors.push("Evidence manifest procedures object is required.");
    return { evidence, errors };
  }
  for (const [procedureId, raw] of Object.entries(manifest.procedures)) {
    if (!validateEvidenceProcedureId(procedureId)) {
      errors.push(`Unsupported evidence procedure id: ${procedureId}.`);
      continue;
    }
    if (acceptedProcedureIds && !acceptedProcedureIds.has(procedureId)) {
      errors.push(`Unknown framework-pack evidence procedure id: ${procedureId}.`);
      continue;
    }
    if (!raw || typeof raw !== "object") {
      errors.push(`${procedureId}: evidence entry must be an object.`);
      continue;
    }
    const status = raw.status;
    if (!["pass", "partial", "fail", "not_assessed"].includes(status)) {
      errors.push(`${procedureId}: invalid status.`);
      continue;
    }
    if (!raw.summary?.trim()) {
      errors.push(`${procedureId}: summary is required.`);
      continue;
    }
    const confidence = Math.max(
      0,
      Math.min(1, Number.isFinite(raw.confidence) ? Number(raw.confidence) : 0.8),
    );
    evidence[procedureId] = {
      procedureId,
      status,
      summary: raw.summary.trim(),
      confidence,
      sourceType: "artifact_manifest",
      collectedAt: raw.collectedAt ?? manifest.generatedAt,
      artifactRef: raw.artifactRef,
    };
  }
  return { evidence, errors };
}

export function combineProcedureEvidence(
  procedureIds: string[],
  available: ProcedureEvidenceMap,
): ProcedureEvidence | null {
  const matches = procedureIds
    .map((procedureId) => available[procedureId])
    .filter(Boolean);
  if (matches.length === 0) return null;
  const assessed = matches.filter((item) => item.status !== "not_assessed");
  if (assessed.length === 0) {
    return {
      procedureId: procedureIds.join("+"),
      status: "not_assessed",
      summary: matches.map((item) => item.summary).join(" "),
      confidence: 0,
      sourceType: matches[0].sourceType,
    };
  }
  const status = assessed.some((item) => item.status === "fail")
    ? "fail"
    : assessed.some((item) => item.status === "partial") ||
        assessed.length < procedureIds.length
      ? "partial"
      : "pass";
  return {
    procedureId: procedureIds.join("+"),
    status,
    summary: assessed.map((item) => item.summary).join(" "),
    confidence:
      assessed.reduce((sum, item) => sum + item.confidence, 0) / assessed.length,
    sourceType: assessed[0].sourceType,
  };
}
