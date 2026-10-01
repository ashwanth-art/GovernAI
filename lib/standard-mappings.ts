import type { Control, StandardDefinition } from "./types";
import { controlBodyByKey, verifiableByKey } from "./verification-library";

/**
 * Per-standard control sets, selected from the verification library.
 *
 * Each entry gives the standard's own control identifier and the clause the
 * evidence is mapped to. The library entry supplies everything else, so the same
 * evidence closes the same control in every standard it appears in — which is
 * what lets one remediation playbook report how many controls across how many
 * standards it closes.
 *
 * A standard only lists controls ARQ Governance can actually verify. A clause with no
 * verifiable evidence path is deliberately absent rather than present and
 * permanently not_assessed: an unclosable control is noise in a coverage figure.
 * That is why selecting Tier 3 reaches 100% coverage — every control here has an
 * evidence path, and Tier 3 is the tier at which all of them are open.
 */

export interface MappedControl {
  /** Key into the verification library. */
  key: string;
  /** The standard's own identifier for this control. */
  controlId: string;
  /** The clause, criterion or principle this evidence is mapped to. */
  section: string;
}

const ISO_LIFECYCLE = "Annex A.6 AI system life cycle";
const ISO_DATA = "Annex A.7 Data for AI systems";
const ISO_RESOURCES = "Annex A.4 Resources for AI systems";
const ISO_IMPACT = "Annex A.5 Assessing impacts of AI systems";
const ISO_INFORMATION = "Annex A.8 Information for interested parties";
const ISO_USE = "Annex A.9 Responsible use of AI systems";
const ISO_THIRD_PARTY = "Annex A.10 Third-party and customer relationships";
const ISO_PERFORMANCE = "Clause 9 Performance evaluation";

const iso42001: MappedControl[] = [
  // Tier 1 — bounded probes against the running system.
  { key: "answer-grounding", controlId: "A.6.2.4", section: ISO_LIFECYCLE },
  { key: "instruction-boundary", controlId: "A.6.2.6", section: ISO_LIFECYCLE },
  { key: "sensitive-disclosure", controlId: "A.7.4", section: ISO_DATA },
  { key: "combined-rag-safety", controlId: "A.6.2.5", section: ISO_LIFECYCLE },
  { key: "service-availability", controlId: "8.1", section: "Clause 8 Operation" },

  // Tier 2 — read-only configuration and monitoring adapters.
  { key: "deployment-hardening", controlId: "A.6.2.7", section: ISO_LIFECYCLE },
  { key: "credential-hygiene", controlId: "A.4.3", section: ISO_RESOURCES },
  { key: "consumption-ceilings", controlId: "A.4.4", section: ISO_RESOURCES },
  { key: "retention-schedule", controlId: "A.7.3", section: ISO_DATA },
  { key: "corpus-integrity", controlId: "A.7.5", section: ISO_DATA },
  { key: "tenant-isolation", controlId: "A.7.6", section: ISO_DATA },
  { key: "output-contract", controlId: "A.6.2.8", section: ISO_LIFECYCLE },
  { key: "agency-boundary", controlId: "A.9.3", section: ISO_USE },
  { key: "model-provenance", controlId: "A.6.1.3", section: ISO_LIFECYCLE },
  { key: "transport-encryption", controlId: "A.4.5", section: ISO_RESOURCES },
  { key: "response-redaction", controlId: "A.7.2", section: ISO_DATA },
  { key: "guardrail-configuration", controlId: "A.6.2.9", section: ISO_LIFECYCLE },
  { key: "service-levels", controlId: "9.1.1", section: ISO_PERFORMANCE },
  { key: "breach-alerting", controlId: "9.1.2", section: ISO_PERFORMANCE },
  { key: "objective-coverage", controlId: "9.1.3", section: ISO_PERFORMANCE },
  { key: "trend-visibility", controlId: "9.1.4", section: ISO_PERFORMANCE },
  { key: "event-forensics", controlId: "A.6.2.11", section: ISO_LIFECYCLE },
  { key: "request-audit-trail", controlId: "A.6.2.10", section: ISO_LIFECYCLE },
  { key: "usage-accounting", controlId: "A.4.6", section: ISO_RESOURCES },
  { key: "evidence-surface", controlId: "7.5.1", section: "Clause 7 Support" },
  { key: "system-inventory", controlId: "4.4", section: "Clause 4 Context of the organization" },

  // Tier 3 — named evidence procedures.
  { key: "management-mandate", controlId: "5.2", section: "Clause 5 Leadership" },
  { key: "risk-management-cycle", controlId: "6.1", section: "Clause 6 Planning" },
  { key: "human-oversight-design", controlId: "A.9.2", section: ISO_USE },
  { key: "incident-response-readiness", controlId: "10.2", section: "Clause 10 Improvement" },
  { key: "supplier-assurance", controlId: "A.10.2", section: ISO_THIRD_PARTY },
  { key: "privacy-notice", controlId: "A.8.2", section: ISO_INFORMATION },
  { key: "ai-transparency-notice", controlId: "A.8.3", section: ISO_INFORMATION },
  { key: "system-documentation", controlId: "A.6.2.2", section: ISO_LIFECYCLE },
  { key: "change-control", controlId: "A.6.2.3", section: ISO_LIFECYCLE },
  { key: "feedback-and-appeal", controlId: "A.8.4", section: ISO_INFORMATION },
  { key: "workforce-competence", controlId: "7.2", section: "Clause 7 Support" },
  { key: "evaluation-methodology", controlId: "A.6.2.14", section: ISO_LIFECYCLE },
  { key: "bias-and-adverse-impact", controlId: "A.5.4", section: ISO_IMPACT },
  { key: "explainability-evidence", controlId: "A.8.5", section: ISO_INFORMATION },
  { key: "privacy-testing", controlId: "A.7.7", section: ISO_DATA },
  { key: "threat-model", controlId: "A.5.2", section: ISO_IMPACT },
  { key: "encryption-configuration", controlId: "A.4.7", section: ISO_RESOURCES },
  { key: "entitlement-review", controlId: "A.3.3", section: "Annex A.3 Internal organization" },
  { key: "software-supply-chain", controlId: "A.10.3", section: ISO_THIRD_PARTY },
  { key: "security-test-gate", controlId: "A.6.2.12", section: ISO_LIFECYCLE },
  { key: "corpus-provenance", controlId: "A.7.8", section: ISO_DATA },
  { key: "vector-configuration", controlId: "A.4.8", section: ISO_RESOURCES },
  { key: "model-inventory-record", controlId: "A.6.1.2", section: ISO_LIFECYCLE },
  { key: "resource-ceiling-record", controlId: "A.4.9", section: ISO_RESOURCES },
  { key: "output-handling-record", controlId: "A.6.2.13", section: ISO_LIFECYCLE },
  { key: "tool-permission-record", controlId: "A.9.4", section: ISO_USE },
  { key: "audit-log-evidence", controlId: "9.2", section: ISO_PERFORMANCE },
  { key: "monitoring-thresholds", controlId: "9.1.5", section: ISO_PERFORMANCE },
  { key: "records-retention-evidence", controlId: "7.5.3", section: "Clause 7 Support" },
  { key: "continuity-and-recovery", controlId: "A.4.10", section: ISO_RESOURCES },
];

const SOC_ACCESS = "CC6 Logical and physical access controls";
const SOC_OPERATIONS = "CC7 System operations";
const SOC_CHANGE = "CC8 Change management";
const SOC_RISK = "CC3 Risk assessment";
const SOC_MONITORING = "CC4 Monitoring activities";
const SOC_AVAILABILITY = "Availability A1";
const SOC_CONFIDENTIALITY = "Confidentiality C1";
const SOC_PRIVACY = "Privacy P1–P8";

