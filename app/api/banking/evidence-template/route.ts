import { bankingEvidenceRules } from "@/lib/banking-evidence";

/** A read-only integration contract for exporters; no new credential or setup step. */
export async function GET() {
  return Response.json({
    schemaVersion: "1.0",
    note: "Merge procedures into the existing evidence manifest. Supply real measured values, a summary, timestamp and an artifactRef identifying the source record. This template supplies no passing evidence.",
    procedures: Object.fromEntries(bankingEvidenceRules.map(rule => [`artifact-bank-${rule.key}`, {
      status: "not_assessed", summary: `Awaiting ${rule.name} evidence from ${rule.system}.`,
      measurements: {},
    }])),
    measurementContract: Object.fromEntries(bankingEvidenceRules.map(rule => [`artifact-bank-${rule.key}`, { sourceSystem: rule.system, requiredFields: rule.fields }])),
  });
}
