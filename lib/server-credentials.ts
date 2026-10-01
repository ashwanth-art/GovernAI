import type { AssessmentInput } from "./types";

/**
 * Browser-safe values used by the demo form. They are identifiers, not secrets.
 *
 * The exact-match requirement is important: an operator can still replace a field
 * with a real credential, while the demo identifiers are resolved only on the
 * server. Unsupported demo identifiers become empty strings instead of being sent
 * to a third party as if they were valid authorization.
 */
const DEMO_PLACEHOLDERS = new Set([
  "demo-placeholder-chatbot-key",
  "demo-placeholder-audit-key",
  "demo-placeholder-monitoring-key",
  "demo-placeholder-evidence-token",
  "demo-placeholder-github-token",
  "demo-placeholder-provider-monitoring-key",
  "demo-placeholder-monitoring-app-key",
]);

function demoCredential(field: string): string {
  switch (field) {
    case "chatbotApiKey":
      return process.env.CHATBOT_API_KEY?.trim() ?? "";
    case "cloudApiKey":
      return process.env.CLOUD_AUDIT_API_KEY?.trim() ?? "";
    case "monitoringApiKey":
      return process.env.MONITORING_API_KEY?.trim() ?? "";
    case "evidenceManifestToken":
      // The demo target protects its manifest with the same read-only audit key.
      return process.env.CLOUD_AUDIT_API_KEY?.trim() ?? "";
    default:
      // GitHub and direct Datadog/Grafana collectors have no bundled demo access.
      return "";
  }
}

export function resolveServerCredentialRecord(
  credentials: Record<string, string> = {},
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(credentials).map(([field, value]) => [
      field,
      DEMO_PLACEHOLDERS.has(value.trim()) ? demoCredential(field) : value,
    ]),
  );
}

export function resolveServerCredentials(input: AssessmentInput): AssessmentInput {
  return {
    ...input,
    credentials: resolveServerCredentialRecord(input.credentials),
  };
}