const soc2: MappedControl[] = [
  // Tier 1
  { key: "instruction-boundary", controlId: "CC6.6", section: SOC_ACCESS },
  { key: "sensitive-disclosure", controlId: "C1.1", section: SOC_CONFIDENTIALITY },
  { key: "service-availability", controlId: "A1.1", section: SOC_AVAILABILITY },

  // Tier 2
  { key: "deployment-hardening", controlId: "CC6.6.1", section: SOC_ACCESS },
  { key: "credential-hygiene", controlId: "CC6.1", section: SOC_ACCESS },
  { key: "consumption-ceilings", controlId: "A1.1.2", section: SOC_AVAILABILITY },
  { key: "retention-schedule", controlId: "P4.2", section: SOC_PRIVACY },
  { key: "corpus-integrity", controlId: "CC7.1", section: SOC_OPERATIONS },
  { key: "tenant-isolation", controlId: "CC6.1.2", section: SOC_ACCESS },
  { key: "output-contract", controlId: "CC6.8", section: SOC_ACCESS },
  { key: "agency-boundary", controlId: "CC6.3", section: SOC_ACCESS },
  { key: "model-provenance", controlId: "CC8.1.2", section: SOC_CHANGE },
  { key: "transport-encryption", controlId: "CC6.7", section: SOC_ACCESS },
  { key: "response-redaction", controlId: "C1.1.2", section: SOC_CONFIDENTIALITY },
  { key: "guardrail-configuration", controlId: "CC6.6.2", section: SOC_ACCESS },
  { key: "service-levels", controlId: "A1.1.3", section: SOC_AVAILABILITY },
  { key: "breach-alerting", controlId: "CC7.2", section: SOC_OPERATIONS },
  { key: "objective-coverage", controlId: "A1.1.5", section: SOC_AVAILABILITY },
  { key: "trend-visibility", controlId: "CC7.2.3", section: SOC_OPERATIONS },
  { key: "event-forensics", controlId: "CC7.3", section: SOC_OPERATIONS },
  { key: "request-audit-trail", controlId: "CC7.2.2", section: SOC_OPERATIONS },
  { key: "usage-accounting", controlId: "A1.1.4", section: SOC_AVAILABILITY },
  { key: "evidence-surface", controlId: "CC4.1", section: SOC_MONITORING },
  { key: "system-inventory", controlId: "CC3.2", section: SOC_RISK },

  // Tier 3
  { key: "management-mandate", controlId: "CC1.1", section: "CC1 Control environment" },
  { key: "risk-management-cycle", controlId: "CC3.1", section: SOC_RISK },
  { key: "incident-response-readiness", controlId: "CC7.4", section: SOC_OPERATIONS },
  { key: "supplier-assurance", controlId: "CC9.2", section: "CC9 Risk mitigation" },
  { key: "privacy-notice", controlId: "P1.1", section: SOC_PRIVACY },
  { key: "system-documentation", controlId: "CC2.1", section: "CC2 Communication and information" },
  { key: "change-control", controlId: "CC8.1", section: SOC_CHANGE },
  { key: "workforce-competence", controlId: "CC1.4", section: "CC1 Control environment" },
  { key: "evaluation-methodology", controlId: "CC4.1.2", section: SOC_MONITORING },
  { key: "privacy-testing", controlId: "P8.1", section: SOC_PRIVACY },
  { key: "threat-model", controlId: "CC3.2.2", section: SOC_RISK },
  { key: "encryption-configuration", controlId: "CC6.7.2", section: SOC_ACCESS },
  { key: "entitlement-review", controlId: "CC6.2", section: SOC_ACCESS },
  { key: "software-supply-chain", controlId: "CC9.2.2", section: "CC9 Risk mitigation" },
  { key: "security-test-gate", controlId: "CC8.1.3", section: SOC_CHANGE },
  { key: "corpus-provenance", controlId: "CC7.1.2", section: SOC_OPERATIONS },
  { key: "vector-configuration", controlId: "C1.1.3", section: SOC_CONFIDENTIALITY },
  { key: "model-inventory-record", controlId: "CC3.2.3", section: SOC_RISK },
  { key: "resource-ceiling-record", controlId: "A1.1.6", section: SOC_AVAILABILITY },
  { key: "output-handling-record", controlId: "CC6.8.2", section: SOC_ACCESS },
  { key: "tool-permission-record", controlId: "CC6.3.2", section: SOC_ACCESS },
  { key: "audit-log-evidence", controlId: "CC7.2.4", section: SOC_OPERATIONS },
  { key: "monitoring-thresholds", controlId: "CC4.1.3", section: SOC_MONITORING },
  { key: "records-retention-evidence", controlId: "P4.2.2", section: SOC_PRIVACY },
  { key: "continuity-and-recovery", controlId: "A1.2", section: SOC_AVAILABILITY },
];

const FEAT_FAIRNESS = "FEAT Fairness principles";
const FEAT_ETHICS = "FEAT Ethics principles";
const FEAT_ACCOUNTABILITY = "FEAT Accountability principles";
const FEAT_TRANSPARENCY = "FEAT Transparency principles";

const mas_ai: MappedControl[] = [
  // Tier 1
  { key: "answer-grounding", controlId: "F2", section: FEAT_FAIRNESS },
  { key: "combined-rag-safety", controlId: "F3", section: FEAT_FAIRNESS },
  { key: "sensitive-disclosure", controlId: "E2", section: FEAT_ETHICS },
  { key: "instruction-boundary", controlId: "A4", section: FEAT_ACCOUNTABILITY },
  { key: "service-availability", controlId: "A3", section: FEAT_ACCOUNTABILITY },

  // Tier 2
  { key: "corpus-integrity", controlId: "F2.2", section: FEAT_FAIRNESS },
  { key: "retention-schedule", controlId: "E1.2", section: FEAT_ETHICS },
  { key: "tenant-isolation", controlId: "E1.3", section: FEAT_ETHICS },
  { key: "response-redaction", controlId: "E2.2", section: FEAT_ETHICS },
  { key: "deployment-hardening", controlId: "A4.2", section: FEAT_ACCOUNTABILITY },
  { key: "credential-hygiene", controlId: "A4.3", section: FEAT_ACCOUNTABILITY },
  { key: "consumption-ceilings", controlId: "A3.2", section: FEAT_ACCOUNTABILITY },
  { key: "guardrail-configuration", controlId: "A4.4", section: FEAT_ACCOUNTABILITY },
  { key: "model-provenance", controlId: "A2.2", section: FEAT_ACCOUNTABILITY },
  { key: "service-levels", controlId: "A3.3", section: FEAT_ACCOUNTABILITY },
  { key: "breach-alerting", controlId: "A3.4", section: FEAT_ACCOUNTABILITY },
  { key: "objective-coverage", controlId: "A3.6", section: FEAT_ACCOUNTABILITY },
  { key: "trend-visibility", controlId: "A3.7", section: FEAT_ACCOUNTABILITY },
  { key: "usage-accounting", controlId: "A3.5", section: FEAT_ACCOUNTABILITY },
  { key: "system-inventory", controlId: "A1.2", section: FEAT_ACCOUNTABILITY },
  { key: "request-audit-trail", controlId: "T2.2", section: FEAT_TRANSPARENCY },

  // Tier 3
  { key: "management-mandate", controlId: "A1", section: FEAT_ACCOUNTABILITY },
  { key: "risk-management-cycle", controlId: "A2", section: FEAT_ACCOUNTABILITY },
  { key: "human-oversight-design", controlId: "A3.8", section: FEAT_ACCOUNTABILITY },
  { key: "incident-response-readiness", controlId: "A4.5", section: FEAT_ACCOUNTABILITY },
  { key: "supplier-assurance", controlId: "A4.6", section: FEAT_ACCOUNTABILITY },
  { key: "bias-and-adverse-impact", controlId: "F1", section: FEAT_FAIRNESS },
  { key: "evaluation-methodology", controlId: "F4", section: FEAT_FAIRNESS },
  { key: "system-documentation", controlId: "E1", section: FEAT_ETHICS },
  { key: "ai-transparency-notice", controlId: "T1", section: FEAT_TRANSPARENCY },
  { key: "explainability-evidence", controlId: "T2", section: FEAT_TRANSPARENCY },
  { key: "feedback-and-appeal", controlId: "T2.3", section: FEAT_TRANSPARENCY },
];

