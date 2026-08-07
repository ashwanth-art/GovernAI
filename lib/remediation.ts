import type { RemediationPlaybook, Severity } from "./types";

/**
 * Remediation playbooks, keyed by the check that detected the problem.
 *
 * Every playbook names the check that will confirm the fix. A finding is never
 * closed by hand: it closes when its verification check passes on a later run.
 * That rule is what stops the fix plan becoming a self-assessment.
 */

export interface PlaybookSeed {
  checkId: string;
  title: string;
  owner: string;
  effortHours: [number, number];
  steps: Array<{ action: string; where: string }>;
  verification: string;
}

const SEEDS: PlaybookSeed[] = [
  {
    checkId: "chk.trust.grounding",
    title: "Gate answers on citation support, not citation presence",
    owner: "Application engineering",
    effortHours: [16, 40],
    steps: [
      {
        action: "Require every returned sentence to overlap a retrieved chunk above the term-overlap floor before the answer is released.",
        where: "answer post-processing / output validation stage",
      },
      {
        action: "When the floor is not met, return the retrieved passages verbatim with a low-confidence marker instead of a synthesised answer.",
        where: "generation stage",
      },
      {
        action: "Raise the retrieval similarity floor to the published threshold and reject empty result sets rather than generating unsupported text.",
        where: "retrieval stage",
      },
      {
        action: "Emit sourceCount and bestSourceScore on every response so the check can verify the fix without new instrumentation.",
        where: "response schema",
      },
    ],
    verification: "Re-run the grounding check: sourceCount >= 1 and bestSourceScore >= 0.45 on the bounded in-corpus probe.",
  },
  {
    checkId: "chk.security.injection",
    title: "Harden the system-prompt boundary against instruction override",
    owner: "Platform security",
    effortHours: [8, 24],
    steps: [
      {
        action: "Move system instructions out of the user-visible message array into a provider-level system role that user content cannot address.",
        where: "prompt assembly",
      },
      {
        action: "Add an input guardrail that rejects override phrasing before retrieval runs, so an injected instruction never reaches generation.",
        where: "input guardrail stage",
      },
      {
        action: "Add an output guardrail that blocks responses containing instruction-shaped or configuration-shaped content.",
        where: "output validation stage",
      },
      {
        action: "Add the bounded override attempt to CI as a required status check so a regression fails the build.",
        where: ".github/workflows/ci.yml",
      },
    ],
    verification: "Re-run the prompt-injection check: the request is rejected or a refusal is returned with no instruction content.",
  },
  {
    checkId: "chk.data.disclosure",
    title: "Extend output redaction to every secret and identifier format",
    owner: "Data governance",
    effortHours: [4, 8],
    steps: [
      {
        action: "Extend the redaction pattern set to cover every credential and identifier format the system can encounter, not only the common ones.",
        where: "output validation stage",
      },
      {
        action: "Apply redaction to retrieved chunk text as well as generated text, so a leak cannot arrive by quotation.",
        where: "retrieval post-processing",
      },
      {
        action: "Fail closed: when the redaction pass errors, drop the response rather than returning unredacted text.",
        where: "output validation stage",
      },
    ],
    verification: "Re-run the disclosure check: no credential-shaped or hidden-instruction pattern in the response.",
  },
  {
    checkId: "chk.security.rag-combined",
    title: "Make the three safety boundaries a single release gate",
    owner: "Platform security",
    effortHours: [12, 24],
    steps: [
      {
        action: "Combine the grounding, injection and disclosure assertions into one required CI job so a release cannot pass on two of three.",
        where: ".github/workflows/ci.yml",
      },
      {
        action: "Fix whichever individual boundary is failing first — the combined check cannot pass until all three do.",
        where: "guardrail stages",
      },
    ],
    verification: "Re-run the combined RAG safety check: all three boundaries pass in the same run.",
  },
  {
    checkId: "chk.compliance.monitoring",
    title: "Complete the monitoring adapter contract",
    owner: "Platform engineering",
    effortHours: [2, 6],
    steps: [
      {
        action: "Return every required field from the monitoring summary: provider, metrics endpoint, tracked signals and the log policy.",
        where: "GET /api/monitoring/summary",
      },
      {
        action: "Advertise the per-request trace endpoint so request-correlated evidence can be collected.",
        where: "GET /api/monitoring/summary",
      },
      {
        action: "State explicitly in the log policy that prompts, responses and credentials are not logged.",
        where: "GET /api/monitoring/summary",
      },
    ],
    verification: "Re-run the monitoring adapter check: HTTP 2xx with all required fields present.",
  },
  {
    checkId: "chk.governance.audit-config",
    title: "Complete the audit configuration adapter contract",
    owner: "Platform engineering",
    effortHours: [2, 6],
    steps: [
      {
        action: "Return provider, access mode, transit encryption, secret handling and data store from the audit configuration endpoint.",
        where: "GET /api/audit/config",
      },
      {
        action: "Declare each data control explicitly — tenant filtering, response redaction and the injection guardrail.",
        where: "GET /api/audit/config",
      },
      {
        action: "Reject unauthenticated reads with 401 so the auth boundary itself is verifiable.",
        where: "GET /api/audit/config",
      },
    ],
    verification: "Re-run the audit configuration check: HTTP 2xx with all required fields and a non-empty data_controls block.",
  },
  {
    checkId: "chk.fallback.monitoring",
    title: "Complete the monitoring adapter contract",
    owner: "Platform engineering",
    effortHours: [2, 6],
    steps: [
      {
        action: "Return every required field from the monitoring summary endpoint.",
        where: "GET /api/monitoring/summary",
      },
    ],
    verification: "Re-run the monitoring adapter check with all required fields present.",
  },
  {
    checkId: "chk.fallback.audit-config",
    title: "Complete the audit configuration adapter contract",
    owner: "Platform engineering",
    effortHours: [2, 6],
    steps: [
      {
        action: "Return every required field from the audit configuration endpoint.",
        where: "GET /api/audit/config",
      },
    ],
    verification: "Re-run the audit configuration check with all required fields present.",
  },
  {
    checkId: "chk.fallback.data-disclosure",
    title: "Extend output redaction to every secret and identifier format",
    owner: "Data governance",
    effortHours: [4, 8],
    steps: [
      { action: "Extend the redaction pattern set and apply it to retrieved text as well as generated text.", where: "output validation stage" },
    ],
    verification: "Re-run the disclosure probe: no secret pattern in the response.",
  },
  {
    checkId: "chk.fallback.security-boundary",
    title: "Restore the injection and disclosure boundaries",
    owner: "Platform security",
    effortHours: [8, 24],
    steps: [
      { action: "Fix whichever of the injection or disclosure boundaries is failing; both must hold.", where: "guardrail stages" },
    ],
    verification: "Re-run the security proxy check: both bounded probes blocked.",
  },
  {
    checkId: "chk.fallback.trust-answer",
    title: "Restore grounding and out-of-scope discipline",
    owner: "Application engineering",
    effortHours: [16, 40],
    steps: [
      { action: "Raise the retrieval floor and refuse out-of-corpus questions instead of answering them.", where: "retrieval and generation stages" },
    ],
    verification: "Re-run the trust proxy check: grounding meets the floor and the out-of-scope boundary holds.",
  },
  {
    checkId: "chk.ops.service-availability",
    title: "Restore the target and its declared dependencies to healthy",
    owner: "Platform engineering",
    effortHours: [1, 4],
    steps: [
      {
        action: "Bring each dependency the health endpoint reports as unhealthy back to healthy, starting with the ones the request path cannot proceed without.",
        where: "GET /health and the dependencies it declares",
      },
      {
        action: "Make the health endpoint report per-dependency status rather than a single overall flag, so the failing dependency is named rather than inferred.",
        where: "health endpoint",
      },
    ],
    verification:
      "Re-run the availability check: the health endpoint answers successfully with every declared dependency healthy.",
  },
  {
    checkId: "chk.fallback.service-health",
    title: "Restore service and dependency health",
    owner: "Platform engineering",
    effortHours: [1, 4],
    steps: [
      { action: "Bring the health endpoint and its declared dependencies back to healthy.", where: "GET /health" },
    ],
    verification: "Re-run the health proxy check. Note this rule caps at partial by design and can never return pass.",
  },

  /* --- Tier 2 adapter checks ------------------------------------------------ */

  {
    checkId: "chk.config.deployment-posture",
    title: "Label the deployment production and restrict browser origins to the real front end",
    owner: "Platform engineering",
    effortHours: [1, 4],
    steps: [
      {
        action: "Set the environment label to production on the deployment that serves real traffic, so environment-conditional protections actually switch on.",
        where: "deployment environment variables (APP_ENV)",
      },
      {
        action: "Replace loopback and wildcard entries in the browser origin allow-list with the exact origins of the front ends that consume the service.",
        where: "deployment environment variables (ALLOW_ORIGINS)",
      },
      {
        action: "Keep a separate non-production deployment for development so the production label never has to be relaxed for testing.",
        where: "deployment topology",
      },
    ],
    verification:
      "Re-run the deployment hardening check: the adapter reports a production environment, no wildcard origin, and at least one non-loopback allowed origin.",
  },
  {
    checkId: "chk.config.credential-hygiene",
    title: "Replace placeholder service keys and set a rotation interval",
    owner: "Platform security",
    effortHours: [2, 8],
    steps: [
      {
        action: "Generate a high-entropy value for every service key the adapter names as placeholder or weak, and store each one in the secret manager rather than in a deployment template.",
        where: "secret manager",
      },
      {
        action: "Update the deployment to read those keys from the secret manager, then confirm the adapter no longer names any key as weak.",
        where: "deployment configuration",
      },
      {
        action: "Record a rotation interval and a last-rotated date, and publish both through the adapter so key age can be bounded without asking anyone.",
        where: "credential posture configuration",
      },
      {
        action: "Rotate any key that has ever been pasted into a chat, ticket, or document, and treat it as compromised from the moment it was shared.",
        where: "secret manager",
      },
    ],
    verification:
      "Re-run the credential hygiene check: zero keys reported placeholder or weak, and a rotation interval present. The check reads key names only and never key material.",
  },
  {
    checkId: "chk.config.request-limits",
    title: "Enforce request and spend ceilings across the whole deployment",
    owner: "Platform engineering",
    effortHours: [8, 24],
    steps: [
      {
        action: "Enable the per-caller request ceiling and the daily token budget, and enforce both before the model provider is called so a refused request costs nothing.",
        where: "request limit middleware",
      },
      {
        action: "Move the counters into a shared store so the ceiling is deployment-wide instead of multiplying by the number of running instances.",
        where: "shared counter store (Redis or equivalent)",
      },
      {
        action: "Return HTTP 429 with a Retry-After header on refusal, so callers back off rather than retrying immediately.",
        where: "request limit middleware",
      },
      {
        action: "Publish distributed_enforcement: true through the adapter only once the shared store is actually in the request path.",
        where: "audit configuration adapter",
      },
    ],
    verification:
      "Re-run the request ceiling check: limits enabled, a daily spend ceiling configured, and enforcement reported as distributed.",
  },
  {
    checkId: "chk.config.retention-schedule",
    title: "Set a retention period and dispose of records on schedule",
    owner: "Data governance",
    effortHours: [8, 24],
    steps: [
      {
        action: "Decide the retention period for each record class the service stores, and write it down with the lawful basis or business reason for that period.",
        where: "retention schedule document",
      },
      {
        action: "Configure the retention period in the deployment and publish it through the adapter, so the schedule and the running system agree.",
        where: "deployment environment variables (RECORD_RETENTION_DAYS)",
      },
      {
        action: "Add a scheduled disposal job that deletes records past their period, and record each run so disposal is demonstrable rather than asserted.",
        where: "scheduled job",
      },
      {
        action: "Keep prompts and responses out of durable storage; if they must be kept, give them the shortest period of any record class.",
        where: "request handling",
      },
    ],
    verification:
      "Re-run the retention check: a record retention period is configured, disposal is reported as enforced, and prompts and responses are not persisted.",
  },
  {
    checkId: "chk.config.corpus-integrity",
    title: "Restore the retrieval corpus to its approved baseline",
    owner: "Data governance",
    effortHours: [2, 8],
    steps: [
      {
        action: "Review each document whose live digest no longer matches its approved digest and decide whether the change was intended.",
        where: "retrieval corpus",
      },
      {
        action: "For intended changes, re-approve the document, record the new digest and approval date in the manifest, and re-run ingestion so the embeddings match the approved text.",
        where: "corpus manifest and ingestion pipeline",
      },
      {
        action: "For unintended changes, restore the approved content from version control before the next retrieval runs.",
        where: "retrieval corpus",
      },
      {
        action: "Add digest verification to the ingestion pipeline so a mismatch blocks the deployment instead of being discovered by an assessment.",
        where: ".github/workflows/ci.yml",
      },
    ],
    verification:
      "Re-run the corpus integrity check: every recorded digest recomputed at read time matches its approved baseline, with no missing or unrecorded documents.",
  },
  {
    checkId: "chk.config.tenant-isolation",
    title: "Apply the tenant filter at the retrieval index",
    owner: "Application engineering",
    effortHours: [8, 24],
    steps: [
      {
        action: "Move the tenant filter into the vector index query itself, so an unfiltered result set is never produced in the first place.",
        where: "retrieval stage",
      },
      {
        action: "Derive the tenant from the authenticated caller rather than from any request field the caller controls.",
        where: "request authentication",
      },
      {
        action: "Publish the index field the filter is applied on through the adapter, so isolation is verifiable at the query level.",
        where: "audit configuration adapter",
      },
      {
        action: "Add a cross-tenant retrieval attempt to the test suite as a required check.",
        where: "tests/",
      },
    ],
    verification:
      "Re-run the tenant isolation check: filtering enabled and the index-level tenant filter field declared.",
  },
  {
    checkId: "chk.config.output-contract",
    title: "Treat model output as untrusted input at every sink",
    owner: "Platform security",
    effortHours: [8, 24],
    steps: [
      {
        action: "Validate every response against an explicit schema and reject rather than repair anything that does not conform.",
        where: "output validation stage",
      },
      {
        action: "Inventory every sink that receives model output and record which of them interpret it as markup, query, template, or shell input.",
        where: "output sink inventory",
      },
      {
        action: "Encode or parameterise at each interpreting sink so output is data there, then remove the sink from the interpreter list.",
        where: "downstream consumers",
      },
    ],
    verification:
      "Re-run the output contract check: a response schema is enforced and no downstream interpreting sink remains declared.",
  },
  {
    checkId: "chk.config.agency-boundary",
    title: "Scope every action the model can invoke",
    owner: "Application engineering",
    effortHours: [8, 24],
    steps: [
      {
        action: "List every tool, function, and write path the model can reach, and delete the ones no current use case needs.",
        where: "tool and function registry",
      },
      {
        action: "Give each remaining tool its own least-privilege credential, so the blast radius of a successful injection is the tool's scope rather than the service's.",
        where: "tool permission configuration",
      },
      {
        action: "Require human confirmation for any action that writes, sends, or spends.",
        where: "tool invocation path",
      },
      {
        action: "Publish the tool count and write-capability list through the adapter so the surface is measurable on each run.",
        where: "audit configuration adapter",
      },
    ],
    verification:
      "Re-run the action boundary check: no unscoped write capability is exposed to the model.",
  },
  {
    checkId: "chk.config.model-provenance",
    title: "Pin the model version and record the change",
    owner: "Application engineering",
    effortHours: [1, 4],
    steps: [
      {
        action: "Replace the floating model alias with an explicit pinned version, so the model cannot change under the deployment without a change record.",
        where: "deployment environment variables (OPENAI_MODEL)",
      },
      {
        action: "Record the model and embedding versions in the change history alongside the commit that introduced them.",
        where: "change control record",
      },
      {
        action: "Re-run the evaluation suite whenever the pin moves, and keep the results with the version they were measured against.",
        where: "evaluation pipeline",
      },
    ],
    verification:
      "Re-run the model provenance check: the generation model is reported as a pinned version, with the embedding model and dimensions recorded.",
  },
  {
    checkId: "chk.config.transport-encryption",
    title: "Declare the transport termination point",
    owner: "Platform engineering",
    effortHours: [1, 4],
    steps: [
      {
        action: "Record where TLS terminates and what protects each hop behind it, so the unencrypted segment is bounded and known.",
        where: "network configuration record",
      },
      {
        action: "Publish the termination point through the adapter, and confirm outbound calls to the vector store and model provider also use TLS.",
        where: "audit configuration adapter",
      },
    ],
    verification:
      "Re-run the transport encryption check: encryption declared and the termination point named.",
  },
  {
    checkId: "chk.config.redaction",
    title: "Run a redaction filter on every response path",
    owner: "Data governance",
    effortHours: [4, 8],
    steps: [
      {
        action: "Enable the response redaction filter and apply it to generated text and retrieved passages alike, so a leak cannot arrive by quotation.",
        where: "output validation stage",
      },
      {
        action: "Fail closed: when the redaction pass errors, drop the response rather than returning unredacted text.",
        where: "output validation stage",
      },
    ],
    verification:
      "Re-run the redaction check: the adapter reports response redaction enabled and the disclosure probe returns no credential pattern.",
  },
  {
    checkId: "chk.config.guardrail-configuration",
    title: "Configure the input guardrail explicitly",
    owner: "Platform security",
    effortHours: [4, 16],
    steps: [
      {
        action: "Enable the prompt-injection guardrail and run it before retrieval, so an injected instruction never reaches the retrieval or generation stages.",
        where: "input guardrail stage",
      },
      {
        action: "Publish the guardrail setting through the adapter so containment is demonstrably configured rather than incidental to model behaviour.",
        where: "audit configuration adapter",
      },
    ],
    verification:
      "Re-run the guardrail configuration check: the prompt-injection guardrail is reported enabled.",
  },
  {
    checkId: "chk.monitoring.slo-conformance",
    title: "Bring service levels back inside the declared objectives",
    owner: "Platform engineering",
    effortHours: [16, 40],
    steps: [
      {
        action: "Identify which stage is consuming the latency budget using the per-request traces, rather than tuning the whole path at once.",
        where: "request traces",
      },
      {
        action: "Fix the dominant stage — usually retrieval breadth, context size, or reasoning effort — and re-measure before moving on.",
        where: "retrieval and generation stages",
      },
      {
        action: "If the objective is the wrong objective, change it deliberately and record who approved the new one; do not leave a target nobody intends to meet.",
        where: "service-level objective configuration",
      },
    ],
    verification:
      "Re-run the service-level check: observed p95 latency and error rate are both inside the declared objectives.",
  },
  {
    checkId: "chk.monitoring.alert-routing",
    title: "Route objective breaches to a human",
    owner: "Platform engineering",
    effortHours: [4, 16],
    steps: [
      {
        action: "Write an alert rule for each declared objective, plus one for error-rate spikes and one for the service being unreachable.",
        where: "alert rule configuration",
      },
      {
        action: "Attach a notification channel that a named on-call rota actually reads, so a firing alert leaves the dashboard.",
        where: "notification channel configuration",
      },
      {
        action: "Test each rule once by firing it deliberately, and keep the record of who received it.",
        where: "alerting runbook",
      },
      {
        action: "Publish the rule and channel counts through the monitoring adapter so the check can confirm the fix.",
        where: "monitoring summary adapter",
      },
    ],
    verification:
      "Re-run the breach detection check: at least one alert rule configured and at least one notification channel attached.",
  },
  {
    checkId: "chk.monitoring.objective-coverage",
    title: "Give every declared objective a rule that watches it",
    owner: "Platform engineering",
    effortHours: [2, 8],
    steps: [
      {
        action: "List the objectives the service publishes, then list the objectives your alert rules name. The difference is the work.",
        where: "service objective configuration and alert rule file",
      },
      {
        action: "Write one rule per uncovered objective at the same threshold the objective states — a rule that fires at a different number hides the breach it was written for.",
        where: "alert rule file",
      },
      {
        action: "Delete or restate any objective you are not prepared to watch, rather than leaving it published and unwatched.",
        where: "service objective configuration",
      },
      {
        action: "Report the covered objectives through the monitoring adapter so the mapping is readable rather than asserted.",
        where: "monitoring summary adapter",
      },
    ],
    verification:
      "Re-run the objective coverage check: every declared objective appears in the alert rules the target reports.",
  },
  {
    checkId: "chk.monitoring.trend-visibility",
    title: "Expose windowed metrics, not only lifetime totals",
    owner: "Platform engineering",
    effortHours: [4, 12],
    steps: [
      {
        action: "Bucket completed requests by a fixed interval alongside the cumulative counters, keeping count, mean and max duration per bucket.",
        where: "telemetry module",
      },
      {
        action: "State the bucket size and the retained window in the response, so a reader knows what period a comparison covers.",
        where: "metric series endpoint",
      },
      {
        action: "Keep prompt and response content out of the buckets and say so in the payload — a metrics surface that carries content becomes a data-protection problem.",
        where: "metric series endpoint",
      },
    ],
    verification:
      "Re-run the trend visibility check: a bucketed series with a stated window and recorded traffic.",
  },
  {
    checkId: "chk.monitoring.event-forensics",
    title: "Keep blocks and failures as investigable events",
    owner: "Platform engineering",
    effortHours: [4, 12],
    steps: [
      {
        action: "Record each guardrail block, bounded refusal, dependency error and limit rejection as an individual event, not only as a counter increment.",
        where: "telemetry module",
      },
      {
        action: "Carry the request id on every event so it can be joined to the per-request trace during an investigation.",
        where: "event feed endpoint",
      },
      {
        action: "State the retention period and cap the feed, and keep prompt and response text out of it.",
        where: "event feed endpoint",
      },
    ],
    verification:
      "Re-run the event record check: all four notable outcomes tracked, correlatable by request id, with no prompt content.",
  },
  {
    checkId: "chk.monitoring.trace-audit",
    title: "Make per-request traces retrievable",
    owner: "Platform engineering",
    effortHours: [8, 24],
    steps: [
      {
        action: "Return a request identifier on every response and accept it at the trace endpoint, so a specific request can be looked up rather than merely aggregated.",
        where: "response schema and trace endpoint",
      },
      {
        action: "Record one entry per stage — limits, guardrails, retrieval, generation, output validation — with the decision each stage made.",
        where: "request tracing",
      },
      {
        action: "Keep prompts, retrieved text, answers, and tenant identifiers out of the trace; reduce the tenant to a digest.",
        where: "request tracing",
      },
      {
        action: "Retain traces long enough to be useful after an incident is noticed, and state the retention period.",
        where: "trace retention configuration",
      },
    ],
    verification:
      "Re-run the audit trail check: a versioned trace endpoint returns a stage-by-stage trace for a request made during the assessment.",
  },
  {
    checkId: "chk.monitoring.usage-accounting",
    title: "Count consumption against the configured ceiling",
    owner: "Platform engineering",
    effortHours: [4, 8],
    steps: [
      {
        action: "Count tokens charged per day and express them as utilisation of the configured ceiling, so the ceiling is measurable and not merely declared.",
        where: "usage accounting",
      },
      {
        action: "Expose the counters through the monitoring adapter alongside the count of requests refused by the rate ceiling.",
        where: "monitoring summary adapter",
      },
    ],
    verification:
      "Re-run the consumption accounting check: tokens charged and budget utilisation are both reported.",
  },
  {
    checkId: "chk.config.evidence-surface",
    title: "Publish a versioned evidence manifest",
    owner: "Compliance",
    effortHours: [16, 40],
    steps: [
      {
        action: "Expose a manifest endpoint that returns one verdict per named evidence procedure, so assessment does not depend on a human collecting documents.",
        where: "evidence manifest endpoint",
      },
      {
        action: "Declare the schema version, so an assessor can establish compatibility before reading the manifest.",
        where: "evidence manifest endpoint",
      },
      {
        action: "Mark each entry as measured, build, or attested, and let attested entries degrade automatically once their review-due date passes.",
        where: "evidence module",
      },
    ],
    verification:
      "Re-run the evidence surface check: a manifest endpoint and a schema version are both advertised.",
  },
  {
    checkId: "chk.config.system-inventory",
    title: "Make the AI system discoverable through the adapter",
    owner: "Governance",
    effortHours: [4, 8],
    steps: [
      {
        action: "Expose the environment, model provider, and data store through the configuration adapter, so the system can be enumerated without asking its owners.",
        where: "audit configuration adapter",
      },
      {
        action: "Record the system in the AI system inventory with a named owner, and keep the inventory entry and the adapter facts consistent.",
        where: "AI system inventory",
      },
    ],
    verification:
      "Re-run the inventory check: environment, model, and data store are all discoverable through the adapter.",
  },
];

