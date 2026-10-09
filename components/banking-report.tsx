import { bankingReportRows, hasBankingReport } from "@/lib/banking-report";
import { statusLabel } from "@/lib/terms";
import type { AssessmentResult } from "@/lib/types";

export function BankingReport({ result }: { result: AssessmentResult }) {
  if (!hasBankingReport(result)) return null;
  const rows = bankingReportRows(result);
  const failed = rows.reduce((total, row) => total + row.failed, 0);
  const unseen = rows.reduce((total, row) => total + row.notAssessed, 0);
  return <section className="chapter banking-report" aria-label="Banking governance coverage">
    <h2>Banking governance</h2>
    <p>{failed} failed control outcomes · {unseen} controls without sufficient evidence. Findings and counts below come from the selected standards and the evidence supplied in this run.</p>
    <p>Coverage is the share of listed controls evaluated. It does not establish completeness of banking obligations. Bank type, jurisdiction and the scope stated on each pack determine which standards should be selected.</p>
    <div className="banking-table-wrap"><table className="banking-table"><thead><tr><th>Governance practice</th><th>Listed</th><th>Passed</th><th>Failed</th><th>Partial</th><th>Not assessed</th></tr></thead><tbody>{rows.map(row => <tr key={row.domain}><th>{row.domain}</th><td>{row.total || "Not included"}</td><td>{row.passed}</td><td>{row.failed}</td><td>{row.partial}</td><td>{row.notAssessed}</td></tr>)}</tbody></table></div>
    {rows.map(row => <details key={row.domain} className="banking-domain"><summary>{row.domain} — {row.total ? `${row.failed} failed, ${row.partial} partial, ${row.notAssessed} not assessed` : "no selected control covers this practice"}</summary>
      <p>Evidence sources: {row.systems.join("; ")}. Publish named evidence through the existing Tier 3 evidence-manifest connection.</p>
      {row.items.map(item => <div key={`${item.standardId}:${item.id}`} className="banking-control"><strong>{item.standardName} · {item.id} · {item.name}</strong><p>{statusLabel(item.status)} · {item.severity ?? "medium"} · {item.sourceCitation?.section}</p><p>{item.evidence}</p>{item.status !== "pass" && <p>{item.remediation}</p>}<small>Required evidence: {item.evidenceProcedureIds?.join(", ") || "Live target check"}</small></div>)}
    </details>)}
  </section>;
}
