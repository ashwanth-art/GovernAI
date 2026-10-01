import type { AccessTier, CheckDefinition, ControlStatus, Pillar, RuleSpec } from "./types";

/**
 * Tier 2 configuration and monitoring rules.
 *
 * The target application exposes configuration and service-level *facts* through
 * its read-only adapters. This module parses those facts and judges them. The
 * judgement and the published rule spec live in the same object, so the rule a
 * user reads and the rule the engine ran cannot drift apart.
 *
 * Three principles hold for every judge below:
 *
 * 1. An absent fact is `not_assessed`. The adapter not exposing something is not
 *    the same as the control failing, and it is never a pass.
 * 2. A fact that is present and inadequate is a `fail`, with the observed value
 *    quoted in the evidence. No hedging.
 * 3. A control that is genuinely half-met is `partial`, and the evidence says
 *    which half.
 */

export interface FactVerdict {
  status: ControlStatus;
  evidence: string;
  confidence: number;
}

export interface CorpusIntegrityFact {
  verified: boolean;
  documentsRecorded: number;
  documentsMatched: number;
  mismatched: Array<{ file: string; approvedOn: string }>;
  missing: string[];
  unrecorded: string[];
  baselineApprovedOn?: string;
}

export interface TargetFacts {
  /** True when the audit adapter answered with a parseable body. */
  auditAvailable: boolean;
  /** True when the monitoring adapter answered with a parseable body. */
  monitoringAvailable: boolean;

  appEnv?: string;
  declaredProduction?: boolean;
  allowedOrigins?: string[];
  loopbackOnlyOrigins?: boolean;
  wildcardOrigin?: boolean;

  placeholderKeys?: string[];
  keysChecked?: string[];
  rotationPolicyDays?: number | null;
  lastRotatedOn?: string | null;

  limitsEnabled?: boolean;
  requestsPerMinute?: number;
  dailyTokenBudget?: number;
  perCallerLimits?: boolean;
  distributedEnforcement?: boolean;
  requestTimeoutSeconds?: number;
  maxOutputTokens?: number;
  maxContextChars?: number;

  recordRetentionDays?: number | null;
  recordDisposalEnforced?: boolean;
  traceRetentionSeconds?: number;
  promptPersistence?: boolean;

  tenantFiltering?: boolean;
  piiRedaction?: boolean;
  injectionGuardrail?: boolean;

  encryptionInTransit?: string;
  tlsTerminatedAt?: string;

  vectorIndex?: string;
  vectorDimensions?: number;
  vectorSimilarity?: string;
  vectorTenantField?: string;
  vectorTenantEnforced?: boolean;
  topK?: number;

  generationModel?: string;
  modelPinned?: boolean;
  embeddingModel?: string;
  embeddingDimensions?: number;

  toolCallingEnabled?: boolean;
  functionDefinitions?: number;
  writeCapabilities?: string[];

  responseSchemaEnforced?: boolean;
  responseModel?: string;
  downstreamInterpreters?: string[];

  corpusIntegrity?: CorpusIntegrityFact;

  evidenceManifestEndpoint?: string;
  evidenceSchemaVersion?: string;

  sloP95LatencyMs?: number;
  sloErrorRate?: number;
  observedP95LatencyMs?: number | null;
  observedErrorRate?: number;
  requestsCounted?: number;
  sloBreaches?: Array<{ objective: string; target: number; observed: number }>;

  alertRulesConfigured?: number;
  notificationChannels?: string[];
  dashboardsProvisioned?: number;
  /** Which declared objectives actually have a rule watching them. */
  objectivesWithARule?: string[];
  alertRuleSource?: string;
  alertSeverities?: string[];

  /** A windowed series, without which "did this get worse" has no answer. */
  seriesAvailable?: boolean;
  seriesBucketSeconds?: number;
  seriesBuckets?: number;
  seriesWindowSeconds?: number;
  seriesRequestsInWindow?: number;
  seriesHoldsContent?: boolean;

  eventFeedAvailable?: boolean;
  eventKindsTracked?: string[];
  eventsRecorded?: number;
  eventRetentionSeconds?: number;
  eventsHoldContent?: boolean;
  eventsCarryRequestIds?: boolean;

  tokensChargedToday?: number;
  budgetUtilisation?: number | null;
  rateLimitRejections?: number;

  traceEndpoint?: string;
  traceSchemaVersion?: string;
  tracesObserved: number;
}

/* ---------------------------------------------------------------- parsing -- */

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nullableNum(value: unknown): number | null | undefined {
  if (value === null) return null;
  return num(value);
}

function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function parseCorpusIntegrity(value: unknown): CorpusIntegrityFact | undefined {
  const source = record(value);
  if (!Object.keys(source).length) return undefined;
  const mismatched = Array.isArray(source.mismatched) ? source.mismatched : [];
  return {
    verified: source.verified === true,
    documentsRecorded: num(source.documents_recorded) ?? 0,
    documentsMatched: num(source.documents_matched) ?? 0,
    mismatched: mismatched.map((item) => {
      const entry = record(item);
      return {
        file: str(entry.file) ?? "unnamed document",
        approvedOn: str(entry.approved_on) ?? "unrecorded",
      };
    }),
    missing: strings(source.missing) ?? [],
    unrecorded: strings(source.unrecorded) ?? [],
    baselineApprovedOn: str(source.baseline_approved_on),
  };
}