/* ------------------------------------------------------- ISO/IEC 27001:2022 -- */
/* The information-security floor most enterprise buyers already hold. Annex A    */
/* themes map almost one-to-one onto the library, which is why this set is wide.  */
/* Controls with no infosec analogue — AI transparency notice, appeal routes,     */
/* bias evaluation, explainability — are deliberately absent rather than forced.  */

const ISO27_ORG = "Annex A.5 Organizational controls";
const ISO27_PEOPLE = "Annex A.6 People controls";
const ISO27_TECH = "Annex A.8 Technological controls";
const ISO27_LEADERSHIP = "Clause 5 Leadership";
const ISO27_PLANNING = "Clause 6 Planning";
const ISO27_PERFORMANCE = "Clause 9 Performance evaluation";

const iso27001: MappedControl[] = [
  // Tier 1
  { key: "instruction-boundary", controlId: "A.8.26", section: ISO27_TECH },
  { key: "sensitive-disclosure", controlId: "A.8.12", section: ISO27_TECH },
  { key: "service-availability", controlId: "A.8.14", section: ISO27_TECH },

  // Tier 2
  { key: "deployment-hardening", controlId: "A.8.9", section: ISO27_TECH },
  { key: "credential-hygiene", controlId: "A.5.17", section: ISO27_ORG },
  { key: "consumption-ceilings", controlId: "A.8.6", section: ISO27_TECH },
  { key: "retention-schedule", controlId: "A.8.10", section: ISO27_TECH },
  { key: "corpus-integrity", controlId: "A.5.12", section: ISO27_ORG },
  { key: "tenant-isolation", controlId: "A.8.3", section: ISO27_TECH },
  { key: "output-contract", controlId: "A.8.27", section: ISO27_TECH },
  { key: "agency-boundary", controlId: "A.8.2", section: ISO27_TECH },
  { key: "model-provenance", controlId: "A.5.21", section: ISO27_ORG },
  { key: "transport-encryption", controlId: "A.8.24", section: ISO27_TECH },
  { key: "response-redaction", controlId: "A.8.11", section: ISO27_TECH },
  { key: "guardrail-configuration", controlId: "A.8.23", section: ISO27_TECH },
  { key: "service-levels", controlId: "A.5.30", section: ISO27_ORG },
  { key: "breach-alerting", controlId: "A.5.25", section: ISO27_ORG },
  { key: "objective-coverage", controlId: "A.8.16", section: ISO27_TECH },
  { key: "trend-visibility", controlId: "A.5.7", section: ISO27_ORG },
  { key: "event-forensics", controlId: "A.5.28", section: ISO27_ORG },
  { key: "request-audit-trail", controlId: "A.8.15", section: ISO27_TECH },
  { key: "usage-accounting", controlId: "A.5.10", section: ISO27_ORG },
  { key: "evidence-surface", controlId: "9.1", section: ISO27_PERFORMANCE },
  { key: "system-inventory", controlId: "A.5.9", section: ISO27_ORG },

  // Tier 3
  { key: "management-mandate", controlId: "5.1", section: ISO27_LEADERSHIP },
  { key: "risk-management-cycle", controlId: "6.1.2", section: ISO27_PLANNING },
  { key: "human-oversight-design", controlId: "A.5.2", section: ISO27_ORG },
  { key: "incident-response-readiness", controlId: "A.5.24", section: ISO27_ORG },
  { key: "supplier-assurance", controlId: "A.5.19", section: ISO27_ORG },
  { key: "privacy-notice", controlId: "A.5.34", section: ISO27_ORG },
  { key: "system-documentation", controlId: "A.5.37", section: ISO27_ORG },
  { key: "change-control", controlId: "A.8.32", section: ISO27_TECH },
  { key: "workforce-competence", controlId: "A.6.3", section: ISO27_PEOPLE },
  { key: "evaluation-methodology", controlId: "9.1.2", section: ISO27_PERFORMANCE },
  { key: "privacy-testing", controlId: "A.8.33", section: ISO27_TECH },
  { key: "threat-model", controlId: "A.8.25", section: ISO27_TECH },
  { key: "encryption-configuration", controlId: "A.8.24.2", section: ISO27_TECH },
  { key: "entitlement-review", controlId: "A.5.18", section: ISO27_ORG },
  { key: "software-supply-chain", controlId: "A.8.30", section: ISO27_TECH },
  { key: "security-test-gate", controlId: "A.8.29", section: ISO27_TECH },
  { key: "corpus-provenance", controlId: "A.5.13", section: ISO27_ORG },
  { key: "vector-configuration", controlId: "A.8.31", section: ISO27_TECH },
  { key: "model-inventory-record", controlId: "A.5.9.2", section: ISO27_ORG },
  { key: "resource-ceiling-record", controlId: "A.8.6.2", section: ISO27_TECH },
  { key: "output-handling-record", controlId: "A.8.26.2", section: ISO27_TECH },
  { key: "tool-permission-record", controlId: "A.8.18", section: ISO27_TECH },
  { key: "audit-log-evidence", controlId: "A.8.15.2", section: ISO27_TECH },
  { key: "monitoring-thresholds", controlId: "A.8.16.2", section: ISO27_TECH },
  { key: "records-retention-evidence", controlId: "A.5.33", section: ISO27_ORG },
  { key: "continuity-and-recovery", controlId: "A.8.13", section: ISO27_TECH },
];

/* ------------------------------------------------------------------- GDPR -- */
/* The only standard here that touches every library key, because the Regulation */
/* covers lawfulness, rights, security and accountability in one instrument.     */
/* Selecting GDPR asserts in-scope processing: the pack carries no territorial   */
/* applicability logic yet, so it does not decide scope on the operator's behalf. */

const GDPR_PRINCIPLES = "Chapter II Principles (Articles 5–11)";
const GDPR_RIGHTS = "Chapter III Rights of the data subject (Articles 12–23)";
const GDPR_CONTROLLER = "Chapter IV Controller and processor (Articles 24–43)";

