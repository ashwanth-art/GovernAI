import type { AccessTier, Control, Pillar, Severity } from "./types";

/**
 * The verification library: every control ARQ Governance can actually verify, and how.
 *
 * One entry per verifiable capability, not one per standard. A standard's control
 * set is a selection from this library plus that standard's own identifiers and
 * clause citations, so the same evidence closes the same control wherever it
 * appears — which is what lets a single remediation playbook report how many
 * controls across how many standards it closes.
 *
 * Three tiers, and the split is a statement about access rather than importance:
 *
 *   Tier 1 — provable from outside, by bounded probes against the running system.
 *   Tier 2 — provable from the read-only configuration and monitoring adapters.
 *   Tier 3 — provable from named evidence procedures the target publishes.
 *
 * Every entry names the rule that judges it. Tier 3 entries name the evidence
 * procedures they require, which is what makes 100% coverage reachable at Tier 3:
 * there is no entry here whose evidence has nowhere to come from.
 */

export interface VerifiableControl {
  /** Stable key used by the per-standard mappings. Never shown to users. */
  key: string;
  /** Techno-business control name. */
  name: string;
  /** How this control is tested, stated so a reader knows what was actually done. */
  objective: string;
  category: string;
  pillars: Pillar[];
  tierMinimum: AccessTier;
  testType: Control["testType"];
  evaluationRuleId: string;
  evidenceProcedureIds?: string[];
  severity: Severity;
  remediation: string;
}

/* ---------------------------------------------------------------- Tier 1 -- */
/* Black-box probes against the running system. No credentials beyond the      */
/* application's own API key, and every probe is bounded and non-destructive.   */

const TIER_1: VerifiableControl[] = [
  {
    key: "answer-grounding",
    name: "Answer grounding in retrieved sources",
    objective:
      "Sends a bounded in-corpus question to the live endpoint and measures whether the answer is supported by retrieved sources above the published similarity floor, rather than merely accompanied by citations.",
    category: "Output assurance",
    pillars: ["trust"],
    tierMinimum: 1,
    testType: "adversarial_probe",
    evaluationRuleId: "probe.grounding",
    severity: "high",
    remediation:
      "Gate answer release on citation support rather than citation presence, and return retrieved passages with a low-confidence marker when the support floor is not met.",
  },
  {
    key: "instruction-boundary",
    name: "System instruction boundary under override attempt",
    objective:
      "Sends one bounded instruction-override attempt and records whether the system prompt boundary held, the request was refused, or configuration content was returned.",
    category: "Adversarial resilience",
    pillars: ["security"],
    tierMinimum: 1,
    testType: "adversarial_probe",
    evaluationRuleId: "probe.injection",
    severity: "critical",
    remediation:
      "Move system instructions to a provider-level system role, reject override phrasing before retrieval, and add the bounded attempt to CI as a required check.",
  },
  {
    key: "sensitive-disclosure",
    name: "Sensitive value disclosure in responses",
    objective:
      "Asks the live endpoint for configuration and credential material and inspects the response for credential-shaped or hidden-instruction patterns.",
    category: "Data protection",
    pillars: ["data_protection", "security"],
    tierMinimum: 1,
    testType: "adversarial_probe",
    evaluationRuleId: "probe.disclosure",
    severity: "critical",
    remediation:
      "Extend the redaction pattern set to every credential and identifier format, apply it to retrieved text as well as generated text, and fail closed when redaction errors.",
  },
  {
    key: "combined-rag-safety",
    name: "Combined retrieval safety posture",
    objective:
      "Requires the grounding, instruction-boundary and disclosure probes to hold together, so a control that depends on all three is judged on all three rather than on the best of them.",
    category: "Output assurance",
    pillars: ["trust", "security"],
    tierMinimum: 1,
    testType: "adversarial_probe",
    evaluationRuleId: "probe.combined-rag-safety",
    severity: "high",
    remediation:
      "Close the individual grounding, instruction-boundary and disclosure findings; this control passes only when all three hold in the same run.",
  },
  {
    key: "service-availability",
    name: "Service and dependency availability",
    objective:
      "Reads the health endpoint and its declared dependencies, and records latency, so every other result in the run is qualified by whether the target was healthy while it was assessed.",
    category: "Operations",
    pillars: ["governance"],
    tierMinimum: 1,
    testType: "adversarial_probe",
    evaluationRuleId: "probe.service-health",
    severity: "medium",
    remediation:
      "Bring the health endpoint and its declared dependencies back to healthy before relying on any other result in this run.",
  },
];

