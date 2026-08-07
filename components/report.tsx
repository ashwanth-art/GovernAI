"use client";

import { useEffect, useMemo, useRef } from "react";
import { Disc, Kv, Meter, Pill, Sev, SevRow, Tag } from "@/components/kit";
import { duration, measuredPercent, rulePhrase } from "@/lib/metrics";
import { pillarHue, pillarLabel } from "@/lib/pillars";
import { verdictLabels } from "@/lib/posture";
import { methodLabel, methodPlain, statusMeaning, tierLabel } from "@/lib/terms";
import type { AssessmentResult, Severity } from "@/lib/types";

/* ============================================================================
   The result
   ----------------------------------------------------------------------------
   One scroll that answers six questions in the order a reader asks them, in
   place of the eight nav destinations this replaced. The order is the argument:
   where you stand, what is broken, what to do about it, area by area, what we
   could not see, and then the full trace for anyone who wants to check the work.

   Nothing here computes a verdict. Every number is read from `result.analysis`,
   which is itself derived from statuses the engine already produced.
   ========================================================================== */

export const CHAPTERS = [
  { id: "verdict", n: "I", label: "Where you stand" },
  { id: "broken", n: "II", label: "What is broken" },
  { id: "fix", n: "III", label: "What to fix first" },
  { id: "areas", n: "IV", label: "Area by area" },
  { id: "unseen", n: "V", label: "What we could not see" },
  { id: "trace", n: "VI", label: "The full trace" },
] as const;

const SEV_ORDER: Severity[] = ["critical", "high", "medium", "low"];

