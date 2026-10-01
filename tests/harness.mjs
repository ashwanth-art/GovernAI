/**
 * Shared test harness.
 *
 * Imports the built worker and installs a stub `fetch` that stands in for the
 * assessed target, its adapters, the evidence manifest host, GitHub and CI. No
 * test ever reaches the public internet, and no real credential is used.
 */

export async function worker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

export const env = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

export const context = { waitUntil() {}, passThroughOnException() {} };

/**
 * Every named procedure the verification library depends on, so a Tier 3 run can
 * reach full coverage in tests the way it does against a real evidence surface.
 * A handful are deliberately not pass, so Tier 3 still produces findings.
 */
const LIBRARY_PROCEDURE_IDS = [
  "artifact-access-review", "artifact-architecture-diagram", "artifact-audit-log-sample",
  "artifact-bias-evaluation", "artifact-change-history", "artifact-cost-budgets",
  "artifact-data-flow", "artifact-dependency-scan", "artifact-encryption-configuration",
  "artifact-explainability-tests", "artifact-integrity-verification", "artifact-log-review-records",
  "artifact-model-provenance", "artifact-monitor-thresholds", "artifact-network-configuration",
  "artifact-output-encoding", "artifact-output-sink-review", "artifact-privacy-tests",
  "artifact-rag-corpus-manifest", "artifact-rate-limits", "artifact-resource-limits",
  "artifact-sbom", "artifact-schema-validation", "artifact-security-tests",
  "artifact-system-inventory", "artifact-threat-model", "artifact-tool-permissions",
  "artifact-training-completion", "artifact-vector-configuration",
  "document-ai-governance-policy", "document-ai-transparency", "document-backup-plan",
  "document-change-policy", "document-disaster-recovery", "document-evaluation-methodology",
  "document-feedback-process", "document-human-oversight", "document-incident-runbook",
  "document-privacy-notice", "document-record-retention", "document-risk-register",
  "document-risk-treatment", "document-role-assignment", "document-supplier-assessment",
  "document-system-card", "document-training-program", "document-vendor-contracts",
  // The PCI DSS pack's own procedures, which the library does not use.
  "artifact-cde-mfa-configuration", "artifact-chat-pan-detection", "artifact-pan-discovery-scan",
  "artifact-payment-page-script-inventory", "artifact-payment-page-tamper-detection",
  "artifact-penetration-test-report", "artifact-secret-scan", "artifact-tenant-separation-pentest",
  "document-pan-messaging-policy", "document-pci-scope", "document-test-data-policy",
  "document-tpsp-responsibility-matrix", "document-unexpected-pan-procedure",
];

/** Mirrors the open items a real deployment carries, so Tier 3 is not all green. */
export const NON_PASSING_PROCEDURES = {
  "artifact-integrity-verification": "fail",
  "artifact-bias-evaluation": "fail",
  "document-record-retention": "fail",
  "document-evaluation-methodology": "partial",
  "document-disaster-recovery": "partial",
  "document-backup-plan": "partial",
};

const libraryManifest = Object.fromEntries(
  LIBRARY_PROCEDURE_IDS.map((id) => {
    const status = NON_PASSING_PROCEDURES[id] ?? "pass";
    return [
      id,
      {
        status,
        summary:
          status === "pass"
            ? `Named procedure ${id} returned a pass verdict.`
            : `Named procedure ${id} returned ${status}.`,
        confidence: status === "pass" ? 0.9 : 0.7,
      },
    ];
  }),
);

/**
 * The one thing about the stubbed target a test may change while it runs.
 *
 * Drift is only meaningful if the assessed system can actually change between two
 * cycles, so the monitor tests turn a real control off here and read what the next
 * cycle says about it. Everything else in this file is fixed.
 */
