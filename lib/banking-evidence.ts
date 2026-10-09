/** Read-only measurements exported by a bank's control owners or existing tools.
 * A declared pass cannot override a failed measurement. No transactions are sent.
 */
export interface BankingEvidenceRule {
  key: string;
  domain: string;
  name: string;
  system: string;
  fields: Record<string, "true" | "zero" | "positive">;
}

export const bankingEvidenceRules: BankingEvidenceRule[] = [
  { key: "board-oversight", domain: "Board and assurance", name: "Board oversight and approved IT strategy", system: "GRC / board records", fields: { strategyApproved: "true", accountableOwnerAssigned: "true", overdueBoardReviews: "zero" } },
  { key: "risk-appetite", domain: "Board and assurance", name: "Risk appetite and independent challenge", system: "GRC / risk register", fields: { riskAppetiteApproved: "true", independentChallengeRecorded: "true", overdueRiskActions: "zero" } },
  { key: "independent-audit", domain: "Board and assurance", name: "Independent assurance and issue closure", system: "Audit / GRC", fields: { independentAuditCompleted: "true", overdueCriticalFindings: "zero" } },
  { key: "asset-inventory", domain: "Cybersecurity and access", name: "Complete asset inventory and ownership", system: "CMDB", fields: { assetsInventoried: "positive", unownedAssets: "zero", untrackedCriticalAssets: "zero" } },
  { key: "privileged-access", domain: "Cybersecurity and access", name: "Privileged access, MFA and segregation of duties", system: "IAM / PAM", fields: { privilegedMfaEnforced: "true", overdueAccessReviews: "zero", segregationConflicts: "zero", orphanedPrivilegedAccounts: "zero" } },
  { key: "patch-vulnerability", domain: "Cybersecurity and access", name: "Vulnerability remediation and patch compliance", system: "Vulnerability / patch platform", fields: { scanCompleted: "true", overdueCriticalVulnerabilities: "zero", overdueCriticalPatches: "zero" } },
  { key: "secure-development", domain: "Cybersecurity and access", name: "Secure development and penetration testing", system: "CI / security testing", fields: { securityGateRequired: "true", penetrationTestCompleted: "true", unresolvedCriticalTestFindings: "zero" } },
  { key: "network-protection", domain: "Cybersecurity and access", name: "Network segmentation and WAF/DDoS protection", system: "Network / cloud security", fields: { segmentationTestPassed: "true", wafEnabled: "true", ddosProtectionEnabled: "true" } },
  { key: "physical-security", domain: "Cybersecurity and access", name: "Restricted physical access to critical systems", system: "Physical access / facilities", fields: { restrictedAccessEnforced: "true", accessReviewCompleted: "true", unresolvedPhysicalAccessExceptions: "zero" } },
  { key: "security-logging", domain: "Cybersecurity and access", name: "Security logging, alert review and response", system: "SIEM / SOC", fields: { criticalAssetsLogging: "true", alertResponseTestPassed: "true", overdueCriticalAlerts: "zero" } },
  { key: "vendor-diligence", domain: "Outsourcing and cloud", name: "Vendor due diligence and materiality assessment", system: "Vendor registry / GRC", fields: { materialityAssessed: "true", diligenceCurrent: "true", unassessedCriticalVendors: "zero" } },
  { key: "vendor-contracts", domain: "Outsourcing and cloud", name: "Outsourcing contracts and regulator audit rights", system: "Contract repository", fields: { auditRightsIncluded: "true", regulatorAccessIncluded: "true", subprocessorControlsIncluded: "true", breachTermsIncluded: "true" } },
  { key: "vendor-concentration", domain: "Outsourcing and cloud", name: "Provider concentration and dependency risk", system: "Vendor registry / architecture", fields: { concentrationAssessmentCurrent: "true", dependencyMapComplete: "true", unmitigatedConcentrationBreaches: "zero" } },
  { key: "vendor-exit", domain: "Outsourcing and cloud", name: "Tested provider exit and data portability", system: "Vendor / continuity records", fields: { exitPlanApproved: "true", exitTestPassed: "true", dataDeletionVerified: "true" } },
  { key: "cross-border", domain: "Privacy and customer protection", name: "Cross-border data flow and lawful processing", system: "Data inventory / privacy office", fields: { transferInventoryComplete: "true", permittedGroundsRecorded: "true", prohibitedTransfers: "zero" } },
  { key: "customer-redress", domain: "Privacy and customer protection", name: "Customer explanation, appeal and grievance handling", system: "Complaints / case management", fields: { explanationRouteAvailable: "true", humanAppealAvailable: "true", overdueComplaints: "zero" } },
  { key: "privacy-rights", domain: "Privacy and customer protection", name: "Consent, rights and retention execution", system: "Consent / rights platform", fields: { consentControlsTested: "true", rightsWorkflowTested: "true", overdueRightsRequests: "zero", overdueErasureItems: "zero" } },
  { key: "model-inventory", domain: "AI and model risk", name: "Model inventory, materiality and ownership", system: "Model registry", fields: { inventoryComplete: "true", materialityAssigned: "true", unownedModels: "zero" } },
  { key: "model-validation", domain: "AI and model risk", name: "Independent model validation and effective challenge", system: "Model validation registry", fields: { independentValidationCurrent: "true", conceptualSoundnessReviewed: "true", outcomeAnalysisCompleted: "true", unresolvedMaterialValidationFindings: "zero" } },
  { key: "model-drift", domain: "AI and model risk", name: "Performance drift, backtesting and overrides", system: "Model monitoring", fields: { driftMonitoringEnabled: "true", backtestingCompleted: "true", overridesReviewed: "true", unresolvedMaterialDrift: "zero" } },
  { key: "ai-fairness", domain: "AI and model risk", name: "Fairness, explainability and human oversight", system: "AI evaluation / model governance", fields: { adverseImpactTestingCompleted: "true", explanationsValidated: "true", humanOverrideTested: "true", unresolvedMaterialBias: "zero" } },
  { key: "ai-safety", domain: "AI and model risk", name: "AI safety, misuse testing and deployment approval", system: "AI evaluation / CI", fields: { misuseTestingCompleted: "true", deploymentApproved: "true", unresolvedCriticalSafetyFindings: "zero" } },
  { key: "data-lineage", domain: "Risk data and reporting", name: "Risk-data lineage and reconciliation", system: "Data catalogue / reconciliation", fields: { lineageComplete: "true", sourceReconciliationPassed: "true", unresolvedMaterialReconciliationBreaks: "zero" } },
  { key: "data-quality", domain: "Risk data and reporting", name: "Accurate and complete risk-data aggregation", system: "Data quality platform", fields: { accuracyChecksPassed: "true", completenessChecksPassed: "true", materialDataQualityBreaches: "zero" } },
  { key: "data-timeliness", domain: "Risk data and reporting", name: "Timely, adaptable reporting under stress", system: "Risk reporting / stress exercises", fields: { reportingWithinApprovedSla: "true", stressAggregationTestPassed: "true", adHocReportingTestPassed: "true" } },
  { key: "report-distribution", domain: "Risk data and reporting", name: "Clear risk reports and authorized distribution", system: "Risk reporting / access logs", fields: { reportReviewCompleted: "true", materialRiskCoverageComplete: "true", unauthorizedRecipients: "zero" } },
  { key: "regulatory-reporting", domain: "Risk data and reporting", name: "Regulatory submissions and record integrity", system: "Regulatory reporting", fields: { reconciliationCompleted: "true", overdueSubmissions: "zero", unresolvedMaterialReportingErrors: "zero" } },
  { key: "critical-operations", domain: "Resilience and recovery", name: "Critical operations, impact tolerances and dependencies", system: "Business continuity / service map", fields: { criticalOperationsMapped: "true", impactTolerancesApproved: "true", dependencyMapComplete: "true" } },
  { key: "recovery-testing", domain: "Resilience and recovery", name: "Disaster recovery and severe scenario exercises", system: "BCP / DR platform", fields: { severeScenarioTestCompleted: "true", recoveryWithinApprovedRto: "true", recoveryWithinApprovedRpo: "true", unresolvedMaterialRecoveryFindings: "zero" } },
  { key: "incident-response", domain: "Resilience and recovery", name: "Incident command, notification and lessons learned", system: "Incident / SOC records", fields: { responseExerciseCompleted: "true", notificationDeadlinesMet: "true", overdueIncidentActions: "zero" } },
  { key: "payment-authentication", domain: "Payments and SWIFT", name: "Payment authentication and transaction authorization", system: "Payment / IAM platform", fields: { strongAuthenticationEnforced: "true", authorizationTestPassed: "true", unauthorizedTransactions: "zero" } },
  { key: "payment-fraud", domain: "Payments and SWIFT", name: "Payment fraud detection and alert investigation", system: "Fraud monitoring", fields: { fraudScenariosTested: "true", alertInvestigationCurrent: "true", overdueHighRiskFraudAlerts: "zero" } },
  { key: "payment-data", domain: "Payments and SWIFT", name: "Payment-data protection and secure channels", system: "Payment / DLP / key management", fields: { paymentDataEncrypted: "true", keyManagementReviewPassed: "true", channelSecurityTestPassed: "true" } },
  { key: "data-protection", domain: "Cybersecurity and access", name: "Data encryption and key management", system: "DLP / key management", fields: { sensitiveDataEncrypted: "true", keyManagementReviewPassed: "true", channelSecurityTestPassed: "true" } },
  { key: "swift-isolation", domain: "Payments and SWIFT", name: "SWIFT environment isolation and internet restrictions", system: "SWIFT / network security", fields: { swiftEnvironmentIsolated: "true", internetRestrictionsVerified: "true", privilegedAccessReviewed: "true" } },
  { key: "swift-integrity", domain: "Payments and SWIFT", name: "SWIFT transaction integrity and anomaly detection", system: "SWIFT / transaction monitoring", fields: { transactionIntegrityTestPassed: "true", anomalyDetectionTestPassed: "true", unresolvedCriticalSwiftAlerts: "zero" } },
  { key: "swift-attestation", domain: "Payments and SWIFT", name: "SWIFT independent assessment and attestation", system: "SWIFT CSP / assessment records", fields: { independentAssessmentCurrent: "true", attestationSubmitted: "true", overdueMandatoryControlGaps: "zero" } },
  { key: "customer-diligence", domain: "AML, KYC and sanctions", name: "Customer identification and beneficial ownership", system: "KYC platform", fields: { customerIdentificationVerified: "true", beneficialOwnershipVerified: "true", overdueKycReviews: "zero" } },
  { key: "pep-sanctions", domain: "AML, KYC and sanctions", name: "PEP, sanctions and high-risk customer screening", system: "Sanctions / PEP screening", fields: { screeningListsCurrent: "true", screeningScenariosTested: "true", enhancedDiligenceCompleted: "true", unresolvedHighRiskMatches: "zero" } },
  { key: "aml-monitoring", domain: "AML, KYC and sanctions", name: "Transaction-monitoring scenarios and investigation", system: "AML transaction monitoring", fields: { monitoringCoverageValidated: "true", scenariosBacktested: "true", overdueHighRiskAmlAlerts: "zero" } },
  { key: "aml-reporting", domain: "AML, KYC and sanctions", name: "Suspicious-transaction escalation and records", system: "AML case management / FIU reporting", fields: { reportingWorkflowTested: "true", recordRetentionVerified: "true", overdueRequiredReports: "zero" } },
  { key: "prudential-risk", domain: "Prudential and credit risk", name: "Capital, liquidity and material risk escalation", system: "Treasury / enterprise risk", fields: { capitalAdequacyReviewed: "true", liquidityLimitsMonitored: "true", stressTestingCompleted: "true", unreportedMaterialLimitBreaches: "zero" } },
  { key: "credit-decisions", domain: "Prudential and credit risk", name: "Credit decision validation and adverse-action review", system: "Credit model / lending platform", fields: { decisionValidationCurrent: "true", adverseDecisionReasonsReviewed: "true", exceptionsReviewed: "true", unresolvedMaterialCreditModelFindings: "zero" } },
];

