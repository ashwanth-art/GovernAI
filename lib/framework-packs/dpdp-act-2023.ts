import { verifiableByKey } from "../verification-library";
import {
  contentHashForControls,
  createPackControl,
  validateFrameworkPack,
  type FrameworkPack,
  type PackControlInput,
} from "./schema";

const source = {
  authority: "Ministry of Electronics and Information Technology, Government of India",
  title: "Digital Personal Data Protection Act, 2023 and Digital Personal Data Protection Rules, 2025",
  url: "https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digital-Personal-Data-Protection-Rules-2025",
  status: "current" as const,
  note: "Official Act and final Rules. Commencement is phased under G.S.R. 843(E) and G.S.R. 846(E), both dated 13 November 2025; this pack reports readiness for provisions that are not yet effective.",
};

const control = (input: PackControlInput) => createPackControl(input, source);

const BASIS = "Act Chapter II — Lawful processing, notice and consent";
const DUTIES = "Act Chapter II — Data Fiduciary obligations";
const CHILDREN = "Act section 9 and Rules 10–12 — Children and guardians";
const SDF = "Act section 10 and Rule 13 — Significant Data Fiduciaries";
const RIGHTS = "Act Chapter III and Rule 14 — Data Principal rights";
const SECURITY = "Rules 6–8 — Security, breaches and erasure";
const TRANSFERS = "Act section 16 and Rule 15 — Transfers outside India";

/**
 * A DPDP obligation judged by an existing evidence-library check. Reusing the
 * rule and procedure means one piece of evidence closes the same privacy or
 * security weakness under DPDP, GDPR, ISO 27001 and every other selected pack.
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
    mappingType: input.mappingType ?? "governai_evidence_mapping",
  });
}

/*
 * The pack asks no applicability questions. Selecting DPDP assesses every
 * listed obligation. Board procedure, penalties and government-only machinery
 * are not controls on an assessed organization and are therefore not listed.
 */