const gdpr: MappedControl[] = [
  // Tier 1
  { key: "answer-grounding", controlId: "Art. 5(1)(d)", section: GDPR_PRINCIPLES },
  { key: "instruction-boundary", controlId: "Art. 32(1)(b)", section: GDPR_CONTROLLER },
  { key: "sensitive-disclosure", controlId: "Art. 5(1)(f)", section: GDPR_PRINCIPLES },
  { key: "combined-rag-safety", controlId: "Art. 32(2)", section: GDPR_CONTROLLER },
  { key: "service-availability", controlId: "Art. 32(1)(c)", section: GDPR_CONTROLLER },

  // Tier 2
  { key: "deployment-hardening", controlId: "Art. 32(1)(b).1", section: GDPR_CONTROLLER },
  { key: "credential-hygiene", controlId: "Art. 32(1)(b).2", section: GDPR_CONTROLLER },
  { key: "consumption-ceilings", controlId: "Art. 32(1)(c).1", section: GDPR_CONTROLLER },
  { key: "retention-schedule", controlId: "Art. 5(1)(e)", section: GDPR_PRINCIPLES },
  { key: "corpus-integrity", controlId: "Art. 5(1)(d).1", section: GDPR_PRINCIPLES },
  { key: "tenant-isolation", controlId: "Art. 5(1)(f).1", section: GDPR_PRINCIPLES },
  { key: "output-contract", controlId: "Art. 25(1)", section: GDPR_CONTROLLER },
  { key: "agency-boundary", controlId: "Art. 22(1)", section: GDPR_RIGHTS },
  { key: "model-provenance", controlId: "Art. 30(1)(d)", section: GDPR_CONTROLLER },
  { key: "transport-encryption", controlId: "Art. 32(1)(a)", section: GDPR_CONTROLLER },
  { key: "response-redaction", controlId: "Art. 32(1)(a).1", section: GDPR_CONTROLLER },
  { key: "guardrail-configuration", controlId: "Art. 25(2)", section: GDPR_CONTROLLER },
  { key: "service-levels", controlId: "Art. 32(1)(c).2", section: GDPR_CONTROLLER },
  { key: "breach-alerting", controlId: "Art. 33(1)", section: GDPR_CONTROLLER },
  { key: "objective-coverage", controlId: "Art. 32(1)(d)", section: GDPR_CONTROLLER },
  { key: "trend-visibility", controlId: "Art. 32(1)(d).1", section: GDPR_CONTROLLER },
  { key: "event-forensics", controlId: "Art. 33(5)", section: GDPR_CONTROLLER },
  { key: "request-audit-trail", controlId: "Art. 30(1)", section: GDPR_CONTROLLER },
  { key: "usage-accounting", controlId: "Art. 30(1)(b)", section: GDPR_CONTROLLER },
  { key: "evidence-surface", controlId: "Art. 5(2)", section: GDPR_PRINCIPLES },
  { key: "system-inventory", controlId: "Art. 30(1)(a)", section: GDPR_CONTROLLER },

  // Tier 3
  { key: "management-mandate", controlId: "Art. 24(1)", section: GDPR_CONTROLLER },
  { key: "risk-management-cycle", controlId: "Art. 35(1)", section: GDPR_CONTROLLER },
  { key: "human-oversight-design", controlId: "Art. 22(3)", section: GDPR_RIGHTS },
  { key: "incident-response-readiness", controlId: "Art. 33(1).1", section: GDPR_CONTROLLER },
  { key: "supplier-assurance", controlId: "Art. 28(1)", section: GDPR_CONTROLLER },
  { key: "privacy-notice", controlId: "Art. 13", section: GDPR_RIGHTS },
  { key: "ai-transparency-notice", controlId: "Art. 13(2)(f)", section: GDPR_RIGHTS },
  { key: "system-documentation", controlId: "Art. 30(1).1", section: GDPR_CONTROLLER },
  { key: "change-control", controlId: "Art. 25(1).1", section: GDPR_CONTROLLER },
  { key: "feedback-and-appeal", controlId: "Art. 21", section: GDPR_RIGHTS },
  { key: "workforce-competence", controlId: "Art. 39(1)(b)", section: GDPR_CONTROLLER },
  { key: "evaluation-methodology", controlId: "Art. 35(7)(c)", section: GDPR_CONTROLLER },
  { key: "bias-and-adverse-impact", controlId: "Art. 5(1)(a)", section: GDPR_PRINCIPLES },
  { key: "explainability-evidence", controlId: "Art. 15(1)(h)", section: GDPR_RIGHTS },
  { key: "privacy-testing", controlId: "Art. 25(1).2", section: GDPR_CONTROLLER },
  { key: "threat-model", controlId: "Art. 32(1).1", section: GDPR_CONTROLLER },
  { key: "encryption-configuration", controlId: "Art. 32(1)(a).2", section: GDPR_CONTROLLER },
  { key: "entitlement-review", controlId: "Art. 32(4)", section: GDPR_CONTROLLER },
  { key: "software-supply-chain", controlId: "Art. 28(4)", section: GDPR_CONTROLLER },
  { key: "security-test-gate", controlId: "Art. 32(1)(d).2", section: GDPR_CONTROLLER },
  { key: "corpus-provenance", controlId: "Art. 6(1)", section: GDPR_PRINCIPLES },
  { key: "vector-configuration", controlId: "Art. 5(1)(c)", section: GDPR_PRINCIPLES },
  { key: "model-inventory-record", controlId: "Art. 30(1)(c)", section: GDPR_CONTROLLER },
  { key: "resource-ceiling-record", controlId: "Art. 32(1)(c).3", section: GDPR_CONTROLLER },
  { key: "output-handling-record", controlId: "Art. 5(1)(b)", section: GDPR_PRINCIPLES },
  { key: "tool-permission-record", controlId: "Art. 29", section: GDPR_CONTROLLER },
  { key: "audit-log-evidence", controlId: "Art. 5(2).1", section: GDPR_PRINCIPLES },
  { key: "monitoring-thresholds", controlId: "Art. 32(1)(d).3", section: GDPR_CONTROLLER },
  { key: "records-retention-evidence", controlId: "Art. 17(1)", section: GDPR_RIGHTS },
  { key: "continuity-and-recovery", controlId: "Art. 32(1)(c).4", section: GDPR_CONTROLLER },
];

/* ------------------------------------------------------------------- NIS2 -- */
/* Directive (EU) 2022/2555. Article 21(2) is a closed list of ten measures, so   */
/* the mapping is anchored to those letters rather than to a control catalogue.   */

const NIS2_GOV = "Article 20 Governance";
const NIS2_MEASURES = "Article 21 Cybersecurity risk-management measures";
const NIS2_REPORT = "Article 23 Reporting obligations";

const nis2: MappedControl[] = [
  // Tier 1
  { key: "instruction-boundary", controlId: "21(2)(e).1", section: NIS2_MEASURES },
  { key: "sensitive-disclosure", controlId: "21(2)(i).1", section: NIS2_MEASURES },
  { key: "combined-rag-safety", controlId: "21(2)(e).2", section: NIS2_MEASURES },
  { key: "service-availability", controlId: "21(2)(c).1", section: NIS2_MEASURES },

  // Tier 2
  { key: "deployment-hardening", controlId: "21(2)(e).3", section: NIS2_MEASURES },
  { key: "credential-hygiene", controlId: "21(2)(j).1", section: NIS2_MEASURES },
  { key: "consumption-ceilings", controlId: "21(2)(c).2", section: NIS2_MEASURES },
  { key: "retention-schedule", controlId: "21(2)(i).2", section: NIS2_MEASURES },
  { key: "corpus-integrity", controlId: "21(2)(d).1", section: NIS2_MEASURES },
  { key: "tenant-isolation", controlId: "21(2)(i).3", section: NIS2_MEASURES },
  { key: "output-contract", controlId: "21(2)(e).4", section: NIS2_MEASURES },
  { key: "agency-boundary", controlId: "21(2)(i).4", section: NIS2_MEASURES },
  { key: "model-provenance", controlId: "21(2)(d).2", section: NIS2_MEASURES },
  { key: "transport-encryption", controlId: "21(2)(h).1", section: NIS2_MEASURES },
  { key: "response-redaction", controlId: "21(2)(h).2", section: NIS2_MEASURES },
  { key: "guardrail-configuration", controlId: "21(2)(e).5", section: NIS2_MEASURES },
  { key: "service-levels", controlId: "21(2)(c).3", section: NIS2_MEASURES },
  { key: "breach-alerting", controlId: "23(1)", section: NIS2_REPORT },
  { key: "objective-coverage", controlId: "21(2)(f).1", section: NIS2_MEASURES },
  { key: "trend-visibility", controlId: "21(2)(f).2", section: NIS2_MEASURES },
  { key: "event-forensics", controlId: "23(4)", section: NIS2_REPORT },
  { key: "request-audit-trail", controlId: "21(2)(b).1", section: NIS2_MEASURES },
  { key: "usage-accounting", controlId: "21(2)(a).1", section: NIS2_MEASURES },
  { key: "evidence-surface", controlId: "21(2)(f).3", section: NIS2_MEASURES },
  { key: "system-inventory", controlId: "21(2)(i).5", section: NIS2_MEASURES },

  // Tier 3
  { key: "management-mandate", controlId: "20(1)", section: NIS2_GOV },
  { key: "risk-management-cycle", controlId: "21(2)(a).2", section: NIS2_MEASURES },
  { key: "human-oversight-design", controlId: "20(2)", section: NIS2_GOV },
  { key: "incident-response-readiness", controlId: "21(2)(b).2", section: NIS2_MEASURES },
  { key: "supplier-assurance", controlId: "21(2)(d).3", section: NIS2_MEASURES },
  { key: "system-documentation", controlId: "21(2)(a).3", section: NIS2_MEASURES },
  { key: "change-control", controlId: "21(2)(e).6", section: NIS2_MEASURES },
  { key: "workforce-competence", controlId: "21(2)(g).1", section: NIS2_MEASURES },
  { key: "evaluation-methodology", controlId: "21(2)(f).4", section: NIS2_MEASURES },
  { key: "threat-model", controlId: "21(2)(a).4", section: NIS2_MEASURES },
  { key: "encryption-configuration", controlId: "21(2)(h).3", section: NIS2_MEASURES },
  { key: "entitlement-review", controlId: "21(2)(i).6", section: NIS2_MEASURES },
  { key: "software-supply-chain", controlId: "21(2)(d).4", section: NIS2_MEASURES },
  { key: "security-test-gate", controlId: "21(2)(e).7", section: NIS2_MEASURES },
  { key: "corpus-provenance", controlId: "21(2)(d).5", section: NIS2_MEASURES },
  { key: "vector-configuration", controlId: "21(2)(e).8", section: NIS2_MEASURES },
  { key: "model-inventory-record", controlId: "21(2)(i).7", section: NIS2_MEASURES },
  { key: "resource-ceiling-record", controlId: "21(2)(c).4", section: NIS2_MEASURES },
  { key: "output-handling-record", controlId: "21(2)(e).9", section: NIS2_MEASURES },
  { key: "tool-permission-record", controlId: "21(2)(i).8", section: NIS2_MEASURES },
  { key: "audit-log-evidence", controlId: "21(2)(b).3", section: NIS2_MEASURES },
  { key: "monitoring-thresholds", controlId: "21(2)(f).5", section: NIS2_MEASURES },
  { key: "records-retention-evidence", controlId: "21(2)(i).9", section: NIS2_MEASURES },
  { key: "continuity-and-recovery", controlId: "21(2)(c).5", section: NIS2_MEASURES },
];

