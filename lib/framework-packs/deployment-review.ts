import { contentHashForControls, createPackControl, validateFrameworkPack } from "./schema";
import securityRules from "../security-layer-rules.json";
import type { Pillar, Severity } from "../types";

const source = { authority: "ARQ Governance; NIST outcome mapping", title: "Deployment evidence review mapped to NIST CSF 2.0 outcomes", url: "https://www.nist.gov/publications/nist-cybersecurity-framework-csf-20", status: "current" as const, note: "Authored deployment checks, not an exhaustive CSF assessment. Evidence is scoped to the assets and time observed." };
const definitions = [
  ["dns-resolution", "Public DNS resolution", "trust", "ID.AM"],
  ["tls-valid", "TLS certificate and hostname validation", "security", "PR.DS"],
  ["tls-modern", "Modern TLS negotiation", "security", "PR.DS"],
  ["frontend-reachable", "Frontend response availability", "governance", "PR.IR"],
  ["frontend-csp", "Frontend enforcing content security policy", "security", "PR.PS"],
  ["frontend-nosniff", "Frontend MIME-sniffing protection", "security", "PR.PS"],
  ["frontend-framing", "Frontend frame-embedding restriction", "security", "PR.PS"],
  ["frontend-hsts", "HTTPS strict transport policy", "security", "PR.DS"],
  ["browser-render", "Frontend browser rendering", "trust", "PR.IR"],
  ["browser-runtime", "Initial-load JavaScript errors", "trust", "PR.PS"],
  ["auth-anonymous-boundary", "Protected route rejects anonymous access", "security", "PR.AA"],
  ["auth-authenticated-read", "Configured identity can read its protected route", "security", "PR.AA"],
  ["auth-role-boundary", "Configured identity cannot read a forbidden route", "security", "PR.AA"],
  ["azure-storage-https", "Azure storage HTTPS-only configuration", "data_protection", "PR.DS"],
  ["azure-storage-public", "Azure anonymous blob access restriction", "data_protection", "PR.DS"],
  ["azure-vault-protection", "Azure Key Vault purge protection", "security", "PR.DS"],
  ["azure-runtime-images", "Azure deployed image digest pinning", "security", "PR.PS"],
  ["azure-diagnostics", "Azure resource diagnostic log export", "compliance", "DE.CM"],
  ["aws-alarm-routing", "AWS application alarm notification routing", "governance", "DE.CM"],
  ["aws-log-retention", "AWS scoped log-retention configuration", "compliance", "PR.DS"],
  ["aws-trail-recording", "AWS configured CloudTrail recording", "compliance", "DE.CM"],
  ["aws-trail-digests", "AWS CloudTrail digest delivery configuration", "compliance", "PR.DS"],
  ["aws-admin-ingress", "AWS administrative network exposure", "security", "PR.PS"],
  ["aws-storage-public", "AWS scoped S3 public access block", "data_protection", "PR.DS"],
  ["aws-storage-encryption", "AWS scoped S3 default encryption", "data_protection", "PR.DS"],
  ["aws-storage-versioning", "AWS scoped S3 object versioning", "data_protection", "PR.DS"],
  ["aws-root-mfa", "AWS account root MFA configuration", "security", "PR.AA"],
  ["aws-iam-console-mfa", "Scoped AWS console identities have MFA configured", "security", "PR.AA"],
  ["aws-iam-key-age", "Scoped AWS active access-key rotation age", "security", "PR.AA"],
  ["aws-iam-unused-credentials", "Scoped AWS unused active credentials", "security", "PR.AA"],
  ["aws-access-analyzer-findings", "Configured AWS analyzer unresolved application findings", "security", "PR.AA"],
  ["entra-mfa-registration", "Scoped Entra user MFA registration", "security", "PR.AA"],
  ["entra-credential-expiry", "Scoped Entra application credential expiry", "security", "PR.AA"],
  ["entra-required-policy-state", "Explicitly required Entra Conditional Access policies are enabled", "security", "PR.AA"],
  ["entra-timebound-roles", "Scoped Entra role assignments meet required time-bound policy", "security", "PR.AA"],
  ["auth-test-matrix", "Approved identity and resource authorization matrix", "security", "PR.AA"],
  ["identity-graph-lifecycle", "Source identity graph lifecycle and ownership consistency", "security", "PR.AA"],
  ["identity-graph-role-conflicts", "Nested assigned-role conflicts against approved separation policy", "security", "PR.AA"],
  ["source-workflow-permissions", "Source workflow token permission declaration", "security", "GV.SC"],
] as const;

const controls = [
  ...definitions.map(([key, name, pillar, section]) => createPackControl({ id: `DEP-${key.toUpperCase()}`, name, objective: `Evaluate ${name.toLowerCase()} from a timestamped direct observation of the configured application scope. A successful read is not sufficient where a configuration condition must be satisfied.`, category: "Deployment evidence", tierMinimum: 3, pillars: [pillar], testType: "document_verify", evaluationRuleId: `artifact.review-${key}`, evidenceProcedureIds: [`artifact-review-${key}`], severity: /public|auth-|admin|mfa|tls-valid/.test(key) ? "critical" : "high", section, mappingType: "governai_evidence_mapping", remediationId: `review-${key}`, remediation: `Correct the ${name.toLowerCase()} configuration on the affected asset and re-run the same scoped evidence check.` }, source)),
  ...securityRules.map(rule => createPackControl({ id: `DEP-SECURITY-${rule.id.toUpperCase()}`, name: rule.name,
    objective: `Evaluate ${rule.name.toLowerCase()} within an explicitly connected source scope. Required typed measurements: ${Object.entries(rule.fields).map(([field, condition]) => `${field}: ${condition}`).join("; ")}. Incomplete scope cannot pass.`,
    category: `Seven-pillar security: ${rule.layer}`, tierMinimum: 3, pillars: [rule.pillar as Pillar], testType: "document_verify", evaluationRuleId: `artifact.review-security-${rule.id}`, evidenceProcedureIds: [`artifact-review-security-${rule.id}`], severity: rule.severity as Severity, section: rule.layer, mappingType: "governai_evidence_mapping", remediationId: `review-security-${rule.id}`, remediation: rule.fix }, source)),
];

export const deploymentReviewPack = validateFrameworkPack({ manifest: { id: "deployment_review", release: "2026.10-draft.2", status: "draft", assuranceLevel: "readiness", sourceVersion: "ARQ seven-pillar deployment checks / NIST CSF 2.0 mapping", publishedAt: "2026-10-16", contentHash: contentHashForControls(controls), note: "Direct deployment observations and scoped connected-tool measurements across seven security pillars. Export completeness is source-declared. Missing connections remain not assessed. Successful observations do not establish whole-bank or regulatory completeness." }, standard: { id: "deployment_review", shortName: "Deployment Review", name: "Application Deployment Evidence Review", version: "2026.10", kind: "Methodological", jurisdiction: "Global", description: "Seven-pillar evidence review: identity, devices, applications/AI, data, networks, automation and visibility.", reportFormat: "Deployment Evidence Review", scoringMethod: "Rule-based direct observations and typed source measurements", passThreshold: "No failed observed controls", officialReference: source }, controls });