const controls = [
  fromLibrary("privacy-notice", { id: "DPDP-4", name: "Lawful purpose for processing", objective: "Every use of digital personal data by the assessed system is tied to consent or another purpose permitted by the Act and is described in the privacy notice.", category: BASIS, severity: "critical", section: "Act section 4", remediationId: "dpdp-lawful-purpose", remediation: "Inventory each processing purpose, record its permitted ground, and stop processing that has no documented ground." }),
  fromLibrary("privacy-notice", { id: "DPDP-5", name: "Standalone processing notice", objective: "The notice identifies the personal data and processing purposes and explains rights, grievance channels and the route to the Board in clear language.", category: BASIS, severity: "high", section: "Act section 5; Rules 2025 rule 3", remediationId: "dpdp-notice", remediation: "Publish a standalone, plain-language notice listing the personal data, each purpose, withdrawal route, rights route and complaint route." }),
  fromLibrary("privacy-notice", { id: "DPDP-6.1", name: "Valid and limited consent", objective: "Consent is free, specific, informed, unconditional, unambiguous, affirmative and limited to data necessary for the stated purpose.", category: BASIS, severity: "critical", section: "Act section 6(1)–(3)", remediationId: "dpdp-valid-consent", remediation: "Use granular affirmative consent requests and remove bundled, unnecessary or rights-waiving terms." }),
  fromLibrary("retention-schedule", { id: "DPDP-6.4", name: "Consent withdrawal and processing cessation", objective: "Consent can be withdrawn as easily as it was given, and the organization and its processors cease consent-based processing within a reasonable time.", category: BASIS, severity: "critical", section: "Act section 6(4)–(7); Rules 2025 rule 3(c)", remediationId: "dpdp-consent-withdrawal", remediation: "Provide a one-step withdrawal route and propagate withdrawal to every processor and downstream store." }),
  fromLibrary("request-audit-trail", { id: "DPDP-6.10", name: "Proof of notice and consent", objective: "The organization can demonstrate which notice was shown and which valid consent the Data Principal gave for the processing.", category: BASIS, severity: "high", section: "Act section 6(10)", remediationId: "dpdp-consent-evidence", remediation: "Keep tamper-evident, versioned records linking each consent to the notice, purpose, data categories and timestamp." }),
  fromLibrary("system-documentation", { id: "DPDP-7", name: "Certain legitimate uses are bounded", objective: "Processing claimed as a certain legitimate use is documented, limited to the permitted use and stopped when its conditions no longer hold.", category: BASIS, severity: "high", section: "Act section 7", remediationId: "dpdp-legitimate-use", remediation: "Record each legitimate-use case, its statutory basis, data flow, limits and termination condition." }),

  fromLibrary("management-mandate", { id: "DPDP-8.1", name: "Accountability for processing", objective: "A named Data Fiduciary owner remains accountable for compliance even where processing is performed by a Data Processor.", category: DUTIES, severity: "high", section: "Act section 8(1)–(2)", remediationId: "dpdp-accountability", remediation: "Assign a named accountable owner and document responsibility for every internal and processor-operated data flow." }),
  fromLibrary("supplier-assurance", { id: "DPDP-8.3", name: "Processor engagement under valid contract", objective: "Each Data Processor is engaged under a valid contract that covers its processing and required safeguards.", category: DUTIES, severity: "critical", section: "Act section 8(2)–(3); Rules 2025 rule 6(1)(f)", remediationId: "dpdp-processor-contracts", remediation: "Add purpose, instructions, safeguards, breach support, deletion, audit and subprocessor terms to every processor contract." }),
  fromLibrary("answer-grounding", { id: "DPDP-8.4", name: "Accuracy, completeness and consistency", objective: "Personal data used to make a decision or disclosed to another Data Fiduciary is kept complete, accurate and consistent.", category: DUTIES, severity: "high", section: "Act section 8(4)", remediationId: "dpdp-data-accuracy", remediation: "Validate source quality, propagate corrections and block consequential outputs when personal data cannot be verified." }),
  fromLibrary("combined-rag-safety", { id: "DPDP-8.5", name: "Technical and organisational safeguards", objective: "The system uses effective technical and organisational measures to protect personal data throughout processing.", category: DUTIES, severity: "critical", section: "Act section 8(5)", remediationId: "dpdp-effective-safeguards", remediation: "Close grounding, instruction-boundary and disclosure weaknesses and document the organizational controls supporting them." }),
  fromLibrary("breach-alerting", { id: "DPDP-8.6", name: "Personal data breach notification capability", objective: "Personal data breaches trigger prompt notification workflows for affected Data Principals and the Data Protection Board of India.", category: DUTIES, severity: "critical", section: "Act section 8(6); Rules 2025 rule 7", remediationId: "dpdp-breach-notification", remediation: "Configure breach alerts and templates covering immediate Data Principal notice, immediate Board notice and the detailed 72-hour update." }),
  fromLibrary("retention-schedule", { id: "DPDP-8.7", name: "Erasure when purpose and retention end", objective: "Personal data is erased when consent is withdrawn or the specified purpose is no longer served, unless retention is legally required.", category: DUTIES, severity: "high", section: "Act section 8(7)–(8); Rules 2025 rule 8", remediationId: "dpdp-erasure", remediation: "Define purpose-expiry triggers, notify affected users where required, erase expired data and propagate deletion to processors." }),
  fromLibrary("feedback-and-appeal", { id: "DPDP-8.9", name: "Published privacy contact", objective: "The Data Protection Officer or another responsible privacy contact is prominently published and included in responses to rights requests.", category: DUTIES, severity: "medium", section: "Act section 8(9); Rules 2025 rule 9", remediationId: "dpdp-privacy-contact", remediation: "Publish a monitored privacy contact on the website and app and include it in every rights-response template." }),

  fromLibrary("privacy-testing", { id: "DPDP-9.1", name: "Verifiable parental consent", objective: "Before processing a child's personal data, the service verifies parental consent through reliable adult identity or age information.", category: CHILDREN, severity: "critical", section: "Act section 9(1); Rules 2025 rule 10", remediationId: "dpdp-child-consent", remediation: "Implement and test a verifiable parental-consent flow using reliable adult identity or authorized token evidence." }),
  fromLibrary("guardrail-configuration", { id: "DPDP-9.3", name: "No detrimental processing or child tracking", objective: "Controls prevent processing likely to harm a child and prevent tracking, behavioural monitoring and targeted advertising directed at children unless an exemption applies.", category: CHILDREN, severity: "critical", section: "Act section 9(2)–(3); Rules 2025 rule 12 and Fourth Schedule", remediationId: "dpdp-child-protection", remediation: "Disable child profiling, behavioural tracking and targeted advertising and test the controls against child accounts." }),
  fromLibrary("privacy-testing", { id: "DPDPR-11", name: "Lawful-guardian verification", objective: "Consent given for a person with disability who cannot take legally binding decisions is accepted only after the lawful guardian's authority is verified.", category: CHILDREN, severity: "high", section: "Rules 2025 rule 11", remediationId: "dpdp-guardian-verification", remediation: "Verify and record lawful guardianship against the applicable court or designated authority before accepting consent." }),

  fromLibrary("management-mandate", { id: "DPDP-10.2A", name: "India-based Data Protection Officer", objective: "A Significant Data Fiduciary appoints an India-based DPO who reports to its governing body and acts as the Board and grievance contact.", category: SDF, severity: "high", section: "Act section 10(2)(a)", remediationId: "dpdp-dpo", remediation: "Appoint an India-based DPO with board-level accountability, independence and a published contact route." }),
  fromLibrary("privacy-testing", { id: "DPDP-10.2B", name: "Independent data audit", objective: "A Significant Data Fiduciary obtains an independent audit of compliance and retains evidence of findings and treatment.", category: SDF, severity: "high", section: "Act section 10(2)(b); Rules 2025 rule 13(1)–(2)", remediationId: "dpdp-independent-audit", remediation: "Commission an independent annual data audit, report significant observations and track corrective actions to closure." }),
  fromLibrary("risk-management-cycle", { id: "DPDP-10.2C", name: "Annual Data Protection Impact Assessment", objective: "A Significant Data Fiduciary performs a DPIA at least annually and manages risks to Data Principal rights.", category: SDF, severity: "critical", section: "Act section 10(2)(c); Rules 2025 rule 13(1)–(2)", remediationId: "dpdp-dpia", remediation: "Complete an annual DPIA covering purposes, rights, data flows, risks, mitigations and residual-risk acceptance." }),
  fromLibrary("bias-and-adverse-impact", { id: "DPDPR-13.3", name: "Algorithmic measures do not endanger rights", objective: "A Significant Data Fiduciary tests algorithmic software used to process personal data and verifies that it is not likely to pose a risk to Data Principal rights.", category: SDF, severity: "critical", section: "Rules 2025 rule 13(3)", remediationId: "dpdp-algorithmic-risk", remediation: "Test algorithmic processing for privacy, discrimination and other rights impacts and mitigate results before release." }),
  fromLibrary("system-documentation", { id: "DPDPR-13.4", name: "Restricted personal data remains in India", objective: "Specified personal data and related traffic data are identifiable in system data flows and can be prevented from transfer outside India when directed.", category: SDF, severity: "critical", section: "Rules 2025 rule 13(4)", remediationId: "dpdp-localisation-readiness", remediation: "Map hosting and traffic-data flows and implement enforceable India-only storage and transfer controls for designated data." }),

  fromLibrary("evidence-surface", { id: "DPDP-11", name: "Right of access and sharing transparency", objective: "The organization can provide a Data Principal with a summary of processed personal data, processing activities and relevant recipients.", category: RIGHTS, severity: "high", section: "Act section 11; Rules 2025 rule 14", remediationId: "dpdp-access-right", remediation: "Create an authenticated access workflow that compiles the person's data, processing activities and relevant recipients." }),
  fromLibrary("records-retention-evidence", { id: "DPDP-12", name: "Correction, completion, updating and erasure", objective: "The organization can locate and action valid requests to correct, complete, update or erase personal data across processors and stores.", category: RIGHTS, severity: "high", section: "Act section 12; Rules 2025 rule 14", remediationId: "dpdp-correction-erasure", remediation: "Implement a tracked rights workflow that propagates corrections and erasure to every system and processor." }),
  fromLibrary("feedback-and-appeal", { id: "DPDP-13", name: "Grievance redressal within published period", objective: "A prominent grievance mechanism records, routes and resolves Data Principal grievances within the published period of no more than ninety days.", category: RIGHTS, severity: "high", section: "Act section 13; Rules 2025 rule 14(3)", remediationId: "dpdp-grievance", remediation: "Publish the response period, route grievances to a named owner and retain evidence that each grievance was resolved on time." }),
  fromLibrary("feedback-and-appeal", { id: "DPDP-14", name: "Right to nominate", objective: "The service provides a documented route for a Data Principal to nominate another individual to exercise rights after death or incapacity.", category: RIGHTS, severity: "medium", section: "Act section 14; Rules 2025 rule 14(4)", remediationId: "dpdp-nomination", remediation: "Add a nomination workflow with identity, authorization and change records to the rights-management process." }),

  fromLibrary("encryption-configuration", { id: "DPDPR-6A", name: "Encryption, obfuscation, masking or tokenisation", objective: "Personal data is protected with appropriate encryption, obfuscation, masking or tokenisation in storage and system data flows.", category: SECURITY, severity: "critical", section: "Rules 2025 rule 6(1)(a)", remediationId: "dpdp-data-security", remediation: "Encrypt personal data at rest and in transit and apply masking or tokenisation where full values are not needed." }),
  fromLibrary("entitlement-review", { id: "DPDPR-6B", name: "Access to personal-data systems is controlled", objective: "Access to computer resources processing personal data is least-privileged, reviewed and removed when no longer required.", category: SECURITY, severity: "critical", section: "Rules 2025 rule 6(1)(b)", remediationId: "dpdp-access-control", remediation: "Enforce role-based access and complete recurring entitlement reviews across the service, data stores and processors." }),
  fromLibrary("audit-log-evidence", { id: "DPDPR-6C", name: "Personal-data access is logged and reviewed", objective: "Logs and monitoring provide visibility into personal-data access so unauthorized access can be detected, investigated and remediated.", category: SECURITY, severity: "critical", section: "Rules 2025 rule 6(1)(c) and (e)", remediationId: "dpdp-access-logging", remediation: "Capture actor, action, subject, source, time and outcome for personal-data access and retain review evidence for the required period." }),
  fromLibrary("continuity-and-recovery", { id: "DPDPR-6D", name: "Continued processing and recovery", objective: "Backups and tested recovery measures preserve availability and continued processing after loss or compromise of personal data.", category: SECURITY, severity: "high", section: "Rules 2025 rule 6(1)(d)", remediationId: "dpdp-recovery", remediation: "Maintain protected backups and test restoration against stated recovery objectives." }),
  fromLibrary("incident-response-readiness", { id: "DPDPR-7", name: "Breach response and 72-hour Board update", objective: "The incident process captures required breach facts, mitigations, affected-person notices and the detailed Board update due within seventy-two hours.", category: SECURITY, severity: "critical", section: "Rules 2025 rule 7", remediationId: "dpdp-breach-runbook", remediation: "Exercise a DPDP breach runbook with affected-person notices, immediate Board intimation and the detailed 72-hour report." }),
  fromLibrary("records-retention-evidence", { id: "DPDPR-8", name: "Purpose expiry, one-year logs and secure erasure", objective: "Retention records cover purpose-expiry erasure, advance notice where required, the minimum one-year investigative record and erasure after the lawful period.", category: SECURITY, severity: "high", section: "Rules 2025 rule 8 and Third Schedule", remediationId: "dpdp-retention-evidence", remediation: "Document each retention trigger and period, retain mandatory investigative records and evidence secure erasure after expiry." }),

  fromLibrary("system-documentation", { id: "DPDP-16", name: "Cross-border transfer inventory", objective: "Every transfer of personal data outside India, including hosting, model-provider and support access, is documented and linked to applicable government restrictions.", category: TRANSFERS, severity: "high", section: "Act section 16; Rules 2025 rule 15", remediationId: "dpdp-cross-border", remediation: "Maintain a current cross-border data-flow inventory and enforce any general or special government transfer restrictions." }),
  fromLibrary("supplier-assurance", { id: "DPDPR-15", name: "Foreign-state access restrictions", objective: "Provider contracts and transfer controls can enforce requirements governing access by a foreign State or entities under its control.", category: TRANSFERS, severity: "high", section: "Rules 2025 rule 15", remediationId: "dpdp-foreign-access", remediation: "Review provider jurisdiction and government-access exposure and contractually enforce applicable transfer restrictions." }),
];

export const dpdpAct2023Pack: FrameworkPack = validateFrameworkPack({
  manifest: {
    id: "dpdp_act",
    release: "2026.10-draft.1",
    status: "draft",
    assuranceLevel: "readiness",
    sourceVersion: "Digital Personal Data Protection Act, 2023 + final Digital Personal Data Protection Rules, 2025",
    publishedAt: "2026-10-05",
    contentHash: contentHashForControls(controls),
    note: "Readiness pack for organization-facing duties. All listed obligations are automatically assessed without scope questions. Phased commencement and exemptions require legal review before a compliance conclusion.",
  },
  standard: {
    id: "dpdp_act",
    shortName: "DPDP Act",
    name: "Digital Personal Data Protection Act",
    version: "DPDP Act 2023 + Rules 2025",
    kind: "Mandatory",
    jurisdiction: "India",
    description: "India-wide readiness for lawful digital-personal-data processing, consent, rights, security, breach response and accountability.",
    reportFormat: "DPDP Act and Rules Readiness Assessment",
    scoringMethod: "Act and Rules obligation coverage with evidence confidence",
    passThreshold: "No failed applicable mandatory controls; phased commencement and legal applicability require review",
    officialReference: source,
  },
  controls,
});