export const targetState = { injectionGuardrail: true };

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const request = input instanceof Request ? new Request(input, init) : new Request(input, init);
  const url = new URL(request.url);
  if (url.hostname === "target.test") {
    if (url.pathname === "/health") {
      return Response.json({
        status: "healthy",
        dependencies: { openai: "configured", mongodb: "healthy" },
      });
    }
    if (url.pathname === "/v1/web-chat") {
      const body = await request.json();
      const prompt = String(body.messages?.[0]?.content ?? "");
      if (/hidden system prompt/i.test(prompt)) {
        return Response.json({ detail: "Adversarial prompt rejected." }, { status: 400 });
      }
      if (/API key|password|connection string/i.test(prompt)) {
        return Response.json({
          answer: "I do not have access to private credentials.",
          sources: [],
          request_id: "req-leakage",
          grounded: false,
        });
      }
      if (/weather in Tokyo/i.test(prompt)) {
        return Response.json({
          answer: "Current weather is not available in the approved knowledge base.",
          sources: [],
          request_id: "req-scope",
          grounded: false,
        });
      }
      return Response.json({
        answer: "The organization provides cloud, data, and AI services.",
        sources: [
          { document: "approved-knowledge.md", chunk: 3, score: 0.91 },
          { document: "approved-knowledge.md", chunk: 8, score: 0.82 },
        ],
        request_id: "req-grounded",
        grounded: true,
      });
    }
    if (url.pathname === "/api/monitoring/summary") {
      return request.headers.get("authorization") === "Bearer test-only-monitoring-key"
        ? Response.json({
            provider: "Prometheus + Grafana OSS",
            metrics_endpoint: "/metrics",
            request_trace_endpoint: "/api/monitoring/requests/{request_id}",
            trace_schema_version: "1.0",
            tracked: ["request count", "latency", "retrieval count"],
            log_policy: "Prompts, responses, and credentials are not logged.",
            service_levels: {
              objectives: { p95_latency_ms: 3000, error_rate: 0.02 },
              observed: { requests_counted: 12, error_rate: 0.0, p50_latency_ms: 780, p95_latency_ms: 1420 },
              breaches: [],
            },
            // Deliberately zero: metrics are exported, objectives are declared, and
            // nothing watches either — so both alert-routing and objective-coverage
            // report the gap rather than being absent facts.
            alerting: {
              rules_configured: 0,
              rules: [],
              rule_source: "monitoring/alert_rules.yml",
              notification_channels: [],
              objectives_with_a_rule: [],
              dashboards_provisioned: 0,
            },
            // A windowed series with traffic in it: the surface a monitor needs to
            // answer "did this get worse", as opposed to a counter that only rises.
            series: {
              schema_version: "1.0",
              bucket_seconds: 60,
              buckets_retained: 120,
              window_seconds: 7200,
              contains_prompt_or_response: false,
              buckets: [
                {
                  bucket_start: "2026-07-28T09:00:00Z",
                  requests: 7,
                  successes: 7,
                  guardrail_blocks: 0,
                  bounded_refusals: 0,
                  dependency_errors: 0,
                  limit_rejections: 0,
                  mean_duration_ms: 810,
                  max_duration_ms: 1420,
                },
                {
                  bucket_start: "2026-07-28T09:01:00Z",
                  requests: 5,
                  successes: 3,
                  guardrail_blocks: 1,
                  bounded_refusals: 1,
                  dependency_errors: 0,
                  limit_rejections: 0,
                  mean_duration_ms: 760,
                  max_duration_ms: 1180,
                },
              ],
            },
            events: {
              schema_version: "1.0",
              retention_seconds: 21600,
              capacity: 200,
              recorded: 2,
              kinds_tracked: ["blocked", "bounded_refusal", "dependency_error", "rate_limited"],
              contains_prompt_or_response: false,
              events: [
                {
                  at: "2026-07-28T09:01:12Z",
                  status: "blocked",
                  reason: "prompt_injection_guardrail",
                  request_id: "req-blocked",
                  duration_ms: 42,
                },
                {
                  at: "2026-07-28T09:01:40Z",
                  status: "bounded_refusal",
                  reason: "outside_knowledge_base",
                  request_id: "req-scope",
                  duration_ms: 610,
                },
              ],
            },
            usage: {
              day: "2026-07-28",
              tokens_charged: 4210,
              daily_token_budget: 200000,
              budget_utilisation: 0.021,
              rate_limit_rejections: 0,
            },
            retention: {
              trace_retention_seconds: 3600,
              record_retention_days: null,
              record_disposal_enforced: false,
              prompt_and_response_persistence: false,
            },
          })
        : Response.json({ detail: "Unauthorized" }, { status: 401 });
    }
    if (url.pathname === "/api/audit/config") {
      return request.headers.get("authorization") === "Bearer test-only-cloud-key"
        ? Response.json({
            provider: "MongoDB Atlas + OpenAI API",
            access: "read-only",
            encryption_in_transit: "TLS",
            secrets: "environment variables",
            data_store: "tenant-filtered vector search",
            data_controls: {
              tenant_filtering: true,
              pii_response_redaction: true,
              prompt_injection_guardrail: targetState.injectionGuardrail,
            },
            deployment: {
              app_env: "development",
              declared_production: false,
              allowed_origins: ["http://localhost:8000"],
              allowed_origins_loopback_only: true,
              wildcard_origin: false,
              tls_terminated_at: "platform edge",
            },
            credentials: {
              keys_checked: ["CHATBOT_API_KEY", "CLOUD_AUDIT_API_KEY", "MONITORING_API_KEY"],
              placeholder_or_weak_keys: ["CHATBOT_API_KEY"],
              rotation_policy_days: null,
              last_rotated_on: null,
              fingerprints_only: true,
            },
            request_limits: {
              enabled: true,
              scope: "process",
              requests_per_minute: 30,
              per_caller: true,
              request_timeout_seconds: 45,
              max_output_tokens_ceiling: 2048,
              max_context_chars: 12000,
              daily_token_budget: 200000,
              distributed_enforcement: false,
            },
            retention: {
              trace_retention_seconds: 3600,
              record_retention_days: null,
              record_disposal_enforced: false,
              prompt_and_response_persistence: false,
            },
            vector_store: {
              index: "openai_vector_index",
              dimensions: 1536,
              similarity: "cosine",
              tenant_filter_field: "tenant_id",
              tenant_filter_enforced: true,
              top_k: 5,
            },
            model: {
              generation_model: "gpt-4.1-2025-04-14",
              generation_model_pinned: true,
              embedding_model: "text-embedding-3-small",
              embedding_dimensions: 1536,
            },
            agency: { tool_calling_enabled: false, function_definitions: 0, write_capabilities: [] },
            output_handling: {
              response_schema_enforced: true,
              response_model: "ChatResponse",
              downstream_interpreters: [],
            },
            corpus_integrity: {
              algorithm: "sha256",
              baseline_approved_on: "2026-07-26",
              documents_recorded: 6,
              documents_matched: 5,
              mismatched: [{ file: "05_healthcare.md", approved_on: "2026-07-26" }],
              missing: [],
              unrecorded: [],
              verified: false,
            },
            evidence: { manifest_endpoint: "/api/evidence/manifest", schema_version: "1.0" },
          })
        : Response.json({ detail: "Unauthorized" }, { status: 401 });
    }
    if (url.pathname.startsWith("/api/monitoring/requests/")) {
      const requestId = url.pathname.split("/").pop();
      return request.headers.get("authorization") === "Bearer test-only-monitoring-key"
        ? Response.json({
            schema_version: "1.0",
            request_id: requestId,
            status: "success",
            started_at: "2026-07-28T00:00:00.000Z",
            completed_at: "2026-07-28T00:00:00.010Z",
            duration_ms: 10,
            stages: [
              {
                name: "retrieval",
                status: "pass",
                summary: "Tenant-filtered vector retrieval completed.",
                duration_ms: 6,
                metrics: { chunks: 2, top_score: 0.91 },
              },
              {
                name: "output_validation",
                status: "pass",
                summary: "Output validation completed.",
                duration_ms: 4,
                metrics: { grounded: true },
              },
            ],
          })
        : Response.json({ detail: "Unauthorized" }, { status: 401 });
    }
  }
  if (url.hostname === "evidence.target.test") {
    return Response.json({
      schemaVersion: "1.0",
      generatedAt: "2026-07-28T00:00:00.000Z",
      procedures: {
        ...libraryManifest,
        "document-security-risk-analysis": {
          status: "pass",
          summary: "System-specific ePHI risk analysis is approved and current.",
          confidence: 0.95,
        },
        "artifact-threat-model": {
          status: "pass",
          summary: "Threat model covers the RAG pipeline and PHI trust boundaries.",
          confidence: 0.9,
        },
        "document-risk-register": {
          status: "partial",
          summary: "Risk register exists but two treatment dates are overdue.",
          confidence: 0.9,
        },
      },
    });
  }
  if (url.hostname === "github.com") {
    return new Response(null, { status: 200 });
  }
  if (url.hostname === "api.github.com") {
    if (url.pathname === "/repos/northstar/clinical-assistant") {
      return Response.json({ default_branch: "main" });
    }
    if (url.pathname === "/repos/northstar/clinical-assistant/branches/main/protection") {
      return Response.json({ required_status_checks: { strict: true } });
    }
    if (url.pathname === "/repos/northstar/clinical-assistant/actions/permissions") {
      return Response.json({ enabled: true, allowed_actions: "selected" });
    }
    if (url.pathname === "/repos/northstar/public-assistant") {
      return Response.json({ default_branch: "main" });
    }
    if (
      url.pathname === "/repos/northstar/public-assistant/branches/main/protection" ||
      url.pathname === "/repos/northstar/public-assistant/actions/permissions"
    ) {
      return Response.json({ message: "Requires repository administration access" }, { status: 401 });
    }
  }
  if (url.hostname === "ci.target.test") return new Response(null, { status: 204 });
  return nativeFetch(request);
};

