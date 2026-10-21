import type { Control, ControlResult } from "./types";

/** Authored supporting-evidence relationships, NOT equivalence mappings. A
 * subcheck never overwrites the chosen control's own rule or verdict. Keep
 * these explicit: keyword/LLM similarity is not a regulatory crosswalk. */
const supportingKeys: Record<string, string[]> = {
  "adapter.credential-hygiene": ["aws-iam-key-age", "aws-iam-unused-credentials", "entra-credential-expiry", "security-iam-workload"],
  "adapter.deployment-posture": ["frontend-csp", "frontend-nosniff", "frontend-framing", "azure-runtime-images", "security-device-hardening"],
  "adapter.transport-encryption": ["tls-valid", "tls-modern", "frontend-hsts", "azure-storage-https"],
  "adapter.tenant-isolation": ["auth-role-boundary", "auth-test-matrix", "security-app-authorization"],
  "adapter.agency-boundary": ["security-app-ai-boundaries"],
  "adapter.retention-schedule": ["security-data-lifecycle"],
  "adapter.alert-routing": ["aws-alarm-routing", "security-visibility-alerts"],
  "adapter.trace-audit": ["azure-diagnostics", "aws-trail-recording", "security-visibility-coverage"],
  "adapter.event-forensics": ["aws-trail-digests", "security-visibility-coverage"],
  "adapter.system-inventory": ["security-device-inventory"],
  "probe.service-health": ["frontend-reachable", "dns-resolution", "browser-render"],
  "artifact.bank-privileged-access": ["aws-root-mfa", "aws-iam-console-mfa", "entra-mfa-registration", "entra-required-policy-state", "entra-timebound-roles", "aws-access-analyzer-findings", "identity-graph-lifecycle", "identity-graph-role-conflicts", "security-iam-mfa", "security-iam-pam", "security-iam-sod", "security-iam-reviews"],
  "artifact.bank-asset-inventory": ["security-device-inventory", "identity-graph-lifecycle"],
  "artifact.bank-patch-vulnerability": ["security-device-patches"],
  "artifact.bank-secure-development": ["source-workflow-permissions", "security-app-supply-chain", "auth-test-matrix"],
  "artifact.bank-network-protection": ["aws-admin-ingress", "security-network-segmentation", "security-network-edge", "security-network-private"],
  "artifact.bank-security-logging": ["aws-log-retention", "aws-trail-recording", "aws-trail-digests", "azure-diagnostics", "security-visibility-coverage", "security-visibility-alerts"],
  "artifact.bank-recovery-testing": ["aws-storage-versioning", "security-data-recovery"],
  "artifact.bank-incident-response": ["security-automation-response"],
  "artifact.bank-privacy-rights": ["security-data-lifecycle"],
  "artifact.bank-payment-data": ["aws-storage-public", "aws-storage-encryption", "azure-storage-public", "security-data-access", "security-data-crypto"],
};

export function supportingTechnicalChecks(control: Control, checks: ControlResult[]): ControlResult[] {
  const rules = new Set((supportingKeys[control.evaluationRuleId ?? ""] ?? []).map(key => `artifact.review-${key}`));
  return checks.filter(check => rules.has(check.evaluationRuleId ?? ""));
}

export function assessmentMethod(control: Control): string {
  const rule = control.evaluationRuleId ?? "";
  if (rule.startsWith("probe.")) return `Bounded live endpoint probe (${rule}).`;
  if (rule.startsWith("adapter.")) return `Read-only configuration/monitoring measurements evaluated by ${rule}.`;
  return `Named evidence checked against the written objective (${rule || control.testType}).`;
}
