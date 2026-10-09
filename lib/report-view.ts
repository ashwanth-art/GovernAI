import { buildAnalysis } from "./analysis";
import type { AssessmentResult, StandardReport } from "./types";

/** Presentation scope: completed pass/fail evaluations only. Raw results remain intact. */
export function evaluatedReportView(source: AssessmentResult): AssessmentResult {
  const keep = (control: StandardReport["controls"][number]) => control.status === "pass" || control.status === "fail";
  const reports = source.reports.map(report => {
    const controls = report.controls.filter(keep);
    const passed = controls.filter(control => control.status === "pass").length;
    return { ...report, controls, totalControls: controls.length, applicableControls: controls.length,
      assessedControls: controls.length, notApplicableControls: 0, unknownApplicabilityControls: 0,
      coveragePercent: controls.length ? 100 : 0, score: controls.length ? Math.round(passed / controls.length * 100) : 0,
      readiness: passed === controls.length ? "Controls passed" : "Remediation required",
      summary: `${controls.length} evaluated controls: ${passed} passed, ${controls.length - passed} failed.` };
  }).filter(report => report.controls.length > 0);
  const owasp = source.owasp.filter(keep);
  const analysis = buildAnalysis({ tier: source.scope.tier, reports, owasp,
    liveEvidence: { probes: source.liveEvidence.probes, startedAt: source.liveEvidence.startedAt },
    availableProcedureIds: [...reports.flatMap(report => report.controls), ...owasp].flatMap(control => control.evidenceProcedureIds ?? []),
  });
  return { ...source, scope: { ...source.scope, selectedStandards: reports.map(report => report.shortName) }, reports, owasp, analysis };
}