/* --------------------------------------------------------------- NERC CIP -- */
/* Reliability standards for the bulk electric system. The AI system is treated   */
/* as a BES Cyber System asset, so the mapping follows CIP-002 through CIP-015.   */

const CIP_002 = "CIP-002 BES Cyber System Categorization";
const CIP_003 = "CIP-003 Security Management Controls";
const CIP_004 = "CIP-004 Personnel and Training";
const CIP_005 = "CIP-005 Electronic Security Perimeters";
const CIP_007 = "CIP-007 System Security Management";
const CIP_008 = "CIP-008 Incident Reporting and Response Planning";
const CIP_009 = "CIP-009 Recovery Plans for BES Cyber Systems";
const CIP_010 = "CIP-010 Configuration Change Management and Vulnerability Assessments";
const CIP_011 = "CIP-011 Information Protection";
const CIP_013 = "CIP-013 Supply Chain Risk Management";
const CIP_015 = "CIP-015 Internal Network Security Monitoring";

const nerc_cip: MappedControl[] = [
  // Tier 1
  { key: "instruction-boundary", controlId: "CIP-007 R1.1", section: CIP_007 },
  { key: "sensitive-disclosure", controlId: "CIP-011 R1.1", section: CIP_011 },
  { key: "combined-rag-safety", controlId: "CIP-007 R1.2", section: CIP_007 },
  { key: "service-availability", controlId: "CIP-009 R1.1", section: CIP_009 },

  // Tier 2
  { key: "deployment-hardening", controlId: "CIP-007 R2.1", section: CIP_007 },
  { key: "credential-hygiene", controlId: "CIP-007 R5.1", section: CIP_007 },
  { key: "consumption-ceilings", controlId: "CIP-009 R1.2", section: CIP_009 },
  { key: "retention-schedule", controlId: "CIP-011 R2.1", section: CIP_011 },
  { key: "corpus-integrity", controlId: "CIP-010 R1.1", section: CIP_010 },
  { key: "tenant-isolation", controlId: "CIP-005 R1.1", section: CIP_005 },
  { key: "output-contract", controlId: "CIP-005 R1.2", section: CIP_005 },
  { key: "agency-boundary", controlId: "CIP-004 R4.1", section: CIP_004 },
  { key: "model-provenance", controlId: "CIP-013 R1.1", section: CIP_013 },
  { key: "transport-encryption", controlId: "CIP-005 R2.1", section: CIP_005 },
  { key: "response-redaction", controlId: "CIP-011 R1.2", section: CIP_011 },
  { key: "guardrail-configuration", controlId: "CIP-007 R1.3", section: CIP_007 },
  { key: "service-levels", controlId: "CIP-009 R1.3", section: CIP_009 },
  { key: "breach-alerting", controlId: "CIP-008 R1.1", section: CIP_008 },
  { key: "objective-coverage", controlId: "CIP-015 R1.1", section: CIP_015 },
  { key: "trend-visibility", controlId: "CIP-015 R1.2", section: CIP_015 },
  { key: "event-forensics", controlId: "CIP-008 R2.1", section: CIP_008 },
  { key: "request-audit-trail", controlId: "CIP-007 R4.1", section: CIP_007 },
  { key: "usage-accounting", controlId: "CIP-007 R4.2", section: CIP_007 },
  { key: "evidence-surface", controlId: "CIP-003 R1.1", section: CIP_003 },
  { key: "system-inventory", controlId: "CIP-002 R1.1", section: CIP_002 },

  // Tier 3
  { key: "management-mandate", controlId: "CIP-003 R1.2", section: CIP_003 },
  { key: "risk-management-cycle", controlId: "CIP-013 R1.2", section: CIP_013 },
  { key: "human-oversight-design", controlId: "CIP-003 R2.1", section: CIP_003 },
  { key: "incident-response-readiness", controlId: "CIP-008 R1.2", section: CIP_008 },
  { key: "supplier-assurance", controlId: "CIP-013 R2.1", section: CIP_013 },
  { key: "system-documentation", controlId: "CIP-002 R1.2", section: CIP_002 },
  { key: "change-control", controlId: "CIP-010 R1.2", section: CIP_010 },
  { key: "workforce-competence", controlId: "CIP-004 R2.1", section: CIP_004 },
  { key: "evaluation-methodology", controlId: "CIP-010 R3.1", section: CIP_010 },
  { key: "privacy-testing", controlId: "CIP-011 R1.3", section: CIP_011 },
  { key: "threat-model", controlId: "CIP-010 R3.2", section: CIP_010 },
  { key: "encryption-configuration", controlId: "CIP-005 R2.2", section: CIP_005 },
  { key: "entitlement-review", controlId: "CIP-004 R4.2", section: CIP_004 },
  { key: "software-supply-chain", controlId: "CIP-013 R1.3", section: CIP_013 },
  { key: "security-test-gate", controlId: "CIP-010 R3.3", section: CIP_010 },
  { key: "corpus-provenance", controlId: "CIP-011 R1.4", section: CIP_011 },
  { key: "vector-configuration", controlId: "CIP-010 R1.3", section: CIP_010 },
  { key: "model-inventory-record", controlId: "CIP-002 R1.3", section: CIP_002 },
  { key: "resource-ceiling-record", controlId: "CIP-009 R1.4", section: CIP_009 },
  { key: "output-handling-record", controlId: "CIP-011 R1.5", section: CIP_011 },
  { key: "tool-permission-record", controlId: "CIP-004 R4.3", section: CIP_004 },
  { key: "audit-log-evidence", controlId: "CIP-007 R4.3", section: CIP_007 },
  { key: "monitoring-thresholds", controlId: "CIP-015 R1.3", section: CIP_015 },
  { key: "records-retention-evidence", controlId: "CIP-011 R2.2", section: CIP_011 },
  { key: "continuity-and-recovery", controlId: "CIP-009 R2.1", section: CIP_009 },
];

/* ---------------------------------------------------------- PCI DSS 4.0.1 -- */
/* Requirement 9 (physical access) has no remote evidence path and is absent      */
/* rather than permanently not_assessed, in line with the library's own policy.   */

const PCI_NETWORK = "Requirement 1 Install and maintain network security controls";
const PCI_CONFIG = "Requirement 2 Apply secure configurations to all system components";
const PCI_STORED = "Requirement 3 Protect stored account data";
const PCI_TRANSIT = "Requirement 4 Protect cardholder data with strong cryptography during transmission";
const PCI_SOFTWARE = "Requirement 6 Develop and maintain secure systems and software";
const PCI_ACCESS = "Requirement 7 Restrict access by business need to know";
const PCI_IDENTITY = "Requirement 8 Identify users and authenticate access";
const PCI_LOGGING = "Requirement 10 Log and monitor all access";
const PCI_TESTING = "Requirement 11 Test security of systems and networks regularly";
const PCI_POLICY = "Requirement 12 Support information security with organizational policies";

