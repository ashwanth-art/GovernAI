import { verdictLabels } from "./posture";
import { statusLabel } from "./terms";
import type { AssessmentResult, StandardReport } from "./types";

/**
 * The printable report.
 *
 * It carries the same numbers as the screen, including everything that could not
 * be checked. A report that quietly drops the not_assessed controls would read
 * better and mean less, so it keeps them.
 */

function esc(value: unknown) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const STYLE = `
body{font-family:Arial,Helvetica,sans-serif;color:#182421;max-width:1040px;margin:38px auto;line-height:1.55;padding:0 18px}
h1{font-size:29px;margin:0 0 6px}
h2{margin-top:38px;border-bottom:2px solid #176b59;padding-bottom:7px;font-size:20px}
h3{margin-top:26px;font-size:15px}
p{margin:8px 0}
table{width:100%;border-collapse:collapse;font-size:11.5px;margin:10px 0 18px}
th,td{border:1px solid #ccd7d3;padding:7px 8px;text-align:left;vertical-align:top}
th{background:#edf4f1;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
code,.mono{font-family:"SFMono-Regular",Consolas,monospace;font-size:11px}
.lede{color:#4a5a55;font-size:12.5px}
.nums{display:flex;gap:14px;margin:14px 0}
.nums div{flex:1;border:1px solid #ccd7d3;border-radius:8px;padding:11px 13px;background:#f7faf8}
.nums b{display:block;font-size:26px;line-height:1.1}
.nums span{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:#62716d}
.honest{border-left:4px solid #176b59;background:#f2f8f5;padding:11px 14px;font-size:12px;margin:16px 0}
.sev{font-weight:700;text-transform:uppercase;font-size:10px;letter-spacing:.05em}
.sev-critical{color:#b1301b}.sev-high{color:#c25a17}.sev-medium{color:#8a6a12}.sev-low{color:#4a5a55}
.na{color:#62716d}
@media print{body{margin:14mm}h2{break-after:avoid}section{break-inside:auto}}
`;