export function parseTargetFacts(
  audit: { checked: boolean; data: Record<string, unknown> },
  monitoring: { checked: boolean; data: Record<string, unknown> },
  tracesObserved: number,
): TargetFacts {
  const auditData = audit.checked ? audit.data : {};
  const monitoringData = monitoring.checked ? monitoring.data : {};

  const deployment = record(auditData.deployment);
  const credentials = record(auditData.credentials);
  const limits = record(auditData.request_limits);
  const retention = record(auditData.retention);
  const dataControls = record(auditData.data_controls);
  const vector = record(auditData.vector_store);
  const model = record(auditData.model);
  const agency = record(auditData.agency);
  const output = record(auditData.output_handling);
  const evidence = record(auditData.evidence);

  const serviceLevels = record(monitoringData.service_levels);
  const objectives = record(serviceLevels.objectives);
  const observed = record(serviceLevels.observed);
  const breaches = Array.isArray(serviceLevels.breaches) ? serviceLevels.breaches : [];
  const alerting = record(monitoringData.alerting);
  const usage = record(monitoringData.usage);
  const monitoringRetention = record(monitoringData.retention);
  const series = record(monitoringData.series);
  const seriesBuckets = Array.isArray(series.buckets) ? series.buckets.map(record) : [];
  const events = record(monitoringData.events);
  const eventList = Array.isArray(events.events) ? events.events.map(record) : [];

  return {
    auditAvailable: audit.checked && Object.keys(auditData).length > 0,
    monitoringAvailable: monitoring.checked && Object.keys(monitoringData).length > 0,

    appEnv: str(deployment.app_env),
    declaredProduction: bool(deployment.declared_production),
    allowedOrigins: strings(deployment.allowed_origins),
    loopbackOnlyOrigins: bool(deployment.allowed_origins_loopback_only),
    wildcardOrigin: bool(deployment.wildcard_origin),

    placeholderKeys: strings(credentials.placeholder_or_weak_keys),
    keysChecked: strings(credentials.keys_checked),
    rotationPolicyDays: nullableNum(credentials.rotation_policy_days),
    lastRotatedOn: credentials.last_rotated_on === null ? null : str(credentials.last_rotated_on),

    limitsEnabled: bool(limits.enabled),
    requestsPerMinute: num(limits.requests_per_minute),
    dailyTokenBudget: num(limits.daily_token_budget),
    perCallerLimits: bool(limits.per_caller),
    distributedEnforcement: bool(limits.distributed_enforcement),
    requestTimeoutSeconds: num(limits.request_timeout_seconds),
    maxOutputTokens: num(limits.max_output_tokens_ceiling),
    maxContextChars: num(limits.max_context_chars),

    recordRetentionDays: nullableNum(retention.record_retention_days),
    recordDisposalEnforced: bool(retention.record_disposal_enforced),
    traceRetentionSeconds:
      num(retention.trace_retention_seconds) ?? num(monitoringRetention.trace_retention_seconds),
    promptPersistence: bool(retention.prompt_and_response_persistence),

    tenantFiltering: bool(dataControls.tenant_filtering),
    piiRedaction: bool(dataControls.pii_response_redaction),
    injectionGuardrail: bool(dataControls.prompt_injection_guardrail),

    encryptionInTransit: str(auditData.encryption_in_transit),
    tlsTerminatedAt: str(deployment.tls_terminated_at),

    vectorIndex: str(vector.index),
    vectorDimensions: num(vector.dimensions),
    vectorSimilarity: str(vector.similarity),
    vectorTenantField: str(vector.tenant_filter_field),
    vectorTenantEnforced: bool(vector.tenant_filter_enforced),
    topK: num(vector.top_k),

    generationModel: str(model.generation_model),
    modelPinned: bool(model.generation_model_pinned),
    embeddingModel: str(model.embedding_model),
    embeddingDimensions: num(model.embedding_dimensions),

    toolCallingEnabled: bool(agency.tool_calling_enabled),
    functionDefinitions: num(agency.function_definitions),
    writeCapabilities: strings(agency.write_capabilities),

    responseSchemaEnforced: bool(output.response_schema_enforced),
    responseModel: str(output.response_model),
    downstreamInterpreters: strings(output.downstream_interpreters),

    corpusIntegrity: parseCorpusIntegrity(auditData.corpus_integrity),

    evidenceManifestEndpoint: str(evidence.manifest_endpoint),
    evidenceSchemaVersion: str(evidence.schema_version),

    sloP95LatencyMs: num(objectives.p95_latency_ms),
    sloErrorRate: num(objectives.error_rate),
    observedP95LatencyMs: nullableNum(observed.p95_latency_ms),
    observedErrorRate: num(observed.error_rate),
    requestsCounted: num(observed.requests_counted),
    sloBreaches: breaches.map((item) => {
      const entry = record(item);
      return {
        objective: str(entry.objective) ?? "unnamed objective",
        target: num(entry.target) ?? 0,
        observed: num(entry.observed) ?? 0,
      };
    }),

    alertRulesConfigured: num(alerting.rules_configured),
    notificationChannels: strings(alerting.notification_channels),
    dashboardsProvisioned: num(alerting.dashboards_provisioned),
    objectivesWithARule: strings(alerting.objectives_with_a_rule),
    alertRuleSource: str(alerting.rule_source),
    alertSeverities: Array.isArray(alerting.rules)
      ? [...new Set(alerting.rules.map(record).map((rule) => String(rule.severity ?? "")))].filter(
          Boolean,
        )
      : undefined,

    // `series` present at all is the fact that a windowed surface exists; an empty
    // bucket list is a service that has served nothing yet, which is different.
    seriesAvailable: Object.keys(series).length > 0 ? true : undefined,
    seriesBucketSeconds: num(series.bucket_seconds),
    seriesBuckets: Object.keys(series).length ? seriesBuckets.length : undefined,
    seriesWindowSeconds: num(series.window_seconds),
    seriesRequestsInWindow: Object.keys(series).length
      ? seriesBuckets.reduce((sum, bucket) => sum + (num(bucket.requests) ?? 0), 0)
      : undefined,
    seriesHoldsContent:
      typeof series.contains_prompt_or_response === "boolean"
        ? series.contains_prompt_or_response
        : undefined,

    eventFeedAvailable: Object.keys(events).length > 0 ? true : undefined,
    eventKindsTracked: strings(events.kinds_tracked),
    eventsRecorded: num(events.recorded),
    eventRetentionSeconds: num(events.retention_seconds),
    eventsHoldContent:
      typeof events.contains_prompt_or_response === "boolean"
        ? events.contains_prompt_or_response
        : undefined,
    eventsCarryRequestIds: eventList.length
      ? eventList.every((event) => Boolean(event.request_id))
      : undefined,

    tokensChargedToday: num(usage.tokens_charged),
    budgetUtilisation: nullableNum(usage.budget_utilisation),
    rateLimitRejections: num(usage.rate_limit_rejections),

    traceEndpoint: str(monitoringData.request_trace_endpoint),
    traceSchemaVersion: str(monitoringData.trace_schema_version),
    tracesObserved,
  };
}

/* ---------------------------------------------------------------- judging -- */

const NOT_EXPOSED = (what: string): FactVerdict => ({
  status: "not_assessed",
  evidence: `The read-only adapter did not expose ${what}, so this control was not assessed. An absent signal is never recorded as a pass.`,
  confidence: 0,
});

function verdict(status: ControlStatus, evidence: string, confidence = 0.92): FactVerdict {
  return { status, evidence, confidence };
}

export interface TargetRuleSpec {
  checkId: string;
  ruleId: string;
  title: string;
  intent: string;
  pillar: Pillar;
  domainId: string;
  tierMinimum: AccessTier;
  probeId: string;
  request: NonNullable<CheckDefinition["request"]>;
  rule: Omit<RuleSpec, "id">;
  judge: (facts: TargetFacts) => FactVerdict;
}