const pci_dss: MappedControl[] = [
  // Tier 1
  { key: "instruction-boundary", controlId: "6.2.4", section: PCI_SOFTWARE },
  { key: "sensitive-disclosure", controlId: "3.3.1", section: PCI_STORED },
  { key: "combined-rag-safety", controlId: "6.4.1", section: PCI_SOFTWARE },
  { key: "service-availability", controlId: "12.10.1", section: PCI_POLICY },

  // Tier 2
  { key: "deployment-hardening", controlId: "2.2.1", section: PCI_CONFIG },
  { key: "credential-hygiene", controlId: "8.3.1", section: PCI_IDENTITY },
  { key: "consumption-ceilings", controlId: "1.4.1", section: PCI_NETWORK },
  { key: "retention-schedule", controlId: "3.1.1", section: PCI_STORED },
  { key: "corpus-integrity", controlId: "11.5.2", section: PCI_TESTING },
  { key: "tenant-isolation", controlId: "1.3.1", section: PCI_NETWORK },
  { key: "output-contract", controlId: "6.2.4.1", section: PCI_SOFTWARE },
  { key: "agency-boundary", controlId: "7.2.1", section: PCI_ACCESS },
  { key: "model-provenance", controlId: "6.3.2", section: PCI_SOFTWARE },
  { key: "transport-encryption", controlId: "4.2.1", section: PCI_TRANSIT },
  { key: "response-redaction", controlId: "3.4.1", section: PCI_STORED },
  { key: "guardrail-configuration", controlId: "6.4.2", section: PCI_SOFTWARE },
  { key: "service-levels", controlId: "12.10.5", section: PCI_POLICY },
  { key: "breach-alerting", controlId: "12.10.2", section: PCI_POLICY },
  { key: "objective-coverage", controlId: "10.4.1", section: PCI_LOGGING },
  { key: "trend-visibility", controlId: "10.4.2", section: PCI_LOGGING },
  { key: "event-forensics", controlId: "10.7.2", section: PCI_LOGGING },
  { key: "request-audit-trail", controlId: "10.2.1", section: PCI_LOGGING },
  { key: "usage-accounting", controlId: "10.2.2", section: PCI_LOGGING },
  { key: "evidence-surface", controlId: "12.4.2", section: PCI_POLICY },
  { key: "system-inventory", controlId: "12.5.1", section: PCI_POLICY },

  // Tier 3
  { key: "management-mandate", controlId: "12.1.1", section: PCI_POLICY },
  { key: "risk-management-cycle", controlId: "12.3.1", section: PCI_POLICY },
  { key: "human-oversight-design", controlId: "12.10.3", section: PCI_POLICY },
  { key: "incident-response-readiness", controlId: "12.10.4", section: PCI_POLICY },
  { key: "supplier-assurance", controlId: "12.8.2", section: PCI_POLICY },
  { key: "privacy-notice", controlId: "12.1.4", section: PCI_POLICY },
  { key: "system-documentation", controlId: "12.5.2", section: PCI_POLICY },
  { key: "change-control", controlId: "6.5.1", section: PCI_SOFTWARE },
  { key: "workforce-competence", controlId: "12.6.1", section: PCI_POLICY },
  { key: "evaluation-methodology", controlId: "11.3.1", section: PCI_TESTING },
  { key: "privacy-testing", controlId: "11.3.2", section: PCI_TESTING },
  { key: "threat-model", controlId: "12.3.3", section: PCI_POLICY },
  { key: "encryption-configuration", controlId: "3.6.1", section: PCI_STORED },
  { key: "entitlement-review", controlId: "7.2.4", section: PCI_ACCESS },
  { key: "software-supply-chain", controlId: "6.3.1", section: PCI_SOFTWARE },
  { key: "security-test-gate", controlId: "6.5.2", section: PCI_SOFTWARE },
  { key: "corpus-provenance", controlId: "3.2.1", section: PCI_STORED },
  { key: "vector-configuration", controlId: "2.2.6", section: PCI_CONFIG },
  { key: "model-inventory-record", controlId: "12.5.3", section: PCI_POLICY },
  { key: "resource-ceiling-record", controlId: "1.4.2", section: PCI_NETWORK },
  { key: "output-handling-record", controlId: "3.5.1", section: PCI_STORED },
  { key: "tool-permission-record", controlId: "7.3.1", section: PCI_ACCESS },
  { key: "audit-log-evidence", controlId: "10.3.1", section: PCI_LOGGING },
  { key: "monitoring-thresholds", controlId: "10.4.3", section: PCI_LOGGING },
  { key: "records-retention-evidence", controlId: "10.5.1", section: PCI_LOGGING },
  { key: "continuity-and-recovery", controlId: "12.10.6", section: PCI_POLICY },
];

/* ------------------------------------------------- GxP / 21 CFR Part 11 --- */
/* Validated-system expectations for AI used in a GxP process. Part 11 governs   */
/* electronic records and signatures; Annex 11 and GAMP 5 supply the lifecycle.  */

const PART11_B = "21 CFR Part 11 Subpart B — Controls for closed systems (§11.10)";
const PART11_C = "21 CFR Part 11 Subpart C — Electronic signatures (§11.100–§11.300)";
const ANNEX11 = "EU GMP Annex 11 — Computerised systems";
const GAMP5 = "GAMP 5 Second Edition — computerised system validation";
const FDA_EMA_AI = "FDA/EMA guiding principles for AI in the medicinal product lifecycle";

