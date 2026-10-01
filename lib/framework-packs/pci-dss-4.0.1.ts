import { verifiableByKey } from "../verification-library";
import {
  contentHashForControls,
  createPackControl,
  validateFrameworkPack,
  type FrameworkPack,
  type PackControlInput,
} from "./schema";

const source = {
  authority: "PCI Security Standards Council",
  title: "PCI DSS v4.0.1",
  url: "https://www.pcisecuritystandards.org/document_library/",
  status: "current" as const,
  note: "PCI DSS v4.0.1 (June 2024). Requirements future-dated to 31 March 2025 are now in force and are scored as effective. Requirement 9 physical access has no remote evidence path and is out of scope for this assessment.",
};

const control = (input: PackControlInput) => createPackControl(input, source);

const NETWORK = "Requirement 1 — Network security controls";
const CONFIG = "Requirement 2 — Secure configurations";
const STORED = "Requirement 3 — Protect stored account data";
const TRANSIT = "Requirement 4 — Protect cardholder data in transmission";
const SOFTWARE = "Requirement 6 — Secure systems and software";
const ACCESS = "Requirement 7 — Restrict access by business need to know";
const IDENTITY = "Requirement 8 — Identify users and authenticate access";
const LOGGING = "Requirement 10 — Log and monitor all access";
const TESTING = "Requirement 11 — Test security regularly";
const POLICY = "Requirement 12 — Organizational policies and programs";
const A1 = "Appendix A1 — Multi-tenant service providers";

/*
 * Every requirement listed applies to every assessed assistant, and there are no
 * scope questions. The pack lists only requirements a Tier 3 run can reach a
 * verdict on: 3.3.1, 4.2.2, 6.4.3, 6.5.5, 8.4.2, 8.6.2, 11.6.1, 12.5.2, 12.8.5,
 * 12.10.7 and A1.1.4 have no evidence the target publishes and are out of scope,
 * as Requirement 9 is.
 */

/**
 * A requirement judged by an existing verification-library check.
 *
 * The rule, tier, test type and evidence procedures come from the library, so this
 * control is closed by the same evidence — and fixed by the same playbook — as the
 * matching control in every other standard. Only the requirement it is cited
 * against, and what that requirement asks, are PCI-specific.
 */
function fromLibrary(
  key: string,
  input: Omit<
    PackControlInput,
    "tierMinimum" | "pillars" | "testType" | "evaluationRuleId" | "evidenceProcedureIds"
  >,
) {
  const entry = verifiableByKey.get(key);
  if (!entry) throw new Error(`Unknown verification library key: ${key}`);
  // Probe and adapter entries carry no named procedures of their own; a pack
  // control needs one, so it is named after the probe or rule that judges it.
  const procedures =
    entry.evidenceProcedureIds ??
    [
      entry.evaluationRuleId.startsWith("probe.")
        ? `probe-${key}`
        : `adapter-${entry.evaluationRuleId.replace(/^adapter\./, "")}`,
    ];
  return control({
    ...input,
    tierMinimum: entry.tierMinimum,
    pillars: entry.pillars,
    testType: entry.testType,
    evaluationRuleId: entry.evaluationRuleId,
    evidenceProcedureIds: procedures,
  });
}