export const bankingRuleByProcedure = new Map(bankingEvidenceRules.map(rule => [`artifact-bank-${rule.key}`, rule]));

export function judgeBankingMeasurements(procedureId: string, value: unknown) {
  const rule = bankingRuleByProcedure.get(procedureId);
  if (!rule) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return { status: "not_assessed" as const, summary: `${rule.name}: structured measurements are required from ${rule.system}.` };
  const measurements = value as Record<string, unknown>;
  const failed: string[] = [];
  const missing: string[] = [];
  for (const [key, condition] of Object.entries(rule.fields)) {
    const actual = measurements[key];
    if (condition === "true" ? typeof actual !== "boolean" : typeof actual !== "number" || !Number.isFinite(actual) || actual < 0) missing.push(key);
    else if (condition === "true" ? actual !== true : condition === "zero" ? actual !== 0 : Number(actual) <= 0) failed.push(`${key}=${String(actual)}`);
  }
  const status = failed.length ? "fail" : missing.length ? "not_assessed" : "pass";
  return {
    status: status as "pass" | "fail" | "not_assessed",
    summary: `${rule.name}: ${failed.length ? `failed checks: ${failed.join(", ")}.` : missing.length ? "Measurements incomplete." : "All required measurements met their checks."}${missing.length ? ` Missing or invalid: ${missing.join(", ")}.` : ""} Source system: ${rule.system}.`,
  };
}
