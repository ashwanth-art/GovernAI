import type { AssessmentInput, ControlStatus } from "./types";
import type { ProcedureEvidenceMap } from "./evidence-procedures";

export interface ProviderCollectorResult {
  id: string;
  provider: string;
  status: ControlStatus;
  summary: string;
  evidence: ProcedureEvidenceMap;
}

async function providerFetch(
  url: string,
  headers: Record<string, string>,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", ...headers },
      signal: controller.signal,
    });
    const text = await response.text();
    let data: unknown = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: {} };
  } finally {
    clearTimeout(timer);
  }
}

function githubRepository(value: string): { owner: string; repo: string } | null {
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== "github.com") return null;
    const [owner, rawRepo] = url.pathname.split("/").filter(Boolean);
    if (!owner || !rawRepo) return null;
    return { owner, repo: rawRepo.replace(/\.git$/, "") };
  } catch {
    return null;
  }
}

async function collectGitHub(input: AssessmentInput): Promise<ProviderCollectorResult | null> {
  const repository = githubRepository(input.credentials.repoUrl ?? "");
  if (!repository) return null;
  const headers: Record<string, string> = {
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (input.credentials.githubToken?.trim()) {
    headers.Authorization = `Bearer ${input.credentials.githubToken.trim()}`;
  }
  const base = `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`;
  const metadata = await providerFetch(base, headers);
  if (!metadata.ok) {
    return {
      id: "github",
      provider: "GitHub",
      status: metadata.status === 401 || metadata.status === 403 ? "not_assessed" : "fail",
      summary: `GitHub repository metadata was unavailable (HTTP ${metadata.status || "network error"}).`,
      evidence: {},
    };
  }
  const defaultBranch =
    typeof metadata.data === "object" &&
    metadata.data &&
    "default_branch" in metadata.data &&
    typeof metadata.data.default_branch === "string"
      ? metadata.data.default_branch
      : "main";
  const [protection, actions] = await Promise.all([
    providerFetch(`${base}/branches/${encodeURIComponent(defaultBranch)}/protection`, headers),
    providerFetch(`${base}/actions/permissions`, headers),
  ]);
  const branchStatus =
    protection.ok ? "pass" : protection.status === 404 ? "fail" : "not_assessed";
  const status: ControlStatus =
    branchStatus === "fail"
      ? "fail"
      : branchStatus === "pass" && actions.ok
        ? "pass"
        : "partial";
  return {
    id: "github",
    provider: "GitHub",
    status,
    summary: `Repository metadata retrieved; default-branch protection ${protection.ok ? "verified" : `not verified (HTTP ${protection.status || "network error"})`}; Actions permissions ${actions.ok ? "retrieved" : "not retrieved"}.`,
    evidence: {
      "artifact-change-history": {
        procedureId: "artifact-change-history",
        status: "pass",
        summary: `GitHub repository ${repository.owner}/${repository.repo} and default branch ${defaultBranch} were retrieved through the provider API.`,
        confidence: 0.9,
        sourceType: "provider_api",
      },
      "artifact-access-review": {
        procedureId: "artifact-access-review",
        status: branchStatus,
        summary: protection.ok
          ? `Branch protection is configured for ${defaultBranch}.`
          : `Branch protection could not be confirmed for ${defaultBranch} (HTTP ${protection.status || "network error"}).`,
        confidence: protection.ok || protection.status === 404 ? 0.9 : 0,
        sourceType: "provider_api",
      },
      "artifact-security-tests": {
        procedureId: "artifact-security-tests",
        status: actions.ok ? "partial" : "not_assessed",
        summary: actions.ok
          ? "GitHub Actions permissions were retrieved; workflow security-test content still requires manifest or source inspection."
          : "GitHub Actions permissions were not available.",
        confidence: actions.ok ? 0.65 : 0,
        sourceType: "provider_api",
      },
    },
  };
}

async function collectDatadog(input: AssessmentInput): Promise<ProviderCollectorResult | null> {
  if (!/datadog/i.test(input.credentials.monitoringProvider ?? "")) return null;
  const apiKey = input.credentials.providerMonitoringApiKey?.trim();
  const appKey = input.credentials.monitoringApplicationKey?.trim();
  if (!apiKey || !appKey) return null;
  const base = input.credentials.monitoringBaseUrl?.trim() || "https://api.datadoghq.com";
  const response = await providerFetch(`${base.replace(/\/$/, "")}/api/v1/monitor`, {
    "DD-API-KEY": apiKey,
    "DD-APPLICATION-KEY": appKey,
  });
  const monitorCount = Array.isArray(response.data) ? response.data.length : 0;
  const status: ControlStatus = !response.ok
    ? response.status === 401 || response.status === 403
      ? "not_assessed"
      : "fail"
    : monitorCount > 0
      ? "pass"
      : "partial";
  return {
    id: "datadog",
    provider: "Datadog",
    status,
    summary: response.ok
      ? `${monitorCount} Datadog monitors were retrieved through the provider API.`
      : `Datadog monitors were unavailable (HTTP ${response.status || "network error"}).`,
    evidence: response.ok
      ? {
          "adapter-monitoring-summary": {
            procedureId: "adapter-monitoring-summary",
            status: monitorCount > 0 ? "pass" : "partial",
            summary: `${monitorCount} configured Datadog monitors were returned.`,
            confidence: 0.9,
            sourceType: "provider_api",
          },
          "artifact-monitor-thresholds": {
            procedureId: "artifact-monitor-thresholds",
            status: monitorCount > 0 ? "pass" : "partial",
            summary: monitorCount > 0
              ? "Configured monitor definitions and thresholds were available."
              : "No configured monitor definitions were returned.",
            confidence: 0.85,
            sourceType: "provider_api",
          },
        }
      : {},
  };
}

async function collectGrafana(input: AssessmentInput): Promise<ProviderCollectorResult | null> {
  if (!/grafana/i.test(input.credentials.monitoringProvider ?? "")) return null;
  const token = input.credentials.providerMonitoringApiKey?.trim();
  const base = input.credentials.monitoringBaseUrl?.trim();
  if (!token || !base) return null;
  const headers = { Authorization: `Bearer ${token}` };
  const [health, alerts] = await Promise.all([
    providerFetch(`${base.replace(/\/$/, "")}/api/health`, headers),
    providerFetch(`${base.replace(/\/$/, "")}/api/v1/provisioning/alert-rules`, headers),
  ]);
  const alertCount = Array.isArray(alerts.data) ? alerts.data.length : 0;
  const status: ControlStatus =
    health.ok && alerts.ok ? (alertCount > 0 ? "pass" : "partial") : "not_assessed";
  return {
    id: "grafana",
    provider: "Grafana",
    status,
    summary: `Grafana health ${health.ok ? "verified" : "not verified"}; ${alerts.ok ? `${alertCount} alert rules retrieved` : "alert rules unavailable"}.`,
    evidence:
      health.ok && alerts.ok
        ? {
            "adapter-monitoring-summary": {
              procedureId: "adapter-monitoring-summary",
              status: alertCount > 0 ? "pass" : "partial",
              summary: `${alertCount} Grafana alert rules were returned from a healthy instance.`,
              confidence: 0.9,
              sourceType: "provider_api",
            },
            "artifact-monitor-thresholds": {
              procedureId: "artifact-monitor-thresholds",
              status: alertCount > 0 ? "pass" : "partial",
              summary: alertCount > 0
                ? "Provisioned alert-rule definitions were available."
                : "No provisioned alert rules were returned.",
              confidence: 0.85,
              sourceType: "provider_api",
            },
          }
        : {},
  };
}

export async function collectProviderEvidence(
  input: AssessmentInput,
): Promise<ProviderCollectorResult[]> {
  const results = await Promise.all([
    collectGitHub(input),
    collectDatadog(input),
    collectGrafana(input),
  ]);
  return results.filter(Boolean) as ProviderCollectorResult[];
}