const controls = [
  /* ---- Requirement 1 -------------------------------------------------------- */
  fromLibrary("system-documentation", {
    id: "1.2.4",
    name: "Account data-flow diagram",
    objective: "An accurate data-flow diagram shows every path account data can take through the assistant — chat input, model provider, retrieval index, logs, and downstream tools — and is updated on change.",
    category: NETWORK,
    severity: "high",
    section: "Requirement 1.2.4",
    remediationId: "pci-data-flow-diagram",
    remediation: "Draw the assistant's account-data flows, including where a typed card number would travel and be stored, and keep the diagram current with each architecture change.",
  }),
  control({
    id: "1.3.1",
    name: "Inbound traffic to the CDE restricted",
    objective: "Network security controls allow only the traffic the assistant needs into the cardholder data environment and deny everything else.",
    category: NETWORK,
    tierMinimum: 3,
    pillars: ["security"],
    testType: "document_verify",
    evaluationRuleId: "artifact.pci-cde-inbound-traffic",
    severity: "high",
    section: "Requirement 1.3.1",
    evidenceProcedureIds: ["artifact-network-configuration"],
    remediationId: "pci-cde-inbound-traffic",
    remediation: "Restrict inbound connections from the assistant's hosting, model provider, and retrieval services to named CDE endpoints, and deny all other traffic by default.",
  }),

  /* ---- Requirement 2 -------------------------------------------------------- */
  fromLibrary("deployment-hardening", {
    id: "2.2.1",
    name: "Configuration standards applied to the assistant",
    objective: "The assistant's deployment follows a configuration standard: it is labelled for the environment it serves and accepts browser traffic only from the exact origins that consume it.",
    category: CONFIG,
    severity: "high",
    section: "Requirement 2.2.1",
    mappingType: "governai_evidence_mapping",
    remediationId: "pci-configuration-standard",
    remediation: "Adopt a configuration standard for the assistant's deployment and enforce environment labelling and exact-origin allow-lists.",
  }),
  fromLibrary("tool-permission-record", {
    id: "2.2.4",
    name: "Only necessary functions enabled",
    objective: "The tools and functions the model can invoke are limited to those the assistant's purpose requires; unnecessary functionality is removed or disabled.",
    category: CONFIG,
    severity: "high",
    section: "Requirement 2.2.4",
    mappingType: "governai_evidence_mapping",
    remediationId: "pci-necessary-functions",
    remediation: "Inventory every tool and function exposed to the model and disable any that the assistant's documented purpose does not need.",
  }),
  fromLibrary("vector-configuration", {
    id: "2.2.6",
    name: "Retrieval-store security parameters",
    objective: "Security parameters of the vector database and retrieval index are configured to prevent misuse.",
    category: CONFIG,
    severity: "medium",
    section: "Requirement 2.2.6",
    mappingType: "governai_evidence_mapping",
    remediationId: "pci-retrieval-store-parameters",
    remediation: "Harden the vector store's authentication, network exposure, and namespace settings to a documented baseline.",
  }),

  /* ---- Requirement 3 -------------------------------------------------------- */
  fromLibrary("retention-schedule", {
    id: "3.2.1",
    name: "Account data retention kept to a minimum",
    objective: "Chat transcripts, logs, and indexed content that could hold account data are kept only as long as a documented retention schedule allows, then disposed of.",
    category: STORED,
    severity: "critical",
    section: "Requirement 3.2.1",
    remediationId: "pci-account-data-retention",
    remediation: "Set and enforce retention limits for transcripts, logs, and retrieval content that may contain account data, with secure deletion at expiry.",
  }),
  fromLibrary("response-redaction", {
    id: "3.4.1",
    name: "PAN masked when displayed",
    objective: "Responses mask any primary account number to at most the BIN and last four digits, so the assistant never displays a full card number.",
    category: STORED,
    severity: "critical",
    section: "Requirement 3.4.1",
    remediationId: "pci-pan-display-masking",
    remediation: "Apply output redaction that masks card numbers to BIN plus last four before any response is returned or rendered.",
  }),
  control({
    id: "3.5.1",
    name: "PAN unreadable wherever stored",
    objective: "Any primary account number that reaches storage — transcripts, logs, embeddings, or backups — is rendered unreadable by tokenization, truncation, hashing, or strong cryptography.",
    category: STORED,
    tierMinimum: 3,
    pillars: ["data_protection", "security"],
    testType: "document_verify",
    evaluationRuleId: "artifact.pci-pan-unreadable",
    severity: "critical",
    section: "Requirement 3.5.1",
    evidenceProcedureIds: ["artifact-encryption-configuration", "artifact-pan-discovery-scan"],
    remediationId: "pci-pan-storage",
    remediation: "Tokenize or truncate card numbers before they are logged, embedded, or stored, and confirm with a discovery scan across every store the assistant writes to.",
  }),
  fromLibrary("encryption-configuration", {
    id: "3.6.1",
    name: "Cryptographic key protection",
    objective: "Keys that protect stored account data are protected against disclosure and misuse under documented key-management procedures.",
    category: STORED,
    severity: "high",
    section: "Requirement 3.6.1",
    remediationId: "pci-key-management",
    remediation: "Document key custody, rotation, and access for every key protecting the assistant's stored data, and restrict key access to named custodians.",
  }),

  /* ---- Requirement 4 -------------------------------------------------------- */
  fromLibrary("transport-encryption", {
    id: "4.2.1",
    name: "Strong cryptography over public networks",
    objective: "Account data sent between the customer, the assistant, the model provider, and the retrieval store is protected by strong cryptography with valid certificates.",
    category: TRANSIT,
    severity: "critical",
    section: "Requirement 4.2.1",
    remediationId: "pci-transport-encryption",
    remediation: "Enforce TLS 1.2 or later with valid certificates on every hop that can carry account data, and reject plaintext fallbacks.",
  }),

  /* ---- Requirement 6 -------------------------------------------------------- */
  fromLibrary("instruction-boundary", {
    id: "6.2.4",
    name: "Injection attacks prevented",
    objective: "The assistant's software prevents injection attacks: a bounded prompt-injection probe cannot override its instructions or authorization boundary.",
    category: SOFTWARE,
    severity: "critical",
    section: "Requirement 6.2.4",
    remediationId: "pci-injection-prevention",
    remediation: "Isolate system instructions from user and retrieved content, constrain tool calls, and regression-test injection cases before release.",
  }),
  fromLibrary("combined-rag-safety", {
    id: "6.2.4-logic",
    name: "Business-logic abuse prevented",
    objective: "Combined attempts to abuse the assistant's retrieval and response features — injected instructions that also seek data — are contained, as Requirement 6.2.4 requires for business-logic attacks.",
    category: SOFTWARE,
    severity: "high",
    section: "Requirement 6.2.4",
    mappingType: "governai_evidence_mapping",
    remediationId: "pci-business-logic-abuse",
    remediation: "Test combined injection-and-exfiltration cases against the retrieval path and block responses that cross the data boundary.",
  }),
  fromLibrary("software-supply-chain", {
    id: "6.3.1",
    name: "Security vulnerabilities identified and managed",
    objective: "Vulnerabilities in the assistant's code and dependencies are identified from a maintained component inventory and dependency scanning, and ranked for remediation.",
    category: SOFTWARE,
    severity: "high",
    section: "Requirement 6.3.1",
    remediationId: "pci-vulnerability-management",
    remediation: "Maintain an SBOM for the assistant and scan dependencies on every build, with risk-ranked remediation deadlines.",
  }),
  fromLibrary("model-provenance", {
    id: "6.3.2",
    name: "Third-party component inventory",
    objective: "The model and embedding versions the assistant depends on are pinned and recorded, so third-party components can be tracked for vulnerabilities and patches.",
    category: SOFTWARE,
    severity: "medium",
    section: "Requirement 6.3.2",
    mappingType: "governai_evidence_mapping",
    remediationId: "pci-component-inventory",
    remediation: "Pin model and embedding versions and record them, with other third-party components, in the software inventory.",
  }),
  fromLibrary("guardrail-configuration", {
    id: "6.4.2",
    name: "Automated attack detection on the public interface",
    objective: "The assistant's public interface runs an automated technical solution — input guardrails configured to detect and block attacks — continually, not on request.",
    category: SOFTWARE,
    severity: "high",
    section: "Requirement 6.4.2",
    mappingType: "governai_evidence_mapping",
    remediationId: "pci-automated-attack-detection",
    remediation: "Enable input guardrails in blocking mode on every public route to the assistant and alert on blocked attacks.",
  }),
  fromLibrary("change-control", {
    id: "6.5.1",
    name: "Production changes follow change control",
    objective: "Changes to the assistant's prompts, models, retrieval corpus, and code in production follow an established change procedure with approval and rollback.",
    category: SOFTWARE,
    severity: "high",
    section: "Requirement 6.5.1",
    remediationId: "pci-change-control",
    remediation: "Route prompt, model, corpus, and code changes through the same approved change procedure, with recorded approval and a rollback plan.",
  }),
  fromLibrary("security-test-gate", {
    id: "6.5.2",
    name: "Requirements confirmed after significant change",
    objective: "After a significant change — such as a new model or tool — security testing confirms the applicable PCI DSS requirements are still in place before release.",
    category: SOFTWARE,
    severity: "high",
    section: "Requirement 6.5.2",
    mappingType: "governai_evidence_mapping",
    remediationId: "pci-post-change-confirmation",
    remediation: "Gate releases on a security test suite and record confirmation that applicable requirements still hold after each significant change.",
  }),

  /* ---- Requirement 7 -------------------------------------------------------- */
  fromLibrary("entitlement-review", {
    id: "7.2.4",
    name: "Access reviewed every six months",
    objective: "User and vendor accounts with access to the assistant's administration, logs, and retrieval content are reviewed at least once every six months.",
    category: ACCESS,
    severity: "high",
    section: "Requirement 7.2.4",
    remediationId: "pci-access-review",
    remediation: "Review every account with access to the assistant's administration, transcripts, and corpus at least twice a year, and record removals.",
  }),
  fromLibrary("agency-boundary", {
    id: "7.2.5",
    name: "Assistant service accounts on least privilege",
    objective: "The application and service identities the assistant acts through hold only the privileges its function requires.",
    category: ACCESS,
    severity: "high",
    section: "Requirement 7.2.5",
    remediationId: "pci-service-account-privilege",
    remediation: "Scope the assistant's service identities to read-only, purpose-bound permissions and remove any write or administrative grants it does not need.",
  }),
  fromLibrary("sensitive-disclosure", {
    id: "7.2.6",
    name: "Query access to stored cardholder data restricted",
    objective: "The assistant, as a query interface over stored data, does not disclose information outside the requester's authorization when probed for it.",
    category: ACCESS,
    severity: "critical",
    section: "Requirement 7.2.6",
    remediationId: "pci-query-restriction",
    remediation: "Enforce the requester's authorization at retrieval time and filter responses so the assistant cannot be used to query cardholder data.",
  }),

  /* ---- Requirement 8 -------------------------------------------------------- */
  fromLibrary("credential-hygiene", {
    id: "8.6.3",
    name: "Service credentials protected against misuse",
    objective: "Credentials for the assistant's application and system accounts are strong and rotated periodically and on suspicion of compromise.",
    category: IDENTITY,
    severity: "critical",
    section: "Requirement 8.6.3",
    remediationId: "pci-service-credentials",
    remediation: "Issue strong service credentials from a secret manager with scheduled rotation and immediate rotation on suspected compromise.",
  }),

  /* ---- Requirement 10 ------------------------------------------------------- */
  fromLibrary("request-audit-trail", {
    id: "10.2.1",
    name: "Audit logs enabled",
    objective: "Audit logging is enabled and active for every request the assistant serves.",
    category: LOGGING,
    severity: "high",
    section: "Requirement 10.2.1",
    remediationId: "pci-audit-logging",
    remediation: "Record an audit entry for every assistant request, including administrative and retrieval actions.",
  }),
  fromLibrary("event-forensics", {
    id: "10.2.2",
    name: "Audit log entries carry required detail",
    objective: "Logged events record identity, event type, time, success or failure, origin, and the affected resource — without storing account data.",
    category: LOGGING,
    severity: "medium",
    section: "Requirement 10.2.2",
    remediationId: "pci-audit-log-detail",
    remediation: "Add identity, event type, timestamp, outcome, origin, and affected resource to every audit event, and keep card data out of log payloads.",
  }),
  fromLibrary("audit-log-evidence", {
    id: "10.4.1",
    name: "Security events reviewed daily",
    objective: "Security events and logs from the assistant's CDE components are reviewed at least once daily, with records of the review.",
    category: LOGGING,
    severity: "high",
    section: "Requirement 10.4.1",
    remediationId: "pci-daily-log-review",
    remediation: "Assign a daily review of the assistant's security events and keep a record of each review and its follow-up.",
  }),
  fromLibrary("objective-coverage", {
    id: "10.4.1.1",
    name: "Automated log review",
    objective: "Automated mechanisms — thresholds watching every declared objective — perform the audit log review rather than relying on manual reading.",
    category: LOGGING,
    severity: "high",
    section: "Requirement 10.4.1.1",
    mappingType: "governai_evidence_mapping",
    remediationId: "pci-automated-log-review",
    remediation: "Put an automated alert threshold on every declared security objective so log review does not depend on someone reading raw logs.",
  }),
  fromLibrary("records-retention-evidence", {
    id: "10.5.1",
    name: "Audit logs retained for twelve months",
    objective: "Audit log history is retained for at least twelve months, with the most recent three months immediately available.",
    category: LOGGING,
    severity: "high",
    section: "Requirement 10.5.1",
    remediationId: "pci-log-retention",
    remediation: "Retain the assistant's audit logs for twelve months, keeping three months in hot storage for immediate analysis.",
  }),
  fromLibrary("breach-alerting", {
    id: "10.7.2",
    name: "Security control failures detected and alerted",
    objective: "Failures of critical security controls around the assistant — guardrails, logging, monitoring — raise an alert that reaches a named responder promptly.",
    category: LOGGING,
    severity: "high",
    section: "Requirement 10.7.2",
    remediationId: "pci-control-failure-alerting",
    remediation: "Route alerts for failed guardrails, logging gaps, and monitoring outages to an on-call responder with a response deadline.",
  }),

  /* ---- Requirement 11 ------------------------------------------------------- */
  control({
    id: "11.4.1",
    name: "Penetration testing covers the assistant",
    objective: "A defined penetration-testing methodology covers the assistant's application layer, including prompt-injection and data-exfiltration attempts, and its results are retained.",
    category: TESTING,
    tierMinimum: 3,
    pillars: ["security"],
    testType: "document_verify",
    evaluationRuleId: "artifact.pci-penetration-testing",
    severity: "high",
    section: "Requirement 11.4.1",
    evidenceProcedureIds: ["artifact-security-tests", "artifact-penetration-test-report"],
    remediationId: "pci-penetration-testing",
    remediation: "Extend the penetration-testing methodology to the assistant's application layer, with LLM-specific attack cases, and retain the reports.",
  }),
  fromLibrary("corpus-integrity", {
    id: "11.5.2",
    name: "Change detection on critical content",
    objective: "A change-detection mechanism compares the retrieval corpus against its approved baseline and alerts on unauthorized modification.",
    category: TESTING,
    severity: "critical",
    section: "Requirement 11.5.2",
    mappingType: "governai_evidence_mapping",
    remediationId: "pci-change-detection",
    remediation: "Baseline the approved corpus with checksums, compare at least weekly, and alert on any unapproved change.",
  }),

  /* ---- Requirement 12 ------------------------------------------------------- */
  fromLibrary("management-mandate", {
    id: "12.1.3",
    name: "Security roles and responsibilities defined",
    objective: "Responsibility for the assistant's security is assigned to named roles that acknowledge it.",
    category: POLICY,
    severity: "high",
    section: "Requirement 12.1.3",
    remediationId: "pci-security-roles",
    remediation: "Name an accountable owner for the assistant's security and record the role assignment.",
  }),
  fromLibrary("risk-management-cycle", {
    id: "12.3.1",
    name: "Targeted risk analysis",
    objective: "Where PCI DSS lets the organization set a control frequency, a targeted risk analysis for the assistant justifies it.",
    category: POLICY,
    severity: "high",
    section: "Requirement 12.3.1",
    mappingType: "governai_evidence_mapping",
    remediationId: "pci-targeted-risk-analysis",
    remediation: "Write a targeted risk analysis for each flexible-frequency requirement affecting the assistant, such as credential rotation and log-review cadence.",
  }),
  fromLibrary("model-inventory-record", {
    id: "12.3.4",
    name: "Technologies reviewed for end of life",
    objective: "The models and services the assistant depends on are reviewed at least annually for continued vendor security support and announced deprecation.",
    category: POLICY,
    severity: "medium",
    section: "Requirement 12.3.4",
    mappingType: "governai_evidence_mapping",
    remediationId: "pci-technology-review",
    remediation: "Review model and service deprecation notices at least annually and plan migration before vendor support ends.",
  }),
  fromLibrary("system-inventory", {
    id: "12.5.1",
    name: "In-scope component inventory",
    objective: "The assistant's in-scope components — environment, model provider, data store — are inventoried with their function and kept current.",
    category: POLICY,
    severity: "medium",
    section: "Requirement 12.5.1",
    remediationId: "pci-component-inventory-record",
    remediation: "Keep every in-scope component of the assistant in the system inventory with its function and owner.",
  }),
  fromLibrary("workforce-competence", {
    id: "12.6.3",
    name: "Security awareness training",
    objective: "People who operate or administer the assistant receive security awareness training on hire and at least annually.",
    category: POLICY,
    severity: "medium",
    section: "Requirement 12.6.3",
    remediationId: "pci-awareness-training",
    remediation: "Include the assistant's operators in the security awareness program, with training on card data in chat and prompt-based attacks.",
  }),
  fromLibrary("supplier-assurance", {
    id: "12.8.2",
    name: "Written agreements with service providers",
    objective: "The model provider, vector database, and hosting provider are covered by written agreements acknowledging their responsibility for the account data they handle.",
    category: POLICY,
    severity: "high",
    section: "Requirement 12.8.2",
    remediationId: "pci-tpsp-agreements",
    remediation: "Put written agreements in place with each provider that can handle account data, stating their security responsibility.",
  }),
  fromLibrary("incident-response-readiness", {
    id: "12.10.1",
    name: "Incident response plan",
    objective: "An incident response plan covering the assistant exists and is ready to activate on a suspected security incident.",
    category: POLICY,
    severity: "critical",
    section: "Requirement 12.10.1",
    remediationId: "pci-incident-response",
    remediation: "Extend the incident response plan to the assistant, including card-data exposure through chat and prompt-based attacks.",
  }),
  fromLibrary("monitoring-thresholds", {
    id: "12.10.5",
    name: "Incident response covers security alerts",
    objective: "The incident response plan includes monitoring and responding to alerts from the assistant's security monitoring.",
    category: POLICY,
    severity: "high",
    section: "Requirement 12.10.5",
    mappingType: "governai_evidence_mapping",
    remediationId: "pci-alert-response",
    remediation: "Tie each monitoring threshold on the assistant to an incident-response action and owner.",
  }),

  /* ---- Appendix A1 ---------------------------------------------------------- */
  fromLibrary("tenant-isolation", {
    id: "A1.1.2",
    name: "Each merchant reaches only its own data",
    objective: "Retrieval and responses are isolated per merchant customer, so one customer can never reach another's data through the assistant.",
    category: A1,
    severity: "critical",
    section: "Appendix A1.1.2",
    remediationId: "pci-tenant-isolation",
    remediation: "Enforce per-customer namespaces and authorization in retrieval, and test that cross-tenant queries return nothing.",
  }),
];

export const pciDss401Pack: FrameworkPack = validateFrameworkPack({
  manifest: {
    id: "pci_dss",
    release: "2026.10-draft.3",
    status: "draft",
    assuranceLevel: "readiness",
    sourceVersion: "PCI DSS v4.0.1 (June 2024)",
    publishedAt: "2026-10-01",
    contentHash: contentHashForControls(controls),
    note: "Initial ARQ Governance-authored PCI DSS readiness pack for retail and e-commerce assistants. It is not a Report on Compliance, an Attestation of Compliance, or a QSA determination.",
  },
  standard: {
    id: "pci_dss",
    shortName: "PCI DSS",
    name: "Payment Card Industry Data Security Standard",
    version: "PCI DSS v4.0.1",
    kind: "Certifiable",
    jurisdiction: "Global",
    description: "Cardholder-data readiness for retail and e-commerce assistants: card numbers in chat, stored-data protection, access, logging, testing, and service-provider duties.",
    reportFormat: "PCI DSS v4.0.1 Readiness Assessment",
    scoringMethod: "Requirement conformity — In Place / Not in Place / Not Applicable, with critical-requirement overrides",
    passThreshold: "All applicable requirements in place; no failed critical requirement",
    officialReference: source,
  },
  controls,
});
