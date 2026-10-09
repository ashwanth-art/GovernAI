import { bankingEvidenceRules } from "./banking-evidence";
import type { AssessmentResult } from "./types";

const domains = [...new Set(bankingEvidenceRules.map(rule => rule.domain))];
const existingDomains: Record<string, string> = {
  "adapter.credential-hygiene": "Cybersecurity and access", "adapter.deployment-posture": "Cybersecurity and access",
  "probe.injection": "AI and model risk", "probe.grounding": "AI and model risk", "probe.combined-rag-safety": "AI and model risk", "probe.disclosure": "Privacy and customer protection",
};

/** Counts are recomputed from real control outcomes, never from pack presence. */
export function bankingReportRows(result: AssessmentResult, standardId?: string) {
  const controls = result.reports.filter(report => !standardId || report.standardId === standardId).flatMap(report => report.controls.map(control => ({ ...control, standardId: report.standardId, standardName: report.shortName })));
  return domains.map(domain => {
    const items = controls.filter(control => {
      const mapped = domains.includes(control.category) ? control.category
        : existingDomains[control.evaluationRuleId ?? ""]
        ?? (control.standardId === "dpdp_act" || control.standardId === "gdpr" ? "Privacy and customer protection"
          : control.standardId === "pci_dss" ? "Payments and SWIFT"
          : ["iso42001", "nist_ai_rmf", "mas_ai"].includes(control.standardId) ? "AI and model risk"
          : control.standardId === "iso27001" || control.standardId === "soc2" ? "Cybersecurity and access" : undefined);
      return mapped === domain;
    });
    const count = (status: string) => items.filter(control => control.status === status).length;
    return { domain, items, total: items.length, passed: count("pass"), failed: count("fail"), partial: count("partial"), notAssessed: count("not_assessed"), systems: [...new Set(bankingEvidenceRules.filter(rule => rule.domain === domain).map(rule => rule.system))] };
  });
}

export function hasBankingReport(result: AssessmentResult) {
  return /bank|finance/i.test(result.scope.industry) || result.reports.some(report => report.controls.some(control => control.evaluationRuleId?.startsWith("artifact.bank-")));
}