/* ---------------------------------------------------------------- Tier 2 -- */
/* Read-only adapter facts. One entry per rule in lib/target-facts.ts, so the   */
/* control a user reads and the rule the engine ran are the same object.        */

const TIER_2: VerifiableControl[] = [
  {
    key: "deployment-hardening",
    name: "Production deployment hardening",
    objective:
      "Reads the environment label and browser origin allow-list from the configuration adapter and judges whether the deployment is configured for the traffic it is actually serving.",
    category: "Platform configuration",
    pillars: ["security", "governance"],
    tierMinimum: 2,
    testType: "config_check",
    evaluationRuleId: "adapter.deployment-posture",
    severity: "high",
    remediation:
      "Label the production deployment production and replace loopback or wildcard browser origins with the exact origins of the consuming front ends.",
  },
  {
    key: "credential-hygiene",
    name: "Service credential strength and rotation",
    objective:
      "Asks the target which of its configured keys are placeholder or low-entropy, by name only, and whether a rotation interval is recorded. No key material is requested, received or stored.",
    category: "Access management",
    pillars: ["security"],
    tierMinimum: 2,
    testType: "config_check",
    evaluationRuleId: "adapter.credential-hygiene",
    severity: "critical",
    remediation:
      "Replace every key the adapter names as placeholder or weak with a high-entropy value held in the secret manager, then record a rotation interval and last-rotation date.",
  },
  {
    key: "consumption-ceilings",
    name: "Request-rate and cost ceilings",
    objective:
      "Reads the configured per-caller request ceiling, spend ceiling, timeout and output cap, and whether enforcement is deployment-wide. Load is never generated against the target.",
    category: "Resilience",
    pillars: ["security", "governance"],
    tierMinimum: 2,
    testType: "config_check",
    evaluationRuleId: "adapter.request-limits",
    severity: "high",
    remediation:
      "Enforce the per-caller and daily ceilings before the model provider is called, and move the counters to a shared store so the ceiling is deployment-wide.",
  },
  {
    key: "retention-schedule",
    name: "Data retention and disposal schedule",
    objective:
      "Reads the configured retention period for stored records, whether disposal is enforced, and whether prompts and responses are persisted at all.",
    category: "Data lifecycle",
    pillars: ["data_protection", "compliance"],
    tierMinimum: 2,
    testType: "config_check",
    evaluationRuleId: "adapter.retention-schedule",
    severity: "high",
    remediation:
      "Set a retention period per record class, configure it in the deployment, and add a scheduled disposal job whose runs are recorded.",
  },
  {
    key: "corpus-integrity",
    name: "Retrieval corpus integrity against approved baseline",
    objective:
      "Has the target recompute a digest for every retrieval corpus document at read time and compares each one to the digest approved at ingestion, so content changed after approval is detected rather than assumed absent.",
    category: "Data assurance",
    pillars: ["trust", "security", "data_protection"],
    tierMinimum: 2,
    testType: "config_check",
    evaluationRuleId: "adapter.corpus-integrity",
    severity: "critical",
    remediation:
      "Re-approve or restore every document whose live digest no longer matches its baseline, and make digest verification a blocking step in the ingestion pipeline.",
  },
  {
    key: "tenant-isolation",
    name: "Tenant isolation in retrieval",
    objective:
      "Reads the retrieval filter configuration and confirms the tenant filter is declared on the index query itself rather than applied in application code after an unfiltered query.",
    category: "Access management",
    pillars: ["security", "data_protection"],
    tierMinimum: 2,
    testType: "config_check",
    evaluationRuleId: "adapter.tenant-isolation",
    severity: "critical",
    remediation:
      "Apply the tenant filter inside the vector index query, derive the tenant from the authenticated caller, and add a cross-tenant retrieval attempt to the test suite.",
  },
  {
    key: "output-contract",
    name: "Model output treated as untrusted",
    objective:
      "Reads the response schema contract and the inventory of downstream sinks, and fails if any sink interprets model output as markup, query, template or shell input.",
    category: "Output assurance",
    pillars: ["security"],
    tierMinimum: 2,
    testType: "config_check",
    evaluationRuleId: "adapter.output-contract",
    severity: "high",
    remediation:
      "Validate every response against an explicit schema, inventory each output sink, and encode or parameterise at every sink that interprets what it receives.",
  },
  {
    key: "agency-boundary",
    name: "Model action boundary",
    objective:
      "Counts the tools, function definitions and write paths exposed to the model, so excessive agency is bounded by measured surface rather than by trust in model behaviour.",
    category: "Adversarial resilience",
    pillars: ["security", "governance"],
    tierMinimum: 2,
    testType: "config_check",
    evaluationRuleId: "adapter.agency-boundary",
    severity: "high",
    remediation:
      "Remove every tool no current use case needs, give each remaining tool a least-privilege credential, and require human confirmation for anything that writes, sends or spends.",
  },
  {
    key: "model-provenance",
    name: "Model and embedding version pinning",
    objective:
      "Reads the generation and embedding model identifiers in use and judges whether the generation model is a pinned version or a floating alias that can change without a change record.",
    category: "Change control",
    pillars: ["governance", "trust"],
    tierMinimum: 2,
    testType: "config_check",
    evaluationRuleId: "adapter.model-provenance",
    severity: "medium",
    remediation:
      "Pin the model to an explicit version, record it in the change history, and re-run the evaluation suite whenever the pin moves.",
  },
  {
    key: "transport-encryption",
    name: "Transport encryption and termination point",
    objective:
      "Reads the declared transport protection and the point at which TLS terminates, so the segment behind the termination point is bounded and known.",
    category: "Technical safeguards",
    pillars: ["data_protection", "security"],
    tierMinimum: 2,
    testType: "config_check",
    evaluationRuleId: "adapter.transport-encryption",
    severity: "medium",
    remediation:
      "Record and publish where TLS terminates and what protects each hop behind it, and confirm outbound calls to the vector store and model provider also use TLS.",
  },
  {
    key: "response-redaction",
    name: "Sensitive-data redaction on responses",
    objective:
      "Confirms through the adapter that a redaction filter runs on every response path, so the Tier 1 probe result reflects a configured control rather than incidental model behaviour.",
    category: "Data protection",
    pillars: ["data_protection"],
    tierMinimum: 2,
    testType: "config_check",
    evaluationRuleId: "adapter.redaction",
    severity: "high",
    remediation:
      "Enable response redaction across generated and retrieved text alike, and drop the response rather than returning unredacted text when the redaction pass errors.",
  },
  {
    key: "guardrail-configuration",
    name: "Input guardrail configuration",
    objective:
      "Confirms through the adapter that a prompt-injection guardrail is configured and runs before retrieval, rather than inferring containment from a single probe result.",
    category: "Adversarial resilience",
    pillars: ["security"],
    tierMinimum: 2,
    testType: "config_check",
    evaluationRuleId: "adapter.guardrail-configuration",
    severity: "high",
    remediation:
      "Enable the prompt-injection guardrail ahead of the retrieval stage and publish the setting through the configuration adapter.",
  },
  {
    key: "service-levels",
    name: "Service levels against declared objectives",
    objective:
      "Reads the objectives the service declares for itself and the latency and error rates it has actually observed, then holds the service to its own targets rather than to an assessor's benchmark.",
    category: "Operations",
    pillars: ["trust", "governance"],
    tierMinimum: 2,
    testType: "config_check",
    evaluationRuleId: "adapter.slo-conformance",
    severity: "medium",
    remediation:
      "Locate the stage consuming the latency budget using the per-request traces and fix it, or change the objective deliberately and record who approved the new one.",
  },
  {
    key: "breach-alerting",
    name: "Breach detection reaches a human",
    objective:
      "Counts the alert rules and notification channels configured, because exported metrics with no alert rule mean a breach is recorded and never announced.",
    category: "Operations",
    pillars: ["compliance", "security"],
    tierMinimum: 2,
    testType: "config_check",
    evaluationRuleId: "adapter.alert-routing",
    severity: "high",
    remediation:
      "Write an alert rule per declared objective, attach a channel a named on-call rota reads, and fire each rule once to prove delivery.",
  },
  {
    key: "objective-coverage",
    name: "Every declared objective has a threshold watching it",
    objective:
      "Compares the service objectives the system publishes against the objectives its alert rules actually name, so a published target cannot be a number nothing detects a breach of.",
    category: "Operations",
    pillars: ["trust", "governance"],
    tierMinimum: 2,
    testType: "config_check",
    evaluationRuleId: "adapter.objective-coverage",
    severity: "high",
    remediation:
      "Write one alert rule per declared objective at the same threshold the objective states, and delete or restate any objective you are not prepared to watch.",
  },
  {
    key: "trend-visibility",
    name: "Change over time is observable",
    objective:
      "Establishes that the system exposes windowed metrics rather than lifetime totals only, because a counter that only goes up cannot answer whether anything got worse.",
    category: "Operations",
    pillars: ["trust", "governance"],
    tierMinimum: 2,
    testType: "config_check",
    evaluationRuleId: "adapter.trend-visibility",
    severity: "medium",
    remediation:
      "Expose per-interval buckets alongside the cumulative counters, with the bucket size and retained window stated, and keep prompt and response content out of them.",
  },
  {
    key: "event-forensics",
    name: "Blocks and failures are kept as investigable events",
    objective:
      "Confirms guardrail blocks, bounded refusals, dependency errors and limit rejections are retained individually with their request ids, so an incident can be investigated rather than merely counted.",
    category: "Operations",
    pillars: ["security", "compliance"],
    tierMinimum: 2,
    testType: "config_check",
    evaluationRuleId: "adapter.event-forensics",
    severity: "medium",
    remediation:
      "Retain each notable outcome as an event carrying the request id, the reason and the timestamp, with a stated retention period and no prompt or response text.",
  },
  {
    key: "request-audit-trail",
    name: "Per-request audit trail",
    objective:
      "Retrieves a stage-by-stage trace for a request this assessment itself made, so the audit trail is proven to work rather than merely documented.",
    category: "Auditability",
    pillars: ["compliance", "governance"],
    tierMinimum: 2,
    testType: "config_check",
    evaluationRuleId: "adapter.trace-audit",
    severity: "high",
    remediation:
      "Return a request identifier on every response, accept it at the trace endpoint, record one entry per stage, and keep prompts, answers and tenant identifiers out of the trace.",
  },
  {
    key: "usage-accounting",
    name: "Consumption and spend accounting",
    objective:
      "Reads live consumption counters and expresses them against the configured ceiling, because a ceiling nobody can measure against is not a control.",
    category: "Operations",
    pillars: ["governance"],
    tierMinimum: 2,
    testType: "config_check",
    evaluationRuleId: "adapter.usage-accounting",
    severity: "low",
    remediation:
      "Count tokens charged per day, express them as utilisation of the configured ceiling, and expose both through the monitoring adapter.",
  },
  {
    key: "evidence-surface",
    name: "Machine-readable evidence surface",
    objective:
      "Confirms the target publishes a versioned evidence manifest, which is what allows re-assessment to be repeatable instead of a fresh manual exercise each time.",
    category: "Auditability",
    pillars: ["compliance", "governance"],
    tierMinimum: 2,
    testType: "config_check",
    evaluationRuleId: "adapter.evidence-surface",
    severity: "medium",
    remediation:
      "Expose a versioned manifest endpoint returning one verdict per named evidence procedure, marked measured, build or attested.",
  },
  {
    key: "system-inventory",
    name: "AI system inventory and discoverability",
    objective:
      "Reads the environment, model provider and data store from the adapter, because an AI system that cannot be enumerated cannot be governed.",
    category: "Governance",
    pillars: ["governance", "compliance"],
    tierMinimum: 2,
    testType: "config_check",
    evaluationRuleId: "adapter.system-inventory",
    severity: "medium",
    remediation:
      "Publish the environment, model and data store through the configuration adapter and keep the AI system inventory entry consistent with them.",
  },
];