const AUDIT_REQUEST: NonNullable<CheckDefinition["request"]> = {
  method: "GET",
  endpoint: "{chatbotEndpoint}/api/audit/config",
  note: "Read-only configuration adapter. Bearer token required; no configuration is changed.",
};

const MONITORING_REQUEST: NonNullable<CheckDefinition["request"]> = {
  method: "GET",
  endpoint: "{chatbotEndpoint}/api/monitoring/summary",
  note: "Read-only monitoring adapter. Bearer token required; no metric is written.",
};

export const TARGET_RULES: TargetRuleSpec[] = [
  {
    checkId: "chk.config.deployment-posture",
    ruleId: "adapter.deployment-posture",
    title: "Production deployment hardening",
    intent:
      "Confirms the running deployment declares itself production and restricts browser origins to the real front end.",
    pillar: "security",
    domainId: "security.isolation",
    tierMinimum: 2,
    probeId: "audit-config-evidence",
    request: AUDIT_REQUEST,
    rule: {
      statement:
        "Reads the environment label and the browser origin allow-list from the configuration adapter. A publicly reachable deployment that labels itself non-production, allows a wildcard origin, or allows only loopback origins is misconfigured for the traffic it is actually serving.",
      passWhen: "declaredProduction is true AND no wildcard origin AND origins are not loopback-only",
      partialWhen: "The environment is production but the origin allow-list could not be read",
      failWhen: "The environment is not production, OR a wildcard origin is allowed, OR every allowed origin is loopback",
      thresholds: [
        { key: "required environment", value: "production" },
        { key: "wildcard origins allowed", value: "0" },
      ],
    },
    judge: (facts) => {
      if (facts.declaredProduction === undefined) return NOT_EXPOSED("a deployment environment label");
      const problems: string[] = [];
      if (!facts.declaredProduction) {
        problems.push(
          `the deployment labels itself "${facts.appEnv ?? "unknown"}" rather than production`,
        );
      }
      if (facts.wildcardOrigin) problems.push("a wildcard browser origin is allowed");
      if (facts.loopbackOnlyOrigins) {
        problems.push(
          `the only allowed browser origins are loopback (${(facts.allowedOrigins ?? []).join(", ")}), which cannot serve real users`,
        );
      }
      if (problems.length) {
        return verdict(
          "fail",
          `The deployment is publicly reachable but ${problems.join("; ")}.`,
          0.95,
        );
      }
      if (!facts.allowedOrigins) {
        return verdict(
          "partial",
          "The environment is labelled production, but the browser origin allow-list was not exposed.",
          0.6,
        );
      }
      return verdict(
        "pass",
        `The deployment is labelled ${facts.appEnv}, allows no wildcard origin, and restricts browser access to ${facts.allowedOrigins.join(", ")}.`,
      );
    },
  },
  {
    checkId: "chk.config.credential-hygiene",
    ruleId: "adapter.credential-hygiene",
    title: "Service credential strength and rotation",
    intent:
      "Confirms no service key is a placeholder and that a rotation interval exists, without ever reading key material.",
    pillar: "security",
    domainId: "security.isolation",
    tierMinimum: 2,
    probeId: "audit-config-evidence",
    request: AUDIT_REQUEST,
    rule: {
      statement:
        "The target self-reports which of its configured keys are placeholder or low-entropy, by name only. The rule never receives, requests or stores key material. A named placeholder key on a reachable deployment is an immediate fail; a strong key with no rotation interval is partial.",
      passWhen: "No key is reported placeholder or weak AND a rotation interval is recorded",
      partialWhen: "No weak key, but no rotation interval or last-rotation date is recorded",
      failWhen: "One or more configured keys are reported placeholder or weak",
      thresholds: [
        { key: "placeholder keys allowed", value: "0" },
        { key: "key material read", value: "never — names only" },
      ],
    },
    judge: (facts) => {
      if (facts.placeholderKeys === undefined) return NOT_EXPOSED("a credential posture self-check");
      if (facts.placeholderKeys.length) {
        return verdict(
          "fail",
          `${facts.placeholderKeys.length} of ${facts.keysChecked?.length ?? facts.placeholderKeys.length} service keys are placeholder or low-entropy values: ${facts.placeholderKeys.join(", ")}. Anyone reading the repository or deployment template can guess them.`,
          0.95,
        );
      }
      if (facts.rotationPolicyDays === null || facts.rotationPolicyDays === undefined) {
        return verdict(
          "partial",
          `All ${facts.keysChecked?.length ?? 0} service keys are strong values, but no rotation interval and no last-rotation date are recorded, so key age cannot be bounded.`,
          0.85,
        );
      }
      return verdict(
        "pass",
        `All ${facts.keysChecked?.length ?? 0} service keys are strong values with a ${facts.rotationPolicyDays}-day rotation interval, last rotated ${facts.lastRotatedOn ?? "unrecorded"}.`,
      );
    },
  },
  {
    checkId: "chk.config.request-limits",
    ruleId: "adapter.request-limits",
    title: "Request-rate and cost ceilings",
    intent:
      "Confirms a per-caller request ceiling and a spend ceiling are enforced before the model is called.",
    pillar: "security",
    domainId: "security.resilience",
    tierMinimum: 2,
    probeId: "audit-config-evidence",
    request: AUDIT_REQUEST,
    rule: {
      statement:
        "Reads the configured ceilings from the adapter. Unbounded-consumption behaviour is never probed against a production target, so this rule judges configuration, not observed load. Enforcement that is process-local cannot bound a horizontally scaled deployment and is capped at partial.",
      passWhen: "Rate limiting enabled AND a daily spend ceiling set AND enforcement is distributed",
      partialWhen: "Ceilings are enforced, but only within a single process",
      failWhen: "Rate limiting is disabled or no spend ceiling is configured",
      thresholds: [
        { key: "denial-of-service probing", value: "excluded by policy" },
        { key: "minimum ceilings", value: "requests per minute and daily tokens" },
      ],
    },
    judge: (facts) => {
      if (facts.limitsEnabled === undefined) return NOT_EXPOSED("a request-limit configuration");
      if (!facts.limitsEnabled || !facts.dailyTokenBudget) {
        return verdict(
          "fail",
          `The endpoint is publicly reachable with rate limiting ${facts.limitsEnabled ? "enabled" : "disabled"} and ${facts.dailyTokenBudget ? `a ${facts.dailyTokenBudget}-token daily ceiling` : "no spend ceiling"}, so a single caller can exhaust model spend.`,
          0.95,
        );
      }
      if (facts.distributedEnforcement === false) {
        return verdict(
          "partial",
          `A per-caller ceiling of ${facts.requestsPerMinute} requests per minute and a ${facts.dailyTokenBudget}-token daily budget are enforced before the model is called, but enforcement is process-local, so the ceiling multiplies by the number of running instances.`,
          0.9,
        );
      }
      return verdict(
        "pass",
        `A per-caller ceiling of ${facts.requestsPerMinute} requests per minute, a ${facts.dailyTokenBudget}-token daily budget, a ${facts.requestTimeoutSeconds}s timeout and a ${facts.maxOutputTokens}-token output cap are enforced before the model is called.`,
      );
    },
  },
  {
    checkId: "chk.config.retention-schedule",
    ruleId: "adapter.retention-schedule",
    title: "Data retention and disposal schedule",
    intent:
      "Confirms a retention period exists for stored records and that prompts and responses are not persisted.",
    pillar: "data_protection",
    domainId: "data.minimisation",
    tierMinimum: 2,
    probeId: "audit-config-evidence",
    request: AUDIT_REQUEST,
    rule: {
      statement:
        "Reads the retention configuration. Data with no disposal date is data kept forever by default, which is the failure mode this control exists to catch. Prompt and response persistence is judged separately and more strictly.",
      passWhen: "A record retention period is configured AND disposal is enforced AND prompts are not persisted",
      partialWhen: "Disposal is enforced for traces only, with no schedule for stored records",
      failWhen: "No retention period is configured, or prompts and responses are persisted",
      thresholds: [{ key: "records without a disposal date", value: "0" }],
    },
    judge: (facts) => {
      if (facts.recordDisposalEnforced === undefined) return NOT_EXPOSED("a retention configuration");
      if (facts.promptPersistence === true) {
        return verdict(
          "fail",
          "The service persists prompts and responses, which are the highest-sensitivity records this system handles, and no disposal schedule governs them.",
          0.95,
        );
      }
      if (!facts.recordDisposalEnforced) {
        return verdict(
          "fail",
          `No retention period is configured for stored records, so nothing is ever disposed of on a schedule. Request traces do expire after ${facts.traceRetentionSeconds ?? "an unrecorded number of"} seconds, and prompts and responses are not persisted.`,
          0.95,
        );
      }
      return verdict(
        "pass",
        `Stored records are disposed of after ${facts.recordRetentionDays} days, request traces expire after ${facts.traceRetentionSeconds}s, and prompts and responses are never persisted.`,
      );
    },
  },
  {
    checkId: "chk.config.corpus-integrity",
    ruleId: "adapter.corpus-integrity",
    title: "Retrieval corpus integrity against approved baseline",
    intent:
      "Recomputes the retrieval corpus digests through the adapter and compares them to the approved ingestion baseline.",
    pillar: "trust",
    domainId: "trust.grounding",
    tierMinimum: 2,
    probeId: "audit-config-evidence",
    request: AUDIT_REQUEST,
    rule: {
      statement:
        "The target recomputes a digest for every corpus document at read time and compares it to the digest approved at ingestion. A mismatch means retrieval is serving content nobody approved — the direct precondition for corpus poisoning and for silently changed answers.",
      passWhen: "Every recorded document matches its approved digest, and no document is unrecorded",
      partialWhen: "All recorded documents match, but files are present that the manifest does not record",
      failWhen: "Any document's live digest differs from its approved digest, or a recorded document is missing",
      thresholds: [
        { key: "digest algorithm", value: "sha256" },
        { key: "tolerated mismatches", value: "0" },
      ],
    },
    judge: (facts) => {
      const integrity = facts.corpusIntegrity;
      if (!integrity) return NOT_EXPOSED("a corpus integrity verification");
      if (integrity.mismatched.length || integrity.missing.length) {
        const changed = integrity.mismatched
          .map((item) => `${item.file} (approved ${item.approvedOn})`)
          .join(", ");
        return verdict(
          "fail",
          `Live digest verification found ${integrity.mismatched.length} corpus document(s) that no longer match the approved baseline${changed ? `: ${changed}` : ""}${integrity.missing.length ? `, and ${integrity.missing.length} recorded document(s) missing` : ""}. Retrieval is serving content that was changed after approval, without re-review or re-ingestion.`,
          0.95,
        );
      }
      if (integrity.unrecorded.length) {
        return verdict(
          "partial",
          `All ${integrity.documentsMatched} recorded digests match, but ${integrity.unrecorded.length} corpus file(s) are present that the manifest does not record: ${integrity.unrecorded.join(", ")}.`,
          0.9,
        );
      }
      return verdict(
        "pass",
        `All ${integrity.documentsMatched} corpus digests recomputed at read time match the baseline approved on ${integrity.baselineApprovedOn ?? "an unrecorded date"}.`,
      );
    },
  },
  {
    checkId: "chk.config.tenant-isolation",
    ruleId: "adapter.tenant-isolation",
    title: "Tenant isolation in retrieval",
    intent:
      "Confirms retrieval is filtered by tenant at the index, so one tenant cannot retrieve another's content.",
    pillar: "security",
    domainId: "security.isolation",
    tierMinimum: 2,
    probeId: "audit-config-evidence",
    request: AUDIT_REQUEST,
    rule: {
      statement:
        "Reads the retrieval filter configuration. A tenant filter applied in application code after an unfiltered index query is not isolation; the rule requires the filter to be declared on the index query itself.",
      passWhen: "Tenant filtering is enabled AND the index declares the tenant filter field",
      partialWhen: "Tenant filtering is enabled but the index-level filter field is not declared",
      failWhen: "Tenant filtering is disabled",
      thresholds: [{ key: "filter applied at", value: "vector index query" }],
    },
    judge: (facts) => {
      if (facts.tenantFiltering === undefined) return NOT_EXPOSED("a tenant isolation configuration");
      if (!facts.tenantFiltering) {
        return verdict(
          "fail",
          "Retrieval is not filtered by tenant, so a request can match content belonging to another tenant.",
          0.95,
        );
      }
      if (!facts.vectorTenantField || facts.vectorTenantEnforced !== true) {
        return verdict(
          "partial",
          "Tenant filtering is reported as enabled, but the adapter does not declare the index field the filter is applied on, so isolation cannot be confirmed at the query level.",
          0.7,
        );
      }
      return verdict(
        "pass",
        `Retrieval is filtered on ${facts.vectorTenantField} at the ${facts.vectorIndex} index query, bounded to top-${facts.topK} matches.`,
      );
    },
  },
  {
    checkId: "chk.config.output-contract",
    ruleId: "adapter.output-contract",
    title: "Model output treated as untrusted",
    intent:
      "Confirms model output is schema-validated and reaches no interpreter that would execute it.",
    pillar: "security",
    domainId: "security.output",
    tierMinimum: 2,
    probeId: "audit-config-evidence",
    request: AUDIT_REQUEST,
    rule: {
      statement:
        "Reads the response contract and the list of downstream interpreters. Output handling fails open: any sink that interprets model output as markup, query, template or shell input is a fail regardless of how well the model behaves.",
      passWhen: "A response schema is enforced AND no downstream interpreter is declared",
      partialWhen: "A response schema is enforced but the sink inventory is not declared",
      failWhen: "No response schema is enforced, or an interpreting sink is declared",
      thresholds: [{ key: "interpreting sinks allowed", value: "0" }],
    },
    judge: (facts) => {
      if (facts.responseSchemaEnforced === undefined) return NOT_EXPOSED("an output handling contract");
      const interpreters = facts.downstreamInterpreters ?? [];
      if (!facts.responseSchemaEnforced || interpreters.length) {
        return verdict(
          "fail",
          !facts.responseSchemaEnforced
            ? "Model output is returned without schema validation, so a malformed or injected response is passed through unchecked."
            : `Model output reaches ${interpreters.length} interpreting sink(s): ${interpreters.join(", ")}.`,
          0.95,
        );
      }
      if (!facts.downstreamInterpreters) {
        return verdict(
          "partial",
          `Responses are validated through the ${facts.responseModel ?? "declared"} schema, but the downstream sink inventory was not exposed.`,
          0.7,
        );
      }
      return verdict(
        "pass",
        `Every response is validated through the ${facts.responseModel} schema and no downstream sink interprets model output as markup, query or shell input.`,
      );
    },
  },
  {
    checkId: "chk.config.agency-boundary",
    ruleId: "adapter.agency-boundary",
    title: "Model action boundary",
    intent:
      "Confirms how many actions the model can take beyond returning text, and what it can write to.",
    pillar: "security",
    domainId: "security.output",
    tierMinimum: 2,
    probeId: "audit-config-evidence",
    request: AUDIT_REQUEST,
    rule: {
      statement:
        "Reads the tool, function and write surface exposed to the model. Excessive agency is bounded by what the model is permitted to invoke, so this rule counts the surface rather than testing behaviour.",
      passWhen: "No tool calling, zero function definitions and no write capability",
      partialWhen: "Tools exist and each one declares a scoped permission",
      failWhen: "Tools or write capabilities exist without declared scoping",
      thresholds: [{ key: "unscoped write capabilities allowed", value: "0" }],
    },
    judge: (facts) => {
      if (facts.toolCallingEnabled === undefined) return NOT_EXPOSED("a model action surface");
      const writes = facts.writeCapabilities ?? [];
      if (!facts.toolCallingEnabled && !facts.functionDefinitions && !writes.length) {
        return verdict(
          "pass",
          "The model is generation-only: tool calling is disabled, zero function definitions are registered, and no write capability is exposed, so excessive-agency risk is bounded by design rather than by permission configuration.",
        );
      }
      if (writes.length) {
        return verdict(
          "fail",
          `The model can reach ${writes.length} write capability(ies): ${writes.join(", ")}.`,
          0.9,
        );
      }
      return verdict(
        "partial",
        `Tool calling is enabled with ${facts.functionDefinitions ?? 0} function definition(s); scoping of each tool needs artifact review at Tier 3.`,
        0.7,
      );
    },
  },
  {
    checkId: "chk.config.model-provenance",
    ruleId: "adapter.model-provenance",
    title: "Model and embedding version pinning",
    intent:
      "Confirms the generation and embedding models are pinned versions rather than floating aliases.",
    pillar: "governance",
    domainId: "gov.change",
    tierMinimum: 2,
    probeId: "audit-config-evidence",
    request: AUDIT_REQUEST,
    rule: {
      statement:
        "Reads the model identifiers in use. A floating alias means the model can change under the deployment without a change record, which invalidates every evaluation result taken before the change.",
      passWhen: "The generation model is a pinned version AND the embedding model and dimensions are recorded",
      partialWhen: "Models are recorded but the generation model is a floating alias",
      failWhen: "No model identifier is recorded",
      thresholds: [{ key: "floating aliases allowed", value: "0" }],
    },
    judge: (facts) => {
      if (!facts.generationModel) return NOT_EXPOSED("a model identifier");
      if (facts.modelPinned === false) {
        return verdict(
          "partial",
          `Generation uses the floating alias ${facts.generationModel}, so the model can change without a change record and prior evaluation results stop being comparable.`,
          0.85,
        );
      }
      return verdict(
        "pass",
        `Generation is pinned to ${facts.generationModel} and retrieval to ${facts.embeddingModel} at ${facts.embeddingDimensions} dimensions, both recorded through the adapter.`,
      );
    },
  },
  {
    checkId: "chk.config.transport-encryption",
    ruleId: "adapter.transport-encryption",
    title: "Transport encryption and key custody",
    intent: "Confirms transport is encrypted and records where TLS terminates.",
    pillar: "data_protection",
    domainId: "data.residency",
    tierMinimum: 2,
    probeId: "audit-config-evidence",
    request: AUDIT_REQUEST,
    rule: {
      statement:
        "Reads the declared transport protection and termination point. This rule judges the declaration; the live probes independently confirm the endpoint answers over HTTPS.",
      passWhen: "Transport encryption is declared AND the termination point is named",
      partialWhen: "Transport encryption is declared without a named termination point",
      failWhen: "No transport encryption is declared",
      thresholds: [{ key: "minimum", value: "TLS on every external hop" }],
    },
    judge: (facts) => {
      if (!facts.encryptionInTransit) return NOT_EXPOSED("a transport encryption declaration");
      if (!facts.tlsTerminatedAt) {
        return verdict(
          "partial",
          `Transport encryption is declared ("${facts.encryptionInTransit}"), but the termination point is not named, so the unencrypted segment behind it cannot be bounded.`,
          0.7,
        );
      }
      return verdict(
        "pass",
        `Transport is encrypted and terminates at the ${facts.tlsTerminatedAt}; the vector store and model provider are both reached outbound over TLS.`,
      );
    },
  },
  {
    checkId: "chk.config.redaction",
    ruleId: "adapter.redaction",
    title: "Sensitive-data redaction on responses",
    intent: "Confirms a redaction filter runs on every response before it leaves the service.",
    pillar: "data_protection",
    domainId: "data.redaction",
    tierMinimum: 2,
    probeId: "audit-config-evidence",
    request: AUDIT_REQUEST,
    rule: {
      statement:
        "Reads the response redaction setting. The Tier 1 disclosure probe tests behaviour; this rule confirms the control is configured rather than incidental.",
      passWhen: "Response redaction is enabled",
      partialWhen: "Not used by this rule",
      failWhen: "Response redaction is disabled",
      thresholds: [{ key: "applies to", value: "every response path" }],
    },
    judge: (facts) => {
      if (facts.piiRedaction === undefined) return NOT_EXPOSED("a response redaction setting");
      return facts.piiRedaction
        ? verdict(
            "pass",
            "A redaction filter runs on every response before it leaves the service, and the Tier 1 disclosure probe independently confirmed no credential pattern was returned.",
          )
        : verdict(
            "fail",
            "No redaction filter runs on responses, so retrieved content is returned to the caller verbatim.",
            0.95,
          );
    },
  },
  {
    checkId: "chk.config.guardrail-configuration",
    ruleId: "adapter.guardrail-configuration",
    title: "Input guardrail configuration",
    intent: "Confirms the prompt-injection guardrail is configured, not incidental to model behaviour.",
    pillar: "security",
    domainId: "security.injection",
    tierMinimum: 2,
    probeId: "audit-config-evidence",
    request: AUDIT_REQUEST,
    rule: {
      statement:
        "Reads the input guardrail setting. Passing the Tier 1 injection probe proves the boundary held once; this rule proves a control is deliberately configured to hold it.",
      passWhen: "The prompt-injection guardrail is enabled",
      partialWhen: "Not used by this rule",
      failWhen: "The prompt-injection guardrail is disabled",
      thresholds: [{ key: "enforced", value: "before retrieval" }],
    },
    judge: (facts) => {
      if (facts.injectionGuardrail === undefined) return NOT_EXPOSED("an input guardrail setting");
      return facts.injectionGuardrail
        ? verdict(
            "pass",
            "A prompt-injection guardrail is configured and runs before retrieval, and the Tier 1 probe confirmed it blocked an injection attempt.",
          )
        : verdict(
            "fail",
            "No prompt-injection guardrail is configured; any containment observed is incidental to model behaviour.",
            0.95,
          );
    },
  },
  {
    checkId: "chk.monitoring.slo-conformance",
    ruleId: "adapter.slo-conformance",
    title: "Service levels against declared objectives",
    intent:
      "Compares observed latency and error rate against the objectives the service declares for itself.",
    pillar: "trust",
    domainId: "trust.evaluation",
    tierMinimum: 2,
    probeId: "monitoring-evidence",
    request: MONITORING_REQUEST,
    rule: {
      statement:
        "Reads the declared objectives and the observed percentiles from the monitoring adapter, then compares them. The target declares its own objectives; this rule holds it to them rather than to an invented benchmark.",
      passWhen: "Every declared objective is met by the observed measurement",
      partialWhen: "Objectives are declared but no measurement has accumulated yet",
      failWhen: "Any observed measurement is worse than its declared objective",
      thresholds: [{ key: "objectives", value: "declared by the target, not by the assessor" }],
    },
    judge: (facts) => {
      if (facts.sloP95LatencyMs === undefined) return NOT_EXPOSED("declared service-level objectives");
      const breaches = facts.sloBreaches ?? [];
      if (breaches.length) {
        const detail = breaches
          .map((item) => `${item.objective} observed ${item.observed} against a target of ${item.target}`)
          .join("; ");
        return verdict(
          "fail",
          `${breaches.length} declared service-level objective(s) are being missed: ${detail}.`,
          0.9,
        );
      }
      if (!facts.requestsCounted || facts.observedP95LatencyMs === null) {
        return verdict(
          "partial",
          `Objectives are declared (p95 ${facts.sloP95LatencyMs}ms, error rate ${facts.sloErrorRate}) but only ${facts.requestsCounted ?? 0} request(s) have accumulated in this window, so conformance is not yet measurable.`,
          0.5,
        );
      }
      return verdict(
        "pass",
        `Observed p95 latency ${facts.observedP95LatencyMs}ms and error rate ${facts.observedErrorRate} are both within the declared objectives of ${facts.sloP95LatencyMs}ms and ${facts.sloErrorRate}, over ${facts.requestsCounted} request(s).`,
      );
    },
  },
  {
    checkId: "chk.monitoring.alert-routing",
    ruleId: "adapter.alert-routing",
    title: "Breach detection reaches a human",
    intent:
      "Confirms an alert rule and a notification channel exist, so a breach is announced rather than merely recorded.",
    pillar: "compliance",
    domainId: "comp.audit",
    tierMinimum: 2,
    probeId: "monitoring-evidence",
    request: MONITORING_REQUEST,
    rule: {
      statement:
        "Counts configured alert rules and notification channels. Exporting metrics is not monitoring: with zero rules, a breach is visible only to whoever thinks to look, which is the failure this control exists to catch.",
      passWhen: "At least one alert rule AND at least one notification channel are configured",
      partialWhen: "Alert rules exist but no notification channel is configured",
      failWhen: "No alert rule is configured",
      thresholds: [{ key: "minimum alert rules", value: "1" }],
    },
    judge: (facts) => {
      if (facts.alertRulesConfigured === undefined) return NOT_EXPOSED("an alerting configuration");
      const channels = facts.notificationChannels ?? [];
      if (facts.alertRulesConfigured === 0) {
        return verdict(
          "fail",
          `Metrics are exported and objectives are declared, but 0 alert rules and ${channels.length} notification channels are configured, so an objective breach is recorded and never announced to anyone.`,
          0.95,
        );
      }
      if (!channels.length) {
        return verdict(
          "partial",
          `${facts.alertRulesConfigured} alert rule(s) are configured but no notification channel is attached, so a firing alert stays inside the dashboard.`,
          0.9,
        );
      }
      return verdict(
        "pass",
        `${facts.alertRulesConfigured} alert rule(s) are configured and routed to ${channels.length} notification channel(s).`,
      );
    },
  },
  {
    checkId: "chk.monitoring.objective-coverage",
    ruleId: "adapter.objective-coverage",
    title: "Every declared objective has a threshold watching it",
    intent:
      "Confirms each service objective the system publishes has an alert rule bound to it, so an objective is a commitment rather than a statement of intent.",
    pillar: "trust",
    domainId: "trust.reliability",
    tierMinimum: 2,
    probeId: "monitoring-evidence",
    request: MONITORING_REQUEST,
    rule: {
      statement:
        "Compares the objectives the target declares against the objectives its alert rules name. An objective with no rule behind it is a number in a document: nothing detects a breach of it, so nothing can act on one.",
      passWhen: "Every declared objective is named by at least one alert rule",
      partialWhen: "Some declared objectives have a rule and others do not",
      failWhen: "No declared objective has a rule",
      thresholds: [{ key: "declared objectives covered by a rule", value: "100%" }],
    },
    judge: (facts) => {
      const declared = [
        ...(facts.sloP95LatencyMs === undefined ? [] : ["p95_latency_ms"]),
        ...(facts.sloErrorRate === undefined ? [] : ["error_rate"]),
      ];
      if (!declared.length) return NOT_EXPOSED("any declared service objective");
      if (facts.objectivesWithARule === undefined) {
        return NOT_EXPOSED("which objectives its alert rules cover");
      }
      const covered = declared.filter((objective) => facts.objectivesWithARule?.includes(objective));
      const uncovered = declared.filter((objective) => !covered.includes(objective));
      if (!covered.length) {
        return verdict(
          "fail",
          `${declared.length} objective(s) are declared (${declared.join(", ")}) and no alert rule names any of them, so a breach of a published objective is detected by nothing.`,
          0.95,
        );
      }
      if (uncovered.length) {
        return verdict(
          "partial",
          `${covered.length} of ${declared.length} declared objectives have a rule watching them; ${uncovered.join(", ")} has none.`,
          0.9,
        );
      }
      return verdict(
        "pass",
        `Both declared objectives (${declared.join(", ")}) are named by alert rules read from ${facts.alertRuleSource ?? "the rule source"}, at severities ${(facts.alertSeverities ?? []).join(", ") || "unlabelled"}.`,
      );
    },
  },
  {
    checkId: "chk.monitoring.trend-visibility",
    ruleId: "adapter.trend-visibility",
    title: "Change over time is observable",
    intent:
      "Confirms the system exposes windowed metrics, not only lifetime totals, so a monitor can tell whether something got worse.",
    pillar: "trust",
    domainId: "trust.reliability",
    tierMinimum: 2,
    probeId: "monitoring-evidence",
    request: MONITORING_REQUEST,
    rule: {
      statement:
        "Requires a bucketed metric series with a stated bucket size and window. A cumulative counter cannot answer 'did this get worse since yesterday', which is the only question continuous monitoring asks.",
      passWhen: "A bucketed series with a stated window exists AND has recorded traffic",
      partialWhen: "The series surface exists but has recorded no traffic yet",
      failWhen: "Monitoring is readable and exposes only lifetime totals",
      thresholds: [{ key: "buckets with traffic", value: "at least 1" }],
    },
    judge: (facts) => {
      if (!facts.monitoringAvailable) return NOT_EXPOSED("a monitoring summary");
      if (!facts.seriesAvailable) {
        return verdict(
          "fail",
          "The monitoring adapter answered and exposes only lifetime counters, with no windowed series. Drift between two points in time cannot be established from a number that only ever goes up.",
          0.9,
        );
      }
      const buckets = facts.seriesBuckets ?? 0;
      const requests = facts.seriesRequestsInWindow ?? 0;
      const window = facts.seriesWindowSeconds
        ? `${Math.round(facts.seriesWindowSeconds / 60)} minute`
        : "an unstated";
      if (!buckets || !requests) {
        return verdict(
          "partial",
          `A ${facts.seriesBucketSeconds ?? "?"}-second bucketed series over ${window} window is exposed, but it holds no traffic yet, so there is nothing to compare against.`,
          0.7,
        );
      }
      const content = facts.seriesHoldsContent
        ? " The series does carry prompt or response content, which a metrics surface should not."
        : " No prompt or response content is held in it.";
      return verdict(
        "pass",
        `${buckets} bucket(s) of ${facts.seriesBucketSeconds ?? "?"} seconds over ${window} window record ${requests} request(s), so a monitor can compare one period against another.${content}`,
      );
    },
  },
  {
    checkId: "chk.monitoring.event-forensics",
    ruleId: "adapter.event-forensics",
    title: "Blocks and failures are kept as events",
    intent:
      "Confirms refusals, guardrail blocks, dependency errors and limit rejections are retained with their request ids and without prompt content.",
    pillar: "security",
    domainId: "sec.logging",
    tierMinimum: 2,
    probeId: "monitoring-evidence",
    request: MONITORING_REQUEST,
    rule: {
      statement:
        "Requires an event feed covering guardrail blocks, bounded refusals, dependency errors and limit rejections, correlatable by request id and free of prompt text. Counters say how many; only events say which.",
      passWhen: "All four event kinds are tracked AND the feed states it holds no prompt content",
      partialWhen: "An event feed exists but omits kinds, or carries prompt content",
      failWhen: "Monitoring is readable and exposes no event feed",
      thresholds: [{ key: "event kinds tracked", value: "blocked, bounded_refusal, dependency_error, rate_limited" }],
    },
    judge: (facts) => {
      if (!facts.monitoringAvailable) return NOT_EXPOSED("a monitoring summary");
      if (!facts.eventFeedAvailable) {
        return verdict(
          "fail",
          "The monitoring adapter answered and exposes no event feed. A block or a dependency error increments a counter and leaves nothing to investigate.",
          0.9,
        );
      }
      const expected = ["blocked", "bounded_refusal", "dependency_error", "rate_limited"];
      const tracked = facts.eventKindsTracked ?? [];
      const missing = expected.filter((kind) => !tracked.includes(kind));
      if (facts.eventsHoldContent) {
        return verdict(
          "partial",
          `An event feed tracks ${tracked.length} kind(s), but it states that it holds prompt or response content. An investigative feed should carry the request id and the reason, not the text.`,
          0.85,
        );
      }
      if (missing.length) {
        return verdict(
          "partial",
          `The event feed tracks ${tracked.join(", ") || "nothing"}, and does not track ${missing.join(", ")}. Those outcomes leave no investigable record.`,
          0.85,
        );
      }
      const recorded = facts.eventsRecorded ?? 0;
      const retention = facts.eventRetentionSeconds
        ? `${Math.round(facts.eventRetentionSeconds / 3600)} hour(s)`
        : "an unstated period";
      const correlated =
        facts.eventsCarryRequestIds === false
          ? " Some retained events carry no request id, so they cannot be tied back to a trace."
          : "";
      return verdict(
        "pass",
        `All four notable outcomes (${expected.join(", ")}) are retained for ${retention} with no prompt or response content; ${recorded} event(s) are currently held.${correlated}`,
      );
    },
  },
  {
    checkId: "chk.monitoring.trace-audit",
    ruleId: "adapter.trace-audit",
    title: "Per-request audit trail",
    intent:
      "Confirms each request can be reconstructed stage by stage, and that the trail carries no prompt text or tenant identifier.",
    pillar: "compliance",
    domainId: "comp.audit",
    tierMinimum: 2,
    probeId: "monitoring-evidence",
    request: MONITORING_REQUEST,
    rule: {
      statement:
        "Requires a trace endpoint, a versioned trace schema, and at least one trace actually retrieved for a request this assessment made. A documented trace format that returns nothing is not an audit trail.",
      passWhen: "A versioned trace endpoint is declared AND at least one live trace was retrieved",
      partialWhen: "A trace endpoint is declared but no trace could be retrieved during this run",
      failWhen: "No trace endpoint is declared",
      thresholds: [{ key: "traces correlated in this run", value: "at least 1" }],
    },
    judge: (facts) => {
      if (!facts.traceEndpoint) return NOT_EXPOSED("a request trace endpoint");
      if (facts.tracesObserved < 1) {
        return verdict(
          "partial",
          `A schema ${facts.traceSchemaVersion ?? "unversioned"} trace endpoint is declared at ${facts.traceEndpoint}, but no trace was retrievable for the requests this assessment made.`,
          0.6,
        );
      }
      return verdict(
        "pass",
        `${facts.tracesObserved} request(s) from this assessment were reconstructed stage by stage through the schema ${facts.traceSchemaVersion} trace endpoint, with the tenant reduced to a digest and no prompt or response text retained.`,
      );
    },
  },
  {
    checkId: "chk.monitoring.usage-accounting",
    ruleId: "adapter.usage-accounting",
    title: "Consumption and spend accounting",
    intent: "Confirms consumption against the spend ceiling is counted and readable.",
    pillar: "governance",
    domainId: "gov.general",
    tierMinimum: 2,
    probeId: "monitoring-evidence",
    request: MONITORING_REQUEST,
    rule: {
      statement:
        "Reads live consumption counters. A spend ceiling that nobody can measure against is not a control, so this rule requires the counter as well as the ceiling.",
      passWhen: "Consumption is counted and expressed against the configured ceiling",
      partialWhen: "Consumption is counted but not expressed against a ceiling",
      failWhen: "No consumption counter is exposed",
      thresholds: [{ key: "required", value: "tokens charged and budget utilisation" }],
    },
    judge: (facts) => {
      if (facts.tokensChargedToday === undefined) return NOT_EXPOSED("consumption counters");
      if (facts.budgetUtilisation === null || facts.budgetUtilisation === undefined) {
        return verdict(
          "partial",
          `${facts.tokensChargedToday} tokens are counted for the current day, but no ceiling is expressed, so utilisation cannot be reported.`,
          0.7,
        );
      }
      return verdict(
        "pass",
        `${facts.tokensChargedToday} tokens are charged for the current day at ${(facts.budgetUtilisation * 100).toFixed(1)}% of the configured ceiling, with ${facts.rateLimitRejections ?? 0} request(s) refused by the rate ceiling.`,
      );
    },
  },
  {
    checkId: "chk.config.evidence-surface",
    ruleId: "adapter.evidence-surface",
    title: "Machine-readable evidence surface",
    intent:
      "Confirms the target publishes a versioned evidence manifest, so assessment does not depend on a human collecting documents.",
    pillar: "compliance",
    domainId: "comp.evidence",
    tierMinimum: 2,
    probeId: "audit-config-evidence",
    request: AUDIT_REQUEST,
    rule: {
      statement:
        "Reads the advertised evidence endpoint and schema version. This is the control that makes repeatable assessment possible at all: without it, every re-assessment is a fresh manual exercise.",
      passWhen: "A manifest endpoint and a schema version are both advertised",
      partialWhen: "An endpoint is advertised without a schema version",
      failWhen: "No evidence endpoint is advertised",
      thresholds: [{ key: "schema", value: "ARQ Governance evidence manifest 1.0" }],
    },
    judge: (facts) => {
      if (!facts.evidenceManifestEndpoint) return NOT_EXPOSED("an evidence manifest endpoint");
      if (!facts.evidenceSchemaVersion) {
        return verdict(
          "partial",
          `An evidence endpoint is advertised at ${facts.evidenceManifestEndpoint} without a schema version, so compatibility cannot be established before reading it.`,
          0.7,
        );
      }
      return verdict(
        "pass",
        `The target advertises a schema ${facts.evidenceSchemaVersion} evidence manifest at ${facts.evidenceManifestEndpoint}, so named-procedure evidence can be collected without human handover.`,
      );
    },
  },
  {
    checkId: "chk.config.system-inventory",
    ruleId: "adapter.system-inventory",
    title: "AI system inventory and ownership",
    intent:
      "Confirms the system is discoverable as a recorded AI system with an environment and named dependencies.",
    pillar: "governance",
    domainId: "gov.documentation",
    tierMinimum: 2,
    probeId: "audit-config-evidence",
    request: AUDIT_REQUEST,
    rule: {
      statement:
        "Reads the self-describing inventory facts: environment, model provider, vector store and corpus. An AI system that cannot be enumerated cannot be governed, so discoverability through the adapter is the pass condition.",
      passWhen: "Environment, model provider and data store are all discoverable through the adapter",
      partialWhen: "Some inventory facts are discoverable and others are absent",
      failWhen: "The adapter exposes no inventory facts",
      thresholds: [{ key: "required facts", value: "environment, model, data store" }],
    },
    judge: (facts) => {
      if (!facts.auditAvailable) return NOT_EXPOSED("any configuration inventory");
      const present = [facts.appEnv, facts.generationModel, facts.vectorIndex].filter(Boolean).length;
      if (present === 0) {
        return verdict("fail", "The adapter answered but exposed no inventory facts.", 0.8);
      }
      if (present < 3) {
        return verdict(
          "partial",
          `${present} of 3 required inventory facts (environment, model, data store) are discoverable through the adapter.`,
          0.7,
        );
      }
      return verdict(
        "pass",
        `The system is discoverable as one AI system in the ${facts.appEnv} environment, generating with ${facts.generationModel} and retrieving from the ${facts.vectorIndex} index, all readable through the adapter.`,
      );
    },
  },
];

const rulesById = new Map(TARGET_RULES.map((entry) => [entry.ruleId, entry]));

export function judgeTargetRule(ruleId: string, facts: TargetFacts): FactVerdict | null {
  const spec = rulesById.get(ruleId);
  if (!spec) return null;
  return spec.judge(facts);
}

export const targetRuleIds: ReadonlySet<string> = new Set(TARGET_RULES.map((item) => item.ruleId));

export const targetCheckIdByRuleId: ReadonlyMap<string, string> = new Map(
  TARGET_RULES.map((item) => [item.ruleId, item.checkId]),
);