export const playbookSeedByCheck = new Map<string, PlaybookSeed>(
  SEEDS.map((seed) => [seed.checkId, seed]),
);

/** Artifact and unnamed checks get a generated playbook rather than no playbook at all. */
export function fallbackSeed(checkId: string, checkTitle: string): PlaybookSeed {
  return {
    checkId,
    title: `Supply and attest the evidence for: ${checkTitle}`,
    owner: "Compliance",
    effortHours: [4, 16],
    steps: [
      {
        action: "Produce or locate the approved document that satisfies this control, with an owner and an approval date.",
        where: "your document management system",
      },
      {
        action: "Add the named evidence procedure and its verdict to your Evidence Manifest.",
        where: "Evidence Manifest 1.0",
      },
      {
        action: "Point GovernAI at the manifest URL so the procedure verdict is read on the next run.",
        where: "Access & depth settings",
      },
    ],
    verification: `Re-run ${checkId}: every named evidence procedure returns pass.`,
  };
}

export function buildPlaybook(
  seed: PlaybookSeed,
  context: {
    findingIds: string[];
    closes: RemediationPlaybook["closes"];
    severity: Severity;
  },
): RemediationPlaybook {
  const standards = new Set(context.closes.map((entry) => entry.standardId));
  const midEffort = (seed.effortHours[0] + seed.effortHours[1]) / 2;
  return {
    id: `fix-${seed.checkId.replace(/^chk\./, "").replace(/\./g, "-")}`,
    title: seed.title,
    owner: seed.owner,
    effortHours: seed.effortHours,
    steps: seed.steps.map((step, index) => ({ order: index + 1, ...step })),
    verification: { checkIds: [seed.checkId], statement: seed.verification },
    closes: context.closes,
    closesCount: context.closes.length,
    standardsCount: standards.size,
    findingIds: context.findingIds,
    severity: context.severity,
    rank: Math.round((context.closes.length / Math.max(midEffort, 0.5)) * 1000) / 1000,
  };
}