const gxp_part11: MappedControl[] = [
  // Tier 1
  { key: "answer-grounding", controlId: "§11.10(a)", section: PART11_B },
  { key: "instruction-boundary", controlId: "§11.10(d)", section: PART11_B },
  { key: "sensitive-disclosure", controlId: "§11.10(c)", section: PART11_B },
  { key: "combined-rag-safety", controlId: "AI-2", section: FDA_EMA_AI },
  { key: "service-availability", controlId: "Annex 11 §16", section: ANNEX11 },

  // Tier 2
  { key: "deployment-hardening", controlId: "Annex 11 §12.1", section: ANNEX11 },
  { key: "credential-hygiene", controlId: "§11.300(b)", section: PART11_C },
  { key: "consumption-ceilings", controlId: "Annex 11 §16.1", section: ANNEX11 },
  { key: "retention-schedule", controlId: "§11.10(c).1", section: PART11_B },
  { key: "corpus-integrity", controlId: "Annex 11 §5", section: ANNEX11 },
  { key: "tenant-isolation", controlId: "Annex 11 §12.2", section: ANNEX11 },
  { key: "output-contract", controlId: "§11.10(b)", section: PART11_B },
  { key: "agency-boundary", controlId: "§11.10(g)", section: PART11_B },
  { key: "model-provenance", controlId: "AI-3", section: FDA_EMA_AI },
  { key: "transport-encryption", controlId: "Annex 11 §12.3", section: ANNEX11 },
  { key: "response-redaction", controlId: "Annex 11 §12.4", section: ANNEX11 },
  { key: "guardrail-configuration", controlId: "AI-4", section: FDA_EMA_AI },
  { key: "service-levels", controlId: "Annex 11 §16.2", section: ANNEX11 },
  { key: "breach-alerting", controlId: "Annex 11 §13", section: ANNEX11 },
  { key: "objective-coverage", controlId: "Annex 11 §11", section: ANNEX11 },
  { key: "trend-visibility", controlId: "Annex 11 §11.1", section: ANNEX11 },
  { key: "event-forensics", controlId: "Annex 11 §13.1", section: ANNEX11 },
  { key: "request-audit-trail", controlId: "§11.10(e)", section: PART11_B },
  { key: "usage-accounting", controlId: "Annex 11 §9", section: ANNEX11 },
  { key: "evidence-surface", controlId: "Annex 11 §4.1", section: ANNEX11 },
  { key: "system-inventory", controlId: "Annex 11 §4.3", section: ANNEX11 },

  // Tier 3
  { key: "management-mandate", controlId: "Annex 11 §1", section: ANNEX11 },
  { key: "risk-management-cycle", controlId: "Annex 11 §1.1", section: ANNEX11 },
  { key: "human-oversight-design", controlId: "AI-1", section: FDA_EMA_AI },
  { key: "incident-response-readiness", controlId: "Annex 11 §13.2", section: ANNEX11 },
  { key: "supplier-assurance", controlId: "Annex 11 §3", section: ANNEX11 },
  { key: "privacy-notice", controlId: "Annex 11 §6", section: ANNEX11 },
  { key: "ai-transparency-notice", controlId: "AI-5", section: FDA_EMA_AI },
  { key: "system-documentation", controlId: "Annex 11 §4.4", section: ANNEX11 },
  { key: "change-control", controlId: "Annex 11 §10", section: ANNEX11 },
  { key: "feedback-and-appeal", controlId: "AI-6", section: FDA_EMA_AI },
  { key: "workforce-competence", controlId: "§11.10(i)", section: PART11_B },
  { key: "evaluation-methodology", controlId: "GAMP 5 V-model verification", section: GAMP5 },
  { key: "bias-and-adverse-impact", controlId: "AI-7", section: FDA_EMA_AI },
  { key: "explainability-evidence", controlId: "AI-8", section: FDA_EMA_AI },
  { key: "privacy-testing", controlId: "Annex 11 §6.1", section: ANNEX11 },
  { key: "threat-model", controlId: "GAMP 5 risk-based approach", section: GAMP5 },
  { key: "encryption-configuration", controlId: "Annex 11 §12.5", section: ANNEX11 },
  { key: "entitlement-review", controlId: "§11.10(d).1", section: PART11_B },
  { key: "software-supply-chain", controlId: "GAMP 5 supplier assessment", section: GAMP5 },
  { key: "security-test-gate", controlId: "GAMP 5 verification testing", section: GAMP5 },
  { key: "corpus-provenance", controlId: "Annex 11 §5.1", section: ANNEX11 },
  { key: "vector-configuration", controlId: "GAMP 5 configuration specification", section: GAMP5 },
  { key: "model-inventory-record", controlId: "Annex 11 §4.5", section: ANNEX11 },
  { key: "resource-ceiling-record", controlId: "Annex 11 §16.3", section: ANNEX11 },
  { key: "output-handling-record", controlId: "§11.10(b).1", section: PART11_B },
  { key: "tool-permission-record", controlId: "§11.10(g).1", section: PART11_B },
  { key: "audit-log-evidence", controlId: "Annex 11 §9.1", section: ANNEX11 },
  { key: "monitoring-thresholds", controlId: "Annex 11 §11.2", section: ANNEX11 },
  { key: "records-retention-evidence", controlId: "Annex 11 §17", section: ANNEX11 },
  { key: "continuity-and-recovery", controlId: "Annex 11 §16.4", section: ANNEX11 },
];

/* --------------------------------------------------------------- CMMC 2.0 -- */
/* Level 2 carries the NIST SP 800-171 practices. Physical protection (PE) and    */
/* media protection beyond retention have no remote evidence path and are absent. */

const CMMC_AC = "AC — Access Control";
const CMMC_AT = "AT — Awareness and Training";
const CMMC_AU = "AU — Audit and Accountability";
const CMMC_CM = "CM — Configuration Management";
const CMMC_IA = "IA — Identification and Authentication";
const CMMC_IR = "IR — Incident Response";
const CMMC_RA = "RA — Risk Assessment";
const CMMC_CA = "CA — Security Assessment";
const CMMC_SC = "SC — System and Communications Protection";
const CMMC_SI = "SI — System and Information Integrity";
const CMMC_MP = "MP — Media Protection";

const cmmc: MappedControl[] = [
  // Tier 1
  { key: "instruction-boundary", controlId: "SI.L2-3.14.6", section: CMMC_SI },
  { key: "sensitive-disclosure", controlId: "SC.L2-3.13.16", section: CMMC_SC },
  { key: "combined-rag-safety", controlId: "SI.L2-3.14.7", section: CMMC_SI },
  { key: "service-availability", controlId: "SI.L2-3.14.1", section: CMMC_SI },

  // Tier 2
  { key: "deployment-hardening", controlId: "CM.L2-3.4.2", section: CMMC_CM },
  { key: "credential-hygiene", controlId: "IA.L2-3.5.10", section: CMMC_IA },
  { key: "consumption-ceilings", controlId: "SC.L2-3.13.4", section: CMMC_SC },
  { key: "retention-schedule", controlId: "MP.L2-3.8.9", section: CMMC_MP },
  { key: "corpus-integrity", controlId: "SI.L2-3.14.2", section: CMMC_SI },
  { key: "tenant-isolation", controlId: "SC.L2-3.13.3", section: CMMC_SC },
  { key: "output-contract", controlId: "SC.L2-3.13.2", section: CMMC_SC },
  { key: "agency-boundary", controlId: "AC.L2-3.1.5", section: CMMC_AC },
  { key: "model-provenance", controlId: "CM.L2-3.4.1", section: CMMC_CM },
  { key: "transport-encryption", controlId: "SC.L2-3.13.8", section: CMMC_SC },
  { key: "response-redaction", controlId: "SC.L2-3.13.16.1", section: CMMC_SC },
  { key: "guardrail-configuration", controlId: "SI.L2-3.14.3", section: CMMC_SI },
  { key: "service-levels", controlId: "SI.L2-3.14.1.1", section: CMMC_SI },
  { key: "breach-alerting", controlId: "IR.L2-3.6.2", section: CMMC_IR },
  { key: "objective-coverage", controlId: "AU.L2-3.3.5", section: CMMC_AU },
  { key: "trend-visibility", controlId: "AU.L2-3.3.6", section: CMMC_AU },
  { key: "event-forensics", controlId: "AU.L2-3.3.1", section: CMMC_AU },
  { key: "request-audit-trail", controlId: "AU.L2-3.3.2", section: CMMC_AU },
  { key: "usage-accounting", controlId: "AC.L2-3.1.7", section: CMMC_AC },
  { key: "evidence-surface", controlId: "CA.L2-3.12.3", section: CMMC_CA },
  { key: "system-inventory", controlId: "CM.L2-3.4.1.1", section: CMMC_CM },

  // Tier 3
  { key: "management-mandate", controlId: "CA.L2-3.12.4", section: CMMC_CA },
  { key: "risk-management-cycle", controlId: "RA.L2-3.11.1", section: CMMC_RA },
  { key: "human-oversight-design", controlId: "IR.L2-3.6.1", section: CMMC_IR },
  { key: "incident-response-readiness", controlId: "IR.L2-3.6.3", section: CMMC_IR },
  { key: "supplier-assurance", controlId: "CA.L2-3.12.1", section: CMMC_CA },
  { key: "system-documentation", controlId: "CA.L2-3.12.4.1", section: CMMC_CA },
  { key: "change-control", controlId: "CM.L2-3.4.3", section: CMMC_CM },
  { key: "workforce-competence", controlId: "AT.L2-3.2.1", section: CMMC_AT },
  { key: "evaluation-methodology", controlId: "CA.L2-3.12.2", section: CMMC_CA },
  { key: "privacy-testing", controlId: "RA.L2-3.11.2", section: CMMC_RA },
  { key: "threat-model", controlId: "RA.L2-3.11.1.1", section: CMMC_RA },
  { key: "encryption-configuration", controlId: "SC.L2-3.13.11", section: CMMC_SC },
  { key: "entitlement-review", controlId: "AC.L2-3.1.1", section: CMMC_AC },
  { key: "software-supply-chain", controlId: "RA.L2-3.11.3", section: CMMC_RA },
  { key: "security-test-gate", controlId: "CM.L2-3.4.9", section: CMMC_CM },
  { key: "corpus-provenance", controlId: "MP.L2-3.8.1", section: CMMC_MP },
  { key: "vector-configuration", controlId: "CM.L2-3.4.6", section: CMMC_CM },
  { key: "model-inventory-record", controlId: "CM.L2-3.4.1.2", section: CMMC_CM },
  { key: "resource-ceiling-record", controlId: "SC.L2-3.13.4.1", section: CMMC_SC },
  { key: "output-handling-record", controlId: "SC.L2-3.13.2.1", section: CMMC_SC },
  { key: "tool-permission-record", controlId: "AC.L2-3.1.6", section: CMMC_AC },
  { key: "audit-log-evidence", controlId: "AU.L2-3.3.4", section: CMMC_AU },
  { key: "monitoring-thresholds", controlId: "AU.L2-3.3.3", section: CMMC_AU },
  { key: "records-retention-evidence", controlId: "AU.L2-3.3.8", section: CMMC_AU },
  { key: "continuity-and-recovery", controlId: "MP.L2-3.8.9.1", section: CMMC_MP },
];