export function Report({
  result,
  onActiveChapter,
  onPrint,
  onExport,
  onRerun,
}: {
  result: AssessmentResult;
  onActiveChapter: (id: string) => void;
  onPrint: () => void;
  onExport: () => void;
  onRerun: () => void;
}) {
  const { analysis, scope, liveEvidence } = result;
  const { posture } = analysis;
  const hostRef = useRef<HTMLDivElement>(null);

  /* Scroll-spy, so the rail at the top of the app doubles as this report's
     contents without the report needing a nav of its own. */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) onActiveChapter(visible.target.id);
      },
      { root: host.closest(".stage"), rootMargin: "-15% 0px -70% 0px", threshold: 0 },
    );
    for (const chapter of CHAPTERS) {
      const node = host.querySelector(`#${chapter.id}`);
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, [onActiveChapter]);

  const bySeverity = useMemo(
    () =>
      [...analysis.findings].sort(
        (a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity),
      ),
    [analysis.findings],
  );

  const ranChecks = useMemo(() => analysis.checks.filter((check) => check.ran), [analysis.checks]);
  const blockedByReason = useMemo(() => {
    const groups = new Map<string, { count: number; closedBy: string }>();
    for (const check of analysis.checks) {
      if (check.ran) continue;
      const existing = groups.get(check.notRunReason);
      groups.set(check.notRunReason, {
        count: (existing?.count ?? 0) + 1,
        closedBy: existing?.closedBy ?? check.closedBy,
      });
    }
    return [...groups.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [analysis.checks]);

  const verdictTone =
    posture.openFindings === 0 && posture.assessed > 0
      ? "pass"
      : posture.severityCounts.critical > 0 || posture.severityCounts.high > 0
        ? "fail"
        : "partial";

  return (
    <div className="report" ref={hostRef}>
      <div className="report-col">
        {/* ---- I · where you stand ------------------------------------- */}
        <section className="chapter" id="verdict">
          <div className="ch-n">
            <em>Chapter I</em>
            <hr />
          </div>
          <h2>Where you stand</h2>
          <p className="lede">
            {scope.systemName} against {scope.selectedStandards.length}{" "}
            {scope.selectedStandards.length === 1 ? "pack" : "packs"}, at {tierLabel(scope.tier)}.
            Two numbers carry the whole result and they answer different questions — how much we
            could check, and how much of that passed.
          </p>

          <div className="hero">
            <div className="hero-num">
              {posture.assessed}
              <span style={{ color: "var(--faint)" }}>/{posture.applicable}</span>
              <small>
                controls we could reach a verdict on, out of the <b>{posture.applicable}</b> that
                apply to you.{" "}
                {posture.notApplicable > 0 ? (
                  <>
                    A further <b>{posture.notApplicable}</b> were ruled out before the run, each
                    with a stated reason.
                  </>
                ) : null}
              </small>
            </div>

            <div className="stats">
              <div className={`stat ${verdictTone}`}>
                <em>Health</em>
                <strong>{measuredPercent(posture.healthPercent, posture.assessed > 0)}</strong>
                <p>
                  {posture.assessed > 0
                    ? `averaged over the ${posture.assessed} assessed, not the ${posture.applicable} applicable`
                    : "no verdicts yet — nothing here could be assessed"}
                </p>
              </div>
              <div className="stat">
                <em>Coverage</em>
                <strong>{posture.coveragePercent}%</strong>
                <p>assessed ÷ applicable</p>
              </div>
              <div className={`stat ${posture.openFindings > 0 ? "fail" : "pass"}`}>
                <em>Open findings</em>
                <strong>{posture.openFindings}</strong>
                <p>raised by a rule, never inferred</p>
              </div>
              <div className="stat">
                <em>Exposure index</em>
                <strong>{posture.exposureIndex}</strong>
                <p>severity-weighted, across open findings</p>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 20, padding: "18px 20px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 17, fontWeight: 660, letterSpacing: "-.02em" }}>
                {verdictLabels[posture.verdict] ?? posture.verdict}
              </strong>
              <span className="tag-s">
                <b>{posture.verdict}</b>
              </span>
            </div>
            <p style={{ marginTop: 7, fontSize: 14.5, color: "var(--muted)", lineHeight: 1.6 }}>
              {posture.verdictReason}
            </p>
          </div>

          <div className="because flat" style={{ marginTop: 14 }}>
            <i>◆</i>
            <span>
              Of the {analysis.provenance.assessed} verdicts reached,{" "}
              <b>{analysis.provenance.direct}</b> came from a rule written against the control it
              judges and <b>{analysis.provenance.proxy}</b> from an area-level proxy standing in
              where no direct rule exists. Coverage says how much was tested; this says whether the
              thing that tested it was written for the job.
            </span>
          </div>

          {analysis.matrix.length ? (
            <div className="tbl-wrap" style={{ marginTop: 22 }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Pack</th>
                    <th>Readiness</th>
                    <th className="num">Applicable</th>
                    <th className="num">Assessed</th>
                    <th className="num">Coverage</th>
                    <th className="num">Health</th>
                    <th className="num">Excluded</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.matrix.map((row) => (
                    <tr key={row.standardId}>
                      <td style={{ fontWeight: 620 }}>{row.shortName}</td>
                      <td>{row.readiness}</td>
                      <td className="num">{row.applicable}</td>
                      <td className="num">{row.assessed}</td>
                      <td className="num">{row.coveragePercent}%</td>
                      <td className="num">{measuredPercent(row.healthPercent, row.assessed > 0)}</td>
                      <td className="num">{row.excluded}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        {/* ---- II · what is broken ------------------------------------- */}
        <section className="chapter" id="broken">
          <div className="ch-n">
            <em>Chapter II</em>
            <hr />
          </div>
          <h2>
            {posture.openFindings === 0
              ? "Nothing we could test came back broken"
              : `${posture.openFindings} ${posture.openFindings === 1 ? "thing is" : "things are"} broken`}
          </h2>
          <p className="lede">
            {posture.openFindings === 0 ? (
              <>
                Every rule that ran reached a pass. That is a statement about the{" "}
                {posture.assessed} controls we could assess and about nothing else — read chapter V
                for what stayed out of reach.
              </>
            ) : (
              <>
                Each one was raised by a rule whose pass condition was not met. Open a finding to
                see the rule, the evidence behind it, and every control it breaks.
              </>
            )}
          </p>

          {bySeverity.length ? (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  marginBottom: 16,
                  flexWrap: "wrap",
                }}
              >
                {SEV_ORDER.filter((sev) => (posture.severityCounts[sev] ?? 0) > 0).map((sev) => (
                  <span
                    key={sev}
                    style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13.5 }}
                  >
                    <Sev severity={sev} />
                    <b style={{ fontWeight: 650 }}>{posture.severityCounts[sev]}</b>
                    <span className="muted">{sev}</span>
                  </span>
                ))}
              </div>
              <div className="cards">
                {bySeverity.map((finding) => (
                  <Disc
                    key={finding.id}
                    glyph={<Sev severity={finding.severity} />}
                    title={finding.title}
                    sub={finding.impact}
                    right={`${finding.blastRadius.controls} controls · ${finding.blastRadius.standards} packs`}
                  >
                    <p style={{ fontSize: 14, lineHeight: 1.6 }}>{finding.detail}</p>
                    <Kv
                      items={[
                        { k: "Severity", v: finding.severity },
                        { k: "Area", v: pillarLabel(finding.pillar) },
                        { k: "Owner", v: finding.owner },
                        { k: "Raised by", v: finding.detectedBy.join(", "), mono: true },
                      ]}
                    />
                    {finding.breaches.length ? (
                      <div>
                        <em
                          style={{
                            display: "block",
                            fontStyle: "normal",
                            fontSize: 10.5,
                            fontWeight: 700,
                            letterSpacing: ".09em",
                            textTransform: "uppercase",
                            color: "var(--faint)",
                            marginBottom: 7,
                          }}
                        >
                          Controls this breaks
                        </em>
                        <div className="tags">
                          {finding.breaches.map((breach) => (
                            <Tag
                              key={`${breach.standardId}-${breach.controlId}`}
                              pack={breach.shortName}
                              id={breach.controlId}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <p className="quote">
                      <b>Closes when:</b> {finding.closesWhen}
                    </p>
                  </Disc>
                ))}
              </div>
            </>
          ) : (
            <div className="card" style={{ padding: "18px 20px" }}>
              <p style={{ fontSize: 14.5, color: "var(--muted)", lineHeight: 1.6 }}>
                No finding was raised. A finding requires a rule to have run and failed, so an
                empty list here means every rule that ran passed — not that nothing could go wrong.
              </p>
            </div>
          )}
        </section>

        {/* ---- III · what to fix first --------------------------------- */}
        <section className="chapter" id="fix">
          <div className="ch-n">
            <em>Chapter III</em>
            <hr />
          </div>
          <h2>What to fix first</h2>
          <p className="lede">
            {analysis.playbooks.length
              ? "Ranked by how many controls each one closes, across every pack you selected — so the first item is the one that buys the most. Each playbook names the rule that will confirm the fix."
              : "There is nothing to fix from this run. Playbooks are generated from open findings, so an empty list here follows from an empty finding list."}
          </p>

          {analysis.playbooks.length ? (
            <div className="cards">
              {analysis.playbooks.map((play, index) => (
                <Disc
                  key={play.id}
                  glyph={<Sev severity={play.severity} />}
                  title={`${index + 1}. ${play.title}`}
                  sub={`${play.owner} · ${play.effortHours[0]}–${play.effortHours[1]} hours`}
                  right={`closes ${play.closesCount} in ${play.standardsCount} packs`}
                  open={index === 0}
                >
                  <ol className="plan-steps">
                    {play.steps.map((step) => (
                      <li key={step.order}>
                        <span>
                          {step.action}
                          <small>{step.where}</small>
                        </span>
                      </li>
                    ))}
                  </ol>
                  <p className="quote">
                    <b>Verified by:</b> {play.verification.statement}
                    {play.verification.checkIds.length ? (
                      <span className="mono" style={{ display: "block", marginTop: 5, fontSize: 12 }}>
                        {play.verification.checkIds.join(" · ")}
                      </span>
                    ) : null}
                  </p>
                  {play.closes.length ? (
                    <div className="tags">
                      {play.closes.map((entry) => (
                        <Tag
                          key={`${entry.standardId}-${entry.controlId}`}
                          pack={entry.shortName ?? entry.standardId}
                          id={entry.controlId}
                        />
                      ))}
                    </div>
                  ) : null}
                </Disc>
              ))}
            </div>
          ) : null}
        </section>

        {/* ---- IV · area by area --------------------------------------- */}
        <section className="chapter" id="areas">
          <div className="ch-n">
            <em>Chapter IV</em>
            <hr />
          </div>
          <h2>Area by area</h2>
          <p className="lede">
            The same evidence, grouped by the question it answers. An area with no bar is an area
            where nothing could be assessed — which is a different fact from scoring zero, and is
            never shown as zero here.
          </p>
          <div className="areas">
            {analysis.pillars.map((pillar) => {
              const measured = pillar.assessed > 0;
              return (
                <div className="card area" key={pillar.pillar}>
                  <div className="area-h">
                    <i style={{ background: pillarHue(pillar.pillar) }} />
                    <strong>{pillarLabel(pillar.pillar)}</strong>
                  </div>
                  <p>{pillar.question}</p>
                  {measured ? (
                    <Meter percent={pillar.healthPercent} hue={pillarHue(pillar.pillar)} />
                  ) : (
                    <div className="area-bar" />
                  )}
                  <div className="area-nums">
                    {measured ? (
                      <>
                        <b>{Math.round(pillar.healthPercent)}%</b>
                        <span>of {pillar.assessed} assessed passed</span>
                      </>
                    ) : (
                      <span className="faint">
                        {rulePhrase(pillar.checksRan, pillar.checksTotal)} — no verdict reached
                      </span>
                    )}
                    <SevRow counts={pillar.severityCounts} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ---- V · what we could not see ------------------------------- */}
        <section className="chapter" id="unseen">
          <div className="ch-n">
            <em>Chapter V</em>
            <hr />
          </div>
          <h2>What we could not see</h2>
          <p className="lede">
            The most important chapter, and the one most products leave out. Every control below
            reported <span className="mono">not_assessed</span> — it was neither passed nor failed,
            and it is counted in no score anywhere in this report.
          </p>

          <div className="stats" style={{ marginBottom: 20 }}>
            <div className="stat">
              <em>Not assessed</em>
              <strong>{posture.notAssessed}</strong>
              <p>applicable, but out of reach at this depth</p>
            </div>
            <div className="stat">
              <em>Ruled out</em>
              <strong>{posture.notApplicable}</strong>
              <p>excluded before the run, with a reason</p>
            </div>
            <div className="stat">
              <em>Rules that ran</em>
              <strong>
                {ranChecks.length}
                <span style={{ color: "var(--faint)", fontWeight: 500 }}>/{analysis.checks.length}</span>
              </strong>
              <p>the rest name what would unblock them</p>
            </div>
          </div>

          {blockedByReason.length ? (
            <div className="cards">
              {blockedByReason.map(([reason, entry]) => (
                <div className="card blind" key={reason}>
                  <div>
                    <strong>{reason}</strong>
                    <p>{entry.closedBy}</p>
                  </div>
                  <span className="n">
                    {entry.count}
                    <small>RULES</small>
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {analysis.gaps.length ? (
            <details className="card disc" style={{ marginTop: 12 }}>
              <summary>
                <span className="sev">○</span>
                <span className="ti">
                  Every control that stayed out of reach
                  <small>{analysis.gaps.length} controls, each with the depth that would close it</small>
                </span>
                <span className="rt">show</span>
              </summary>
              <div className="disc-body" style={{ padding: 0 }}>
                <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Control</th>
                        <th>Pack</th>
                        <th>Area</th>
                        <th>Needs</th>
                        <th>Closed by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.gaps.map((gap) => (
                        <tr key={`${gap.standardId}-${gap.controlId}`}>
                          <td>
                            <span className="mono" style={{ fontSize: 11.5 }}>
                              {gap.controlId}
                            </span>
                            <br />
                            {gap.controlName}
                          </td>
                          <td>{gap.shortName}</td>
                          <td>{pillarLabel(gap.pillar)}</td>
                          <td>{tierLabel(gap.tierMinimum)}</td>
                          <td className="muted">{gap.closedBy}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </details>
          ) : null}

          {analysis.monitorPlan.length ? (
            <>
              <h3
                style={{
                  marginTop: 30,
                  marginBottom: 10,
                  fontSize: 17,
                  fontWeight: 650,
                  letterSpacing: "-.02em",
                }}
              >
                Keeping it true
              </h3>
              <p className="lede" style={{ marginBottom: 16 }}>
                A result is true on the day it was collected. These are the rules worth re-running
                on a schedule, with what each one costs to keep armed.
              </p>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Monitor</th>
                      <th>Area</th>
                      <th>Cadence</th>
                      <th className="num">Rules</th>
                      <th className="num">Requests / month</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.monitorPlan.map((monitor) => (
                      <tr key={monitor.id}>
                        <td>
                          {monitor.label}
                          <br />
                          <span className="faint" style={{ fontSize: 12 }}>
                            {monitor.armingCost}
                          </span>
                        </td>
                        <td>{pillarLabel(monitor.pillar)}</td>
                        <td>{monitor.cadence}</td>
                        <td className="num">{monitor.checkIds.length}</td>
                        <td className="num">{monitor.requestsPerMonth}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </section>

        {/* ---- VI · the full trace ------------------------------------- */}
        <section className="chapter" id="trace">
          <div className="ch-n">
            <em>Chapter VI</em>
            <hr />
          </div>
          <h2>The full trace</h2>
          <p className="lede">
            Every rule the engine applied and every request it made, so that any number above can
            be walked back to the thing it came from. This is the chapter that makes the rest
            checkable rather than merely readable.
          </p>

          <details className="card disc">
            <summary>
              <span className="sev">›</span>
              <span className="ti">
                Every rule, and what it decided
                <small>
                  {analysis.checks.length} rules · {ranChecks.length} reached a verdict
                </small>
              </span>
              <span className="rt">show</span>
            </summary>
            <div className="disc-body" style={{ padding: 0 }}>
              <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Rule</th>
                      <th>Verdict</th>
                      <th>How</th>
                      <th>Evidence</th>
                      <th className="num">Controls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.checks.map((check) => (
                      <tr key={check.id}>
                        <td>
                          <span className="mono" style={{ fontSize: 11.5 }}>
                            {check.ruleId}
                          </span>
                          <br />
                          {check.title}
                          {check.provenance === "proxy" ? (
                            <span className="faint" style={{ fontSize: 11.5 }}>
                              {" "}
                              · area proxy
                            </span>
                          ) : null}
                        </td>
                        <td>
                          <Pill status={check.status} />
                        </td>
                        <td className="mono" title={methodPlain[check.method]}>
                          {methodLabel(check.method)}
                        </td>
                        <td className="muted">
                          {check.ran ? check.evidence : check.notRunReason}
                        </td>
                        <td className="num">{check.controls.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </details>

          {analysis.evidence.length ? (
            <details className="card disc" style={{ marginTop: 11 }}>
              <summary>
                <span className="sev">›</span>
                <span className="ti">
                  Every request we made
                  <small>
                    {analysis.evidence.length} records · each one digested, dated and given a
                    validity window
                  </small>
                </span>
                <span className="rt">show</span>
              </summary>
              <div className="disc-body" style={{ padding: 0 }}>
                <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Record</th>
                        <th>Source</th>
                        <th>Request</th>
                        <th>Result</th>
                        <th>Freshness</th>
                        <th className="num">Used by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.evidence.map((record) => (
                        <tr key={record.id}>
                          <td>
                            {record.label}
                            <br />
                            <span className="mono" style={{ fontSize: 11 }}>
                              {record.digest}
                            </span>
                          </td>
                          <td className="mono">{record.sourceType}</td>
                          <td className="mono" style={{ maxWidth: 260, wordBreak: "break-all" }}>
                            {record.method} {record.endpoint}
                          </td>
                          <td>
                            <Pill status={record.status} />
                            {record.httpStatus ? (
                              <span className="mono" style={{ fontSize: 11, marginLeft: 6 }}>
                                {record.httpStatus}
                                {record.latencyMs !== undefined ? ` · ${record.latencyMs}ms` : ""}
                              </span>
                            ) : null}
                          </td>
                          <td>{record.freshness}</td>
                          <td className="num">{record.usedByChecks}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </details>
          ) : null}

          {analysis.notes.length ? (
            <div className="because flat" style={{ marginTop: 16 }}>
              <i>◆</i>
              <span>
                {analysis.notes.map((note) => (
                  <span key={note} style={{ display: "block" }}>
                    {note}
                  </span>
                ))}
              </span>
            </div>
          ) : null}

          <div className="actions">
            <button className="btn primary" type="button" onClick={onPrint}>
              Print or save as PDF
            </button>
            <button className="btn" type="button" onClick={onExport}>
              Download the raw result
            </button>
            <span className="gap" />
            <button className="btn quiet" type="button" onClick={onRerun}>
              Run it again ↺
            </button>
          </div>

          <div className="colo">
            <span>
              <em>Assessment</em>
              <b>{result.assessmentId}</b>
            </span>
            <span>
              <em>Collected</em>
              <b>{new Date(result.generatedAt).toISOString().replace("T", " ").slice(0, 19)}Z</b>
            </span>
            <span>
              <em>Duration</em>
              <b>{duration(liveEvidence.durationMs)}</b>
            </span>
            <span>
              <em>Target</em>
              <b>{liveEvidence.target}</b>
            </span>
            <span>
              <em>Runner</em>
              <b>{liveEvidence.execution.runner}</b>
            </span>
          </div>
          <p className="faint" style={{ fontSize: 12.5, marginTop: 14, lineHeight: 1.6 }}>
            No model judged any control in this report. Every verdict is a deterministic predicate
            over collected evidence, and{" "}
            <span className="mono">{statusMeaning.not_assessed}</span> — so a control with no
            evidence is never counted as a pass.
          </p>
        </section>
      </div>
    </div>
  );
}