export async function request(path, init) {
  const app = await worker();
  return app.fetch(new Request(`http://localhost${path}`, init), env, context);
}

/**
 * One worker instance, reused across several requests.
 *
 * `request` re-imports the module graph every call so no test can leak state into
 * another. The monitor store lives in that graph deliberately — it is the running
 * process's own memory — so a test that arms a monitor and then cycles it has to
 * talk to a single instance. The instance is still private to the caller.
 */
export async function session() {
  const app = await worker();
  return (path, init) => app.fetch(new Request(`http://localhost${path}`, init), env, context);
}

export const baseInput = {
  organization: "Northstar Health",
  systemName: "Clinical Knowledge Assistant",
  industryId: "healthcare",
  standardIds: ["hipaa", "iso42001", "nist_ai_rmf"],
  tier: 2,
  applicability: {
    hipaaRole: "covered_entity",
    handlesPhi: true,
    handlesEphi: true,
    usesPhiSubprocessors: true,
    maintainsDesignatedRecordSet: true,
    euTerritorialScope: "in_scope",
    euRole: "provider",
    euRiskClass: "high_risk",
    euArticle27Deployer: false,
    directHumanInteraction: true,
    pciScope: "cardholder_data_environment",
    pciPaymentPageWidget: true,
    pciMultiTenantProvider: true,
  },
  credentials: {
    chatbotEndpoint: "https://target.test/",
    tenantId: "aci-infotech",
    chatbotApiKey: "test-only-key",
    cloudProvider: "AWS",
    cloudApiKey: "test-only-cloud-key",
    monitoringProvider: "Datadog",
    monitoringApiKey: "test-only-monitoring-key",
    cicdUrl: "https://ci.target.test/actions",
  },
  architecture: {
    modelProvider: "OpenAI",
    modelName: "gpt-4.1",
    vectorDatabase: "Pinecone",
    embeddingModel: "text-embedding-model",
  },
};