export function createReportHtml(result: AssessmentResult, report?: StandardReport): string {
  const { analysis } = result;
  const selected = report ? [report] : result.reports;
  const scopeNote = report ? ` — ${esc(report.shortName)} only` : "";

  const controlRows = (controls: StandardReport["controls"]) =>
    controls
      .map(
        (control) =>
          `<tr><td><code>${esc(control.id)}</code><br/>${esc(control.name)}${
            control.sourceCitation ? `<br/><span class="mono">${esc(control.sourceCitation.section)}</span>` : ""
          }</td><td>${esc(statusLabel(control.status))}</td><td>${esc(control.applicabilityStatus)}<br/><span class="lede">${esc(
            control.applicabilityReason,
          )}</span></td><td>${esc(control.evidence)}</td><td>${
            control.status === "pass" ? '<span class="na">—</span>' : esc(control.remediation)
          }</td></tr>`,
      )
      .join("");

  const postureSection = `
  <section>
    <h2>Posture</h2>
    <div class="nums">
      <div><b>${analysis.posture.coveragePercent}%</b><span>coverage — assessed ÷ applicable</span></div>
      <div><b>${analysis.posture.assessed ? `${analysis.posture.healthPercent}%` : "n/a"}</b><span>health — assessed controls only</span></div>
      <div><b>${analysis.posture.exposureIndex}</b><span>exposure index</span></div>
      <div><b>${analysis.provenance.assessed ? `${Math.round((analysis.provenance.direct / analysis.provenance.assessed) * 100)}%` : "n/a"}</b><span>directly tested — rule written for the control</span></div>
    </div>
    <p><strong>Verdict:</strong> ${esc(verdictLabels[analysis.posture.verdict] ?? analysis.posture.verdict)} <code>${esc(analysis.posture.verdict)}</code> — ${esc(analysis.posture.verdictReason)}</p>
    <p><strong>Applicable:</strong> ${analysis.posture.applicable} · <strong>assessed:</strong> ${analysis.posture.assessed} · <strong>not assessed:</strong> ${analysis.posture.notAssessed} · <strong>excluded as not applicable:</strong> ${analysis.posture.notApplicable}</p>
    <div class="honest">
      There is no single compliance score in this report. Coverage is how much of the applicable set could be
      checked at this depth; health is how well the checked part did, computed over assessed controls only; exposure
      is the severity-weighted size of what is open. A control with no evidence is reported
      <code>not_assessed</code> — it is never counted as a pass and never included in the health number.
    </div>
    <div class="honest">
      <strong>How these verdicts were reached.</strong> ${analysis.provenance.direct} of
      ${analysis.provenance.assessed} assessed controls were judged by a rule written for that
      control. ${
        analysis.provenance.proxy
          ? `The remaining ${analysis.provenance.proxy} carry no rule of their own, so a pillar-level probe stood in: those verdicts are evidence about how the pillar behaves, not a direct test of the control text, and each one is labelled in the rule library below.`
          : "No pillar-level proxy rule was used anywhere in this run."
      }
    </div>
    <h3>Areas</h3>
    <table><thead><tr><th>Area</th><th>Question</th><th>Coverage</th><th>Health</th><th>Directly tested</th><th>Rules run</th><th>Problems</th></tr></thead><tbody>
      ${analysis.pillars
        .map(
          (pillar) =>
            `<tr><td><code>${esc(pillar.key)}</code></td><td>${esc(pillar.question)}</td><td>${pillar.coveragePercent}% (${pillar.assessed}/${pillar.applicable})</td><td>${pillar.assessed ? `${pillar.healthPercent}%` : "n/a"}</td><td>${pillar.provenance.assessed ? `${pillar.provenance.direct}/${pillar.provenance.assessed}` : "n/a"}</td><td>${pillar.checksRan}/${pillar.checksTotal}</td><td>${Object.values(pillar.severityCounts).reduce((sum, value) => sum + value, 0)}</td></tr>`,
        )
        .join("")}
    </tbody></table>
  </section>`;

  const findingsSection = analysis.findings.length
    ? `<section><h2>Problems (${analysis.findings.length})</h2>
      <table><thead><tr><th>Id</th><th>Severity</th><th>Problem</th><th>Why it matters</th><th>Blast radius</th><th>Detected by</th><th>Closes when</th></tr></thead><tbody>
      ${analysis.findings
        .map(
          (finding) =>
            `<tr><td><code>${esc(finding.id)}</code></td><td class="sev sev-${esc(finding.severity)}">${esc(finding.severity)}</td><td><strong>${esc(finding.title)}</strong><br/><span class="lede">${esc(finding.detail)}</span></td><td>${esc(finding.impact)}</td><td>${finding.blastRadius.controls} controls · ${finding.blastRadius.standards} frameworks</td><td class="mono">${esc(finding.detectedBy.join(", "))}</td><td>${esc(finding.closesWhen)}</td></tr>`,
        )
        .join("")}
      </tbody></table></section>`
    : `<section><h2>Problems</h2><p>No assessed control failed. Read this together with coverage of ${analysis.posture.coveragePercent}% — ${analysis.posture.notAssessed} applicable controls could not be checked at this depth and are not represented here.</p></section>`;

  const remediationSection = analysis.playbooks.length
    ? `<section><h2>What to fix</h2>
      <p class="lede">Ranked by controls closed per hour of effort. Each fix names the rule that will confirm it: a problem closes when that rule passes on a later run, not when the steps are ticked off.</p>
      ${analysis.playbooks
        .map(
          (playbook, index) => `<h3>${index + 1}. ${esc(playbook.title)}</h3>
        <p><strong>Owner:</strong> ${esc(playbook.owner)} · <strong>Effort:</strong> ${playbook.effortHours[0]}–${playbook.effortHours[1]} h · <strong>Closes:</strong> ${playbook.closesCount} control(s) across ${playbook.standardsCount} framework(s)</p>
        <table><thead><tr><th>#</th><th>Action</th><th>Where</th></tr></thead><tbody>
        ${playbook.steps.map((step) => `<tr><td>${step.order}</td><td>${esc(step.action)}</td><td class="mono">${esc(step.where)}</td></tr>`).join("")}
        </tbody></table>
        <p><strong>Verification:</strong> ${esc(playbook.verification.statement)} <code>${esc(playbook.verification.checkIds.join(", "))}</code></p>`,
        )
        .join("")}
      </section>`
    : "";

  const checksSection = `<section><h2>Rules applied (${analysis.checks.length})</h2>
    <p class="lede">Every rule the engine resolved for this control set, with the condition it applied. ${analysis.checks.filter((check) => check.ran).length} executed; ${analysis.checks.filter((check) => !check.ran).length} could not run at this depth and reported not_assessed.</p>
    <table><thead><tr><th>Rule</th><th>Method</th><th>Provenance</th><th>Status</th><th>Pass condition</th><th>Observed</th><th>Controls</th></tr></thead><tbody>
    ${analysis.checks
      .map(
        (check) =>
          `<tr><td><code>${esc(check.id)}</code><br/>${esc(check.title)}</td><td class="mono">${esc(check.method)}</td><td>${check.provenance === "proxy" ? "<b>pillar proxy</b>" : "direct"}</td><td>${esc(statusLabel(check.status))}</td><td class="mono">${esc(check.rule.passWhen)}</td><td>${esc(check.ran ? check.evidence : `Did not run. ${check.notRunReason} Closed by: ${check.closedBy}`)}</td><td>${check.controls.length}</td></tr>`,
      )
      .join("")}
    </tbody></table></section>`;

  /**
   * The same roll-up the summary screen shows: every unchecked control grouped by the one input
   * that would close its group, largest first. Stated before the per-control table so a reader
   * gets the actionable shape before the itemised list.
   */
  const unlockRows = [
    ...analysis.gaps
      .reduce((groups, gap) => {
        const bucket = groups.get(gap.closedBy) ?? { closedBy: gap.closedBy, controls: 0, tier: gap.tierMinimum, packs: new Set<string>() };
        bucket.controls += 1;
        bucket.tier = Math.max(bucket.tier, gap.tierMinimum);
        bucket.packs.add(gap.shortName);
        return groups.set(gap.closedBy, bucket);
      }, new Map<string, { closedBy: string; controls: number; tier: number; packs: Set<string> }>())
      .values(),
  ].sort((a, b) => b.controls - a.controls);

  const gapsSection = analysis.gaps.length
    ? `<section><h2>Not checked (${analysis.gaps.length})</h2>
      <p class="lede">Applicable controls with no evidence at this depth. Each one is reported not_assessed, with what would close it.</p>
      <h3>What deeper access would close</h3>
      <table><thead><tr><th>Controls</th><th>Needs</th><th>What closes the group</th><th>Frameworks affected</th></tr></thead><tbody>
      ${unlockRows
        .map(
          (row) =>
            `<tr><td><b>+${row.controls}</b></td><td>Tier ${row.tier}</td><td>${esc(row.closedBy)}</td><td>${esc([...row.packs].join(", "))}</td></tr>`,
        )
        .join("")}
      </tbody></table>
      <h3>Every unchecked control</h3>
      <table><thead><tr><th>Framework</th><th>Control</th><th>Needs</th><th>Reason</th><th>Closed by</th></tr></thead><tbody>
      ${analysis.gaps
        .map(
          (gap) =>
            `<tr><td>${esc(gap.shortName)}</td><td><code>${esc(gap.controlId)}</code><br/>${esc(gap.controlName)}</td><td>Tier ${gap.tierMinimum}</td><td>${esc(gap.reason)}</td><td>${esc(gap.closedBy)}</td></tr>`,
        )
        .join("")}
      </tbody></table></section>`
    : "";

  const evidenceSection = `<section><h2>Evidence ledger</h2>
    <p><strong>Executed by:</strong> ${esc(result.liveEvidence.execution.runner)} · <strong>Target:</strong> ${esc(result.liveEvidence.target)} · <strong>Duration:</strong> ${result.liveEvidence.durationMs} ms</p>
    <p><strong>Control source:</strong> ${esc(result.liveEvidence.execution.controlCatalog)}. Official standards or regulator pages were not fetched during this assessment.</p>
    <table><thead><tr><th>Record</th><th>Source</th><th>Request</th><th>Result</th><th>Summary</th><th>Valid</th><th>Digest</th></tr></thead><tbody>
    ${analysis.evidence
      .map(
        (record) =>
          `<tr><td><code>${esc(record.id)}</code><br/>${esc(record.label)}</td><td class="mono">${esc(record.sourceType)}</td><td class="mono">${esc(record.method)} ${esc(record.endpoint)}</td><td>${esc(statusLabel(record.status))}${record.httpStatus ? ` · HTTP ${record.httpStatus}` : ""}${record.latencyMs ? ` · ${record.latencyMs} ms` : ""}</td><td>${esc(record.summary)}</td><td>${record.validityDays} d</td><td class="mono">${esc(record.digest)}</td></tr>`,
      )
      .join("")}
    </tbody></table>
    <div class="honest">A digest is a content hash of the observation recorded here. It detects a changed record; it is not a signature and does not bind the record to the assessed infrastructure. An adapter read is the target system's own declaration.</div>
    </section>`;

  const monitorSection = `<section><h2>Ongoing checks</h2>
    <p class="lede">The re-verification schedule this run implies. Each monitor re-runs the rules listed against the live system on its cadence; arming and disarming happen in the app, and this report states the plan rather than the current armed state at the time you read it.</p>
    <table><thead><tr><th>Monitor</th><th>Area</th><th>Cadence</th><th>Rules</th><th>Requests / month</th><th>What arming costs</th></tr></thead><tbody>
    ${analysis.monitorPlan
      .map(
        (entry) =>
          `<tr><td><code>${esc(entry.id)}</code></td><td>${esc(entry.pillar)}</td><td>${esc(entry.cadence)}</td><td class="mono">${esc(entry.checkIds.join(", "))}</td><td>${entry.requestsPerMonth}</td><td>${esc(entry.armingCost)}</td></tr>`,
      )
      .join("")}
    </tbody></table></section>`;

  const reportsHtml = selected
    .map(
      (item) => `<section>
      <h2>${esc(item.shortName)} — ${esc(item.name)}</h2>
      <p><strong>Version:</strong> ${esc(item.version)} · <strong>Readiness:</strong> ${esc(item.readiness)} · <strong>Health:</strong> ${item.score}% · <strong>Coverage:</strong> ${item.coveragePercent ?? 0}% (${item.assessedControls}/${item.applicableControls ?? 0})</p>
      <p><strong>Native scoring:</strong> ${esc(item.scoringMethod)}<br/><strong>Pass threshold:</strong> ${esc(item.passThreshold)}${item.packRelease ? `<br/><strong>Pack:</strong> ${esc(item.packRelease)}` : ""}</p>
      <p><strong>Official authority:</strong> ${esc(item.officialReference.authority)} — <a href="${esc(item.officialReference.url)}">${esc(item.officialReference.title)}</a><br/><strong>Assessment access:</strong> reference link recorded; the official page was not fetched during this run.</p>
      <h3>Report structure</h3>
      <ol>${item.nativeSections.map((section) => `<li>${esc(section)}</li>`).join("")}</ol>
      <h3>Control evidence</h3>
      <table><thead><tr><th>Control</th><th>Status</th><th>Applies?</th><th>Evidence</th><th>Remediation</th></tr></thead>
      <tbody>${controlRows(item.controls)}</tbody></table>
    </section>`,
    )
    .join("");

  const owaspHtml = report
    ? ""
    : `<section><h2>OWASP LLM security appendix</h2>
      <p class="lede">Bounded live probes mapped to the OWASP Top 10 for LLM Applications 2025. Categories the probes cannot reach remain not assessed.</p>
      <table><thead><tr><th>Control</th><th>Status</th><th>Applies?</th><th>Evidence</th><th>Remediation</th></tr></thead>
      <tbody>${controlRows(result.owasp)}</tbody></table></section>`;

  const notesHtml = `<section><h2>Limits of this assessment</h2><ul>${analysis.notes
    .map((note) => `<li>${esc(note)}</li>`)
    .join("")}</ul></section>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
    <title>${esc(result.scope.systemName)} — governance assessment${scopeNote}</title>
    <style>${STYLE}</style></head><body>
    <h1>GovernAI assessment${scopeNote}</h1>
    <p><strong>${esc(result.scope.organization)}</strong> · ${esc(result.scope.systemName)} · ${esc(result.scope.industry)}<br/>
    Assessment <code>${esc(result.assessmentId)}</code> · Tier ${result.scope.tier} · ${esc(new Date(result.generatedAt).toLocaleString())}<br/>
    Frameworks: ${esc(result.scope.selectedStandards.join(", "))}</p>
    ${postureSection}${findingsSection}${remediationSection}${checksSection}${gapsSection}${reportsHtml}${owaspHtml}${evidenceSection}${monitorSection}${notesHtml}
    <script>window.addEventListener("load",()=>setTimeout(()=>window.print(),250))</script>
    </body></html>`;
}