/* ---------------------------------------------------------------- Tier 3 -- */
/* Named evidence procedures. Each entry lists the procedures that close it;    */
/* a control with no evidence available stays not_assessed and never passes.    */

function tier3(
  key: string,
  name: string,
  objective: string,
  category: string,
  pillars: Pillar[],
  procedures: string[],
  severity: Severity,
  remediation: string,
): VerifiableControl {
  return {
    key,
    name,
    objective,
    category,
    pillars,
    tierMinimum: 3,
    testType: "document_verify",
    evaluationRuleId: `artifact.${key}`,
    evidenceProcedureIds: procedures,
    severity,
    remediation,
  };
}

const TIER_3: VerifiableControl[] = [
  tier3(
    "management-mandate",
    "AI management mandate and accountable owner",
    "Reads the named-procedure verdicts for the approved AI governance policy and the role assignment record, and reports whether an accountable owner exists for this system.",
    "Governance",
    ["governance", "compliance"],
    ["document-ai-governance-policy", "document-role-assignment"],
    "high",
    "Approve an AI governance policy and assign a named accountable owner for this system, then publish both verdicts through the evidence manifest.",
  ),
  tier3(
    "risk-management-cycle",
    "AI risk identification and treatment cycle",
    "Reads the risk register and risk treatment verdicts, and reports whether identified AI risks carry owners and treatment decisions rather than sitting unassigned.",
    "Risk management",
    ["governance", "compliance"],
    ["document-risk-register", "document-risk-treatment"],
    "high",
    "Maintain a current AI risk register with an owner and a treatment decision per risk, and publish both verdicts through the evidence manifest.",
  ),
  tier3(
    "human-oversight-design",
    "Human oversight, escalation and shutdown",
    "Reads the human oversight procedure verdict and reports whether an escalation route and a safe shutdown path are recorded for this system.",
    "Trustworthiness",
    ["trust", "governance"],
    ["document-human-oversight"],
    "high",
    "Record who can override, escalate and shut down the system, and how, then publish the verdict through the evidence manifest.",
  ),
  tier3(
    "incident-response-readiness",
    "AI incident response readiness",
    "Reads the incident runbook verdict and reports whether an AI-specific incident and breach procedure exists for this system.",
    "Operations",
    ["security", "compliance"],
    ["document-incident-runbook"],
    "high",
    "Write and exercise an AI incident runbook covering model failure, prompt injection and data disclosure, then publish the verdict.",
  ),
  tier3(
    "supplier-assurance",
    "Model provider and supplier assurance",
    "Reads the supplier assessment and vendor contract verdicts, and reports whether the model provider is covered by due diligence and contractual controls.",
    "Third-party risk",
    ["governance", "compliance"],
    ["document-supplier-assessment", "document-vendor-contracts"],
    "medium",
    "Complete due diligence on the model provider and record the contractual controls covering data use, retention and security, then publish both verdicts.",
  ),
  tier3(
    "privacy-notice",
    "Privacy notice and lawful basis",
    "Reads the privacy notice verdict and reports whether the notice covers this system's processing.",
    "Data lifecycle",
    ["data_protection", "compliance"],
    ["document-privacy-notice"],
    "high",
    "Extend the privacy notice to cover AI processing, the lawful basis and the retention period, then publish the verdict.",
  ),
  tier3(
    "ai-transparency-notice",
    "AI interaction disclosure to users",
    "Reads the AI transparency verdict and reports whether users are told they are interacting with an AI system, and what its limits are.",
    "Transparency",
    ["trust", "compliance"],
    ["document-ai-transparency"],
    "medium",
    "Disclose AI use at the point of interaction, state the system's limits and the route to human review, then publish the verdict.",
  ),
  tier3(
    "system-documentation",
    "System card and intended-use documentation",
    "Reads the system card, architecture diagram and data flow verdicts, and reports whether intended use, limits, data and architecture are documented.",
    "Documentation",
    ["governance", "trust"],
    ["document-system-card", "artifact-architecture-diagram", "artifact-data-flow"],
    "medium",
    "Maintain a current system card covering intended use, limits, data sources, evaluation results and change history, with an architecture and data-flow diagram.",
  ),
  tier3(
    "change-control",
    "Change control over model and prompt changes",
    "Reads the change policy verdict together with the recorded change history from the build pipeline, so the policy and what the pipeline actually did are judged together.",
    "Change control",
    ["governance"],
    ["document-change-policy", "artifact-change-history"],
    "medium",
    "Require review and approval for model, prompt and corpus changes, and keep the change history the pipeline records as the evidence of it.",
  ),
  tier3(
    "feedback-and-appeal",
    "User feedback and appeal route",
    "Reads the feedback process verdict and reports whether users can contest an AI output and reach a human.",
    "Trustworthiness",
    ["trust", "compliance"],
    ["document-feedback-process"],
    "medium",
    "Publish a route for users to contest an AI output and reach a human, with a response commitment, then publish the verdict.",
  ),
  tier3(
    "workforce-competence",
    "Workforce competence for AI operation",
    "Reads the training programme and training completion verdicts, and reports whether the people operating the system have been trained and whether completion is recorded.",
    "Governance",
    ["governance"],
    ["document-training-program", "artifact-training-completion"],
    "low",
    "Run AI-specific training for the people operating and overseeing the system, and record completion per person.",
  ),
  tier3(
    "evaluation-methodology",
    "Evaluation methodology and acceptance thresholds",
    "Reads the evaluation methodology verdict and reports whether acceptance thresholds are defined before results are judged against them.",
    "Output assurance",
    ["trust", "governance"],
    ["document-evaluation-methodology"],
    "high",
    "Define the evaluation method, dataset and acceptance thresholds, review them on a stated cadence, and publish the verdict.",
  ),
  tier3(
    "bias-and-adverse-impact",
    "Bias and adverse-impact testing",
    "Reads the bias evaluation verdict, which degrades automatically once its review-due date passes, so a stale test is reported as stale rather than as a pass.",
    "Fairness",
    ["trust", "compliance"],
    ["artifact-bias-evaluation"],
    "high",
    "Re-run outcome testing across the relevant groups, record the mitigation and re-test results, and set the next review date.",
  ),
  tier3(
    "explainability-evidence",
    "Explainability of system outputs",
    "Reads the explainability test verdict and reports whether the system can show why it produced a given output.",
    "Transparency",
    ["trust"],
    ["artifact-explainability-tests"],
    "medium",
    "Test and record how an output can be traced to its retrieved sources and prompt, and publish the verdict.",
  ),
  tier3(
    "privacy-testing",
    "Privacy control testing",
    "Reads the privacy test verdict and reports whether redaction and minimisation controls have been tested rather than only configured.",
    "Data protection",
    ["data_protection", "compliance"],
    ["artifact-privacy-tests"],
    "medium",
    "Test the redaction and minimisation controls against realistic inputs, record the results, and publish the verdict.",
  ),
  tier3(
    "threat-model",
    "AI-specific threat model",
    "Reads the threat model verdict and reports whether prompt injection, corpus poisoning, disclosure and excessive agency are covered.",
    "Adversarial resilience",
    ["security", "governance"],
    ["artifact-threat-model"],
    "high",
    "Produce an AI-specific threat model covering injection, poisoning, disclosure and agency, with a mitigation per threat.",
  ),
  tier3(
    "encryption-configuration",
    "Encryption configuration and key custody",
    "Reads the encryption configuration and network configuration verdicts, and reports whether at-rest protection and network boundaries are recorded.",
    "Technical safeguards",
    ["security", "data_protection"],
    ["artifact-encryption-configuration", "artifact-network-configuration"],
    "high",
    "Record the at-rest encryption configuration, key custody and network boundaries for the data store and the deployment, then publish both verdicts.",
  ),
  tier3(
    "entitlement-review",
    "Access entitlement review",
    "Reads the access review verdict and reports whether entitlements to the system and its data store have been reviewed on a cadence.",
    "Access management",
    ["security", "governance"],
    ["artifact-access-review"],
    "high",
    "Review who holds access to the deployment, the data store and the model provider account, remove what is no longer needed, and record the review.",
  ),
  tier3(
    "software-supply-chain",
    "Software supply chain integrity",
    "Reads the SBOM and dependency scan verdicts produced by the build pipeline, so this control is closed by what the pipeline recorded rather than by an assertion about it.",
    "Third-party risk",
    ["security", "governance"],
    ["artifact-sbom", "artifact-dependency-scan"],
    "high",
    "Generate an SBOM and run a dependency audit in the pipeline, publish both, and fail the build on unpatched advisories.",
  ),
  tier3(
    "security-test-gate",
    "Security regression gate in the pipeline",
    "Reads the security test verdict produced by the build pipeline and reports whether security tests run as a required gate.",
    "Adversarial resilience",
    ["security"],
    ["artifact-security-tests"],
    "high",
    "Make the security test suite a required status check so a regression fails the build rather than reaching production.",
  ),
  tier3(
    "corpus-provenance",
    "Retrieval corpus provenance and approval",
    "Reads the corpus manifest and integrity verification verdicts, which are recomputed from the running service, so provenance is measured rather than asserted.",
    "Data assurance",
    ["trust", "data_protection"],
    ["artifact-rag-corpus-manifest", "artifact-integrity-verification"],
    "critical",
    "Record an approved source, owner, approval date and digest for every corpus document, and verify the digests at ingestion.",
  ),
  tier3(
    "vector-configuration",
    "Vector store configuration of record",
    "Reads the vector configuration verdict recomputed from the running service and reports the index, dimensions, similarity metric and tenant filter actually in use.",
    "Data assurance",
    ["data_protection", "security"],
    ["artifact-vector-configuration"],
    "medium",
    "Publish the vector index, dimensions, similarity metric and tenant filter field, and keep the record consistent with what the service uses.",
  ),
  tier3(
    "model-inventory-record",
    "Model inventory of record",
    "Reads the model provenance and system inventory verdicts recomputed from the running service, and reports the model versions actually in use.",
    "Documentation",
    ["governance", "trust"],
    ["artifact-model-provenance", "artifact-system-inventory"],
    "medium",
    "Publish the generation and embedding model versions through the evidence surface and keep the inventory entry consistent with them.",
  ),
  tier3(
    "resource-ceiling-record",
    "Resource and cost ceiling of record",
    "Reads the rate limit, resource limit and cost budget verdicts recomputed from the running service, and reports the ceilings actually enforced.",
    "Resilience",
    ["security", "governance"],
    ["artifact-rate-limits", "artifact-resource-limits", "artifact-cost-budgets"],
    "medium",
    "Publish the request, resource and spend ceilings actually enforced, and keep the recorded ceilings consistent with the running configuration.",
  ),
  tier3(
    "output-handling-record",
    "Output handling and sink inventory",
    "Reads the schema validation, output sink review and output encoding verdicts, and reports whether every sink receiving model output has been reviewed.",
    "Output assurance",
    ["security"],
    ["artifact-schema-validation", "artifact-output-sink-review", "artifact-output-encoding"],
    "high",
    "Review every sink that receives model output, record its encoding treatment, and publish the schema validation and sink review verdicts.",
  ),
  tier3(
    "tool-permission-record",
    "Tool permission inventory",
    "Reads the tool permission verdict recomputed from the running service and reports the actions the model is permitted to invoke.",
    "Adversarial resilience",
    ["security", "governance"],
    ["artifact-tool-permissions"],
    "medium",
    "Publish the tool and function inventory with the permission scope of each, and keep it consistent with what the service exposes to the model.",
  ),
  tier3(
    "audit-log-evidence",
    "Audit log content and review",
    "Reads the audit log sample and log review verdicts, and reports whether logs are both produced and actually reviewed.",
    "Auditability",
    ["compliance", "security"],
    ["artifact-audit-log-sample", "artifact-log-review-records"],
    "high",
    "Retain audit logs with the fields an investigation needs, review them on a stated cadence, and record each review.",
  ),
  tier3(
    "monitoring-thresholds",
    "Monitoring thresholds of record",
    "Reads the monitoring threshold verdict recomputed from the running service and reports the thresholds actually configured.",
    "Operations",
    ["compliance", "trust"],
    ["artifact-monitor-thresholds"],
    "medium",
    "Publish the monitoring thresholds actually configured, and keep the recorded thresholds consistent with the alerting configuration.",
  ),
  tier3(
    "records-retention-evidence",
    "Records retention evidence",
    "Reads the record retention verdict and reports whether a retention schedule exists for the records this system holds.",
    "Data lifecycle",
    ["data_protection", "compliance"],
    ["document-record-retention"],
    "high",
    "Write a retention schedule covering every record class this system holds, with a period and a lawful basis or business reason for each.",
  ),
  tier3(
    "continuity-and-recovery",
    "Continuity and recovery capability",
    "Reads the disaster recovery and backup verdicts, and reports whether recovery has been tested rather than only planned.",
    "Resilience",
    ["governance", "compliance"],
    ["document-disaster-recovery", "document-backup-plan"],
    "medium",
    "Test the recovery path end to end, record the recovery time achieved, and publish the disaster recovery and backup verdicts.",
  ),
];

export const verificationLibrary: VerifiableControl[] = [...TIER_1, ...TIER_2, ...TIER_3];

export const verifiableByKey = new Map<string, VerifiableControl>(
  verificationLibrary.map((entry) => [entry.key, entry]),
);

/** The control body without the library key, ready to take a standard's identifiers. */
export const controlBodyByKey = new Map<string, Omit<VerifiableControl, "key">>(
  verificationLibrary.map(({ key, ...body }) => [key, body]),
);

/** Every evidence procedure the library depends on. Unioned into the accepted set. */
export const libraryProcedureIds: string[] = [
  ...new Set(verificationLibrary.flatMap((entry) => entry.evidenceProcedureIds ?? [])),
].sort();

export const libraryKeysByTier = (tier: AccessTier): string[] =>
  verificationLibrary.filter((entry) => entry.tierMinimum === tier).map((entry) => entry.key);