/* ------------------------------------------------------------- IEC 62443 -- */
/* Migrated off the generated catalog. The AI system is treated as an IACS       */
/* component, so system requirements come from 62443-3-3 and lifecycle practices */
/* from 62443-4-1, with asset-owner and service-provider programs from 2-1/2-4.  */

const IEC_2_1 = "IEC 62443-2-1 Security program requirements for IACS asset owners";
const IEC_2_4 = "IEC 62443-2-4 Security program requirements for IACS service providers";
const IEC_3_2 = "IEC 62443-3-2 Security risk assessment for system design";
const IEC_3_3 = "IEC 62443-3-3 System security requirements and security levels";
const IEC_4_1 = "IEC 62443-4-1 Secure product development lifecycle requirements";
const IEC_4_2 = "IEC 62443-4-2 Technical security requirements for IACS components";

const iec62443: MappedControl[] = [
  // Tier 1
  { key: "instruction-boundary", controlId: "SR 3.2", section: IEC_3_3 },
  { key: "sensitive-disclosure", controlId: "SR 4.1", section: IEC_3_3 },
  { key: "combined-rag-safety", controlId: "SR 3.1", section: IEC_3_3 },
  { key: "service-availability", controlId: "SR 7.1", section: IEC_3_3 },

  // Tier 2
  { key: "deployment-hardening", controlId: "SR 7.6", section: IEC_3_3 },
  { key: "credential-hygiene", controlId: "SR 1.5", section: IEC_3_3 },
  { key: "consumption-ceilings", controlId: "SR 7.2", section: IEC_3_3 },
  { key: "retention-schedule", controlId: "SR 4.2", section: IEC_3_3 },
  { key: "corpus-integrity", controlId: "SR 3.4", section: IEC_3_3 },
  { key: "tenant-isolation", controlId: "SR 5.1", section: IEC_3_3 },
  { key: "output-contract", controlId: "SR 3.5", section: IEC_3_3 },
  { key: "agency-boundary", controlId: "SR 2.1", section: IEC_3_3 },
  { key: "model-provenance", controlId: "CR 2.4", section: IEC_4_2 },
  { key: "transport-encryption", controlId: "SR 4.3", section: IEC_3_3 },
  { key: "response-redaction", controlId: "SR 4.1.1", section: IEC_3_3 },
  { key: "guardrail-configuration", controlId: "SR 5.2", section: IEC_3_3 },
  { key: "service-levels", controlId: "SR 7.4", section: IEC_3_3 },
  { key: "breach-alerting", controlId: "SR 6.2", section: IEC_3_3 },
  { key: "objective-coverage", controlId: "SR 2.9", section: IEC_3_3 },
  { key: "trend-visibility", controlId: "SR 6.2.1", section: IEC_3_3 },
  { key: "event-forensics", controlId: "SR 2.10", section: IEC_3_3 },
  { key: "request-audit-trail", controlId: "SR 2.8", section: IEC_3_3 },
  { key: "usage-accounting", controlId: "SR 2.11", section: IEC_3_3 },
  { key: "evidence-surface", controlId: "SR 6.1", section: IEC_3_3 },
  { key: "system-inventory", controlId: "SP.01 Asset inventory", section: IEC_2_1 },

  // Tier 3
  { key: "management-mandate", controlId: "SP.02 Security program", section: IEC_2_1 },
  { key: "risk-management-cycle", controlId: "ZCR 2 Risk assessment", section: IEC_3_2 },
  { key: "human-oversight-design", controlId: "SR 2.5", section: IEC_3_3 },
  { key: "incident-response-readiness", controlId: "SP.09 Incident response", section: IEC_2_1 },
  { key: "supplier-assurance", controlId: "SP.11 Supplier management", section: IEC_2_4 },
  { key: "privacy-notice", controlId: "SP.03 Data classification", section: IEC_2_1 },
  { key: "system-documentation", controlId: "SD-1 Secure design", section: IEC_4_1 },
  { key: "change-control", controlId: "SM-9 Change management", section: IEC_4_1 },
  { key: "workforce-competence", controlId: "SM-4 Security expertise", section: IEC_4_1 },
  { key: "evaluation-methodology", controlId: "SVV-1 Security requirements testing", section: IEC_4_1 },
  { key: "threat-model", controlId: "SD-2 Threat model", section: IEC_4_1 },
  { key: "encryption-configuration", controlId: "CR 4.3", section: IEC_4_2 },
  { key: "entitlement-review", controlId: "SR 1.1", section: IEC_3_3 },
  { key: "software-supply-chain", controlId: "SM-10 Third-party components", section: IEC_4_1 },
  { key: "security-test-gate", controlId: "SVV-3 Vulnerability testing", section: IEC_4_1 },
  { key: "corpus-provenance", controlId: "SR 3.4.1", section: IEC_3_3 },
  { key: "vector-configuration", controlId: "CR 7.6", section: IEC_4_2 },
  { key: "model-inventory-record", controlId: "SP.01.1 Component inventory", section: IEC_2_1 },
  { key: "resource-ceiling-record", controlId: "SR 7.2.1", section: IEC_3_3 },
  { key: "output-handling-record", controlId: "SR 3.5.1", section: IEC_3_3 },
  { key: "tool-permission-record", controlId: "SR 2.1.1", section: IEC_3_3 },
  { key: "audit-log-evidence", controlId: "SR 2.8.1", section: IEC_3_3 },
  { key: "monitoring-thresholds", controlId: "SR 6.2.2", section: IEC_3_3 },
  { key: "records-retention-evidence", controlId: "SR 2.12", section: IEC_3_3 },
  { key: "continuity-and-recovery", controlId: "SR 7.3", section: IEC_3_3 },
];

/** Standards whose control set is authored rather than generated. */
export const mappedStandards: Record<string, MappedControl[]> = {
  iso42001,
  soc2,
  mas_ai,
  iso27001,
  gdpr,
  nis2,
  nerc_cip,
  pci_dss,
  gxp_part11,
  cmmc,
  iec62443,
};

export function buildMappedControls(
  standardId: string,
  reference: StandardDefinition["officialReference"],
): Control[] {
  const mapping = mappedStandards[standardId];
  if (!mapping) return [];
  return mapping.map((entry) => {
    const source = controlBodyByKey.get(entry.key);
    if (!source) throw new Error(`Unknown verification library key: ${entry.key}`);
    return {
      ...source,
      id: entry.controlId,
      sourceCitation: {
        authority: reference.authority,
        document: reference.title,
        section: entry.section,
        url: reference.url,
        mappingType: "governai_evidence_mapping" as const,
        note: "ARQ Governance evidence check mapped to this official section; it is not a verbatim official questionnaire or certification control.",
      },
    } satisfies Control;
  });
}

/** Coverage counts, derived from the mapping rather than declared alongside it. */
export function mappedCoverage(standardId: string): Record<1 | 2 | 3, number> {
  const controls = mappedStandards[standardId] ?? [];
  const tiers = controls.map((entry) => verifiableByKey.get(entry.key)?.tierMinimum ?? 3);
  return {
    1: tiers.filter((tier) => tier <= 1).length,
    2: tiers.filter((tier) => tier <= 2).length,
    3: tiers.length,
  };
}
