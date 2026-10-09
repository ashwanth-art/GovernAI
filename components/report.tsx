"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Disc, Meter, Pill, Sev, sevHue, Tag } from "@/components/kit";
import { duration, measuredPercent, rulePhrase } from "@/lib/metrics";
import { pillarHue, pillarLabel } from "@/lib/pillars";
import { verdictLabels } from "@/lib/posture";
import { methodLabel, methodPlain, statusMeaning, tierLabel } from "@/lib/terms";
import { evaluatedReportView } from "@/lib/report-view";
import type {
  AssessmentResult,
  ControlResult,
  CoverageGap,
  Finding,
  Pillar,
  RemediationPlaybook,
  Severity,
} from "@/lib/types";

/* ============================================================================
   The result
   ----------------------------------------------------------------------------
   One scroll, and the order is the argument: where you stand, then the same
   result cut two ways — by area, which is how a reader thinks about risk, and
   by pack, which is how an auditor asks the question — then what stayed out of
   reach, then the trace.

   Problems and their fixes are NOT a chapter. They used to be two, listing every
   finding and every playbook run-wide, which meant the fix for a problem sat
   several screens from the problem and neither was attached to the area or the
   pack it belonged to. Both now live inside whichever cut you opened, with the
   fix nested under the problem it closes. The flat run-wide lists survive at the
   bottom of the trace, where a complete enumeration is the point.

   Nothing here computes a verdict. Every number is read from `result.analysis`,
   which is itself derived from statuses the engine already produced.
   ========================================================================== */

export const CHAPTERS = [
  { id: "verdict", n: "I", label: "Where you stand" },
  { id: "areas", n: "II", label: "Area by area" },
  { id: "packs", n: "III", label: "Pack by pack" },
  { id: "trace", n: "IV", label: "The full trace" },
] as const;

const SEV_ORDER: Severity[] = ["critical", "high", "medium", "low"];

/** A verdict was reached. The other two statuses mean the opposite, and lumping
 *  them in is how a pack with nothing tested comes to look fully covered. */
const SETTLED = new Set(["pass", "fail", "partial"]);

/** The one pack that is assessed in every run whether or not it was selected,
 *  and so the one matrix row with no StandardReport behind it. */
const OWASP_ID = "owasp_llm_2025";

export function Report({
  result: rawResult,
  onActiveChapter,
  onPrint,
  onExport,
  onRerun,
  onGoToMonitoring,
  coverageOnly = false,
}: {
  result: AssessmentResult;
  onActiveChapter: (id: string) => void;
  onPrint: () => void;
  onExport: () => void;
  onRerun: () => void;
  onGoToMonitoring?: () => void;
  /** Reuse the exact pillar and pack report inside the separate Monitoring tab. */
  coverageOnly?: boolean;
}) {
  const result = useMemo(() => evaluatedReportView(rawResult), [rawResult]);
  const { analysis, scope, liveEvidence } = result;
  const { posture } = analysis;
  const hostRef = useRef<HTMLDivElement>(null);

  /* Scroll-spy, so the rail at the top of the app doubles as this report's
     contents without the report needing a nav of its own. */
  useEffect(() => {
    if (coverageOnly) return;
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
  }, [onActiveChapter, coverageOnly]);

  const bySeverity = useMemo(
    () =>
      [...analysis.findings].sort(
        (a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity),
      ),
    [analysis.findings],
  );

  const ranChecks = useMemo(() => analysis.checks.filter((check) => check.ran), [analysis.checks]);
  const assessmentNotes = useMemo(
    () => analysis.notes.filter((note) => !note.startsWith("Monitors re-run")),
    [analysis.notes],
  );
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

  /* Each stat is toned by what that stat itself says, using the engine's own
     thresholds in lib/posture.ts — 90% is where coverage stops being
     `insufficient_evidence` and where health clears the `ready` gate. Toning
     health by the overall verdict (as this once did) painted 75% health red
     because criticals were open, while leaving 47% coverage — the number the
     engine actually objects to — looking neutral. The exposure index carries no
     threshold in the engine, so it gets no tone: colouring it would imply a bar
     that does not exist. */
  const healthTone =
    posture.assessed === 0 ? "" : posture.healthPercent >= 90 ? "pass" : "partial";
  const coverageTone = posture.coveragePercent >= 90 ? "pass" : "partial";

  /* Two cuts of one result, and each card is a way in. Everything behind the
     numbers on a card — which rules ran, what each one asked, what broke, and
     the fix for what broke — already exists on the result and was only reachable
     by reading three further chapters and joining them by hand. Opening a card
     is that join, done for the reader.

     One at a time: opening either closes the other, so there is never a sheet
     stacked behind a sheet. */
  const [openPillar, setOpenPillar] = useState<Pillar | null>(null);
  const [openStandard, setOpenStandard] = useState<string | null>(null);

  /* Findings and playbooks, joined onto the area they belong to. Both the card
     and the sheet answer the same question — what broke here and what does it
     cost to fix — and the three arrays that answer it only meet by id, so the
     join happens once rather than twice in two places that could drift. */
  const byPillar = useMemo(() => {
    const map = new Map<
      Pillar,
      { findings: Finding[]; playbooks: RemediationPlaybook[]; effort: [number, number] }
    >();
    for (const entry of analysis.pillars) {
      const findings = analysis.findings
        .filter((finding) => finding.pillar === entry.pillar)
        .sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity));
      const ids = new Set(findings.map((finding) => finding.id));
      const playbooks = analysis.playbooks.filter((book) =>
        book.findingIds.some((id) => ids.has(id)),
      );
      const effort = playbooks.reduce<[number, number]>(
        (total, book) => [total[0] + book.effortHours[0], total[1] + book.effortHours[1]],
        [0, 0],
      );
      map.set(entry.pillar, { findings, playbooks, effort });
    }
    return map;
  }, [analysis.pillars, analysis.findings, analysis.playbooks]);

  /* The same join against the other axis. A finding belongs to exactly one area
     but breaches clauses in as many packs as it touches, so a pack's problem
     list is built from the breaches, not from the finding's own pillar. */
  const byStandard = useMemo(() => {
    const map = new Map<
      string,
      { findings: Finding[]; playbooks: RemediationPlaybook[]; effort: [number, number] }
    >();
    for (const row of analysis.matrix) {
      const findings = analysis.findings
        .filter((finding) => finding.breaches.some((b) => b.standardId === row.standardId))
        .sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity));
      const ids = new Set(findings.map((finding) => finding.id));
      const playbooks = analysis.playbooks.filter((book) =>
        book.findingIds.some((id) => ids.has(id)),
      );
      const effort = playbooks.reduce<[number, number]>(
        (total, book) => [total[0] + book.effortHours[0], total[1] + book.effortHours[1]],
        [0, 0],
      );
      map.set(row.standardId, { findings, playbooks, effort });
    }
    return map;
  }, [analysis.matrix, analysis.findings, analysis.playbooks]);

  useEffect(() => {
    if (!openPillar && !openStandard) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenPillar(null);
      setOpenStandard(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPillar, openStandard]);

  return (
    <div className={`report${coverageOnly ? " monitoring-coverage" : ""}`} ref={hostRef}>
      <div className="report-col">
        {/* ---- I · where you stand ------------------------------------- */}
        {!coverageOnly ? (
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
                evaluated controls included in this report.{" "}
                {posture.notApplicable > 0 ? (
                  <>
                    A further <b>{posture.notApplicable}</b> were ruled out before the run, each
                    with a stated reason.
                  </>
                ) : null}
              </small>
            </div>

            <div className="stats">
              <div className={`stat ${healthTone}`}>
                <em>Health</em>
                <strong>{measuredPercent(posture.healthPercent, posture.assessed > 0)}</strong>
                <p>
                  {posture.assessed > 0
                    ? `averaged over ${posture.assessed} evaluated controls`
                    : "no verdicts yet — nothing here could be assessed"}
                </p>
              </div>
              <div className={`stat ${coverageTone}`}>
                <em>Coverage</em>
                <strong>{posture.coveragePercent}%</strong>
                <p>evaluated controls included in this report</p>
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
        </section>
        ) : null}

        {/* ---- II · area by area --------------------------------------- */}
        <section className="chapter" id={coverageOnly ? "monitor-areas" : "areas"}>
          <div className="ch-n">
            <em>{coverageOnly ? "Continuous report · I" : "Chapter II"}</em>
            <hr />
          </div>
          <h2>{coverageOnly ? "Five pillars now" : "Area by area"}</h2>
          <p className="lede">
            {coverageOnly
              ? "The latest complete monitoring cycle, grouped into the same five pillars as the assessment. Until the first cycle finishes, this is the assessment baseline. Open a pillar for every evaluated clause, current problem and remedy."
              : "The result grouped by the question it answers. Each card carries what broke in that area and what the fixes cost, so the grid can be read without opening anything — and opening one gives you every problem in that area with its fix underneath. A dashed bar means nothing in that area could be assessed, a different fact from scoring zero and never shown as zero here."}
          </p>
          <div className="areas">
            {analysis.pillars.map((pillar) => {
              const measured = pillar.assessed > 0;
              const detail = byPillar.get(pillar.pillar);
              const findings = detail?.findings ?? [];
              const playbooks = detail?.playbooks ?? [];
              const effort = detail?.effort ?? [0, 0];
              const worst = findings[0]?.severity;
              const unread = pillar.applicable - pillar.assessed;
              return (
                <button
                  type="button"
                  className={`card area${findings.length ? ` open ${worst}` : measured ? " clear" : " blank"}`}
                  key={pillar.pillar}
                  onClick={() => {
                    setOpenStandard(null);
                    setOpenPillar(pillar.pillar);
                  }}
                  aria-label={`Open ${pillarLabel(pillar.pillar)} in detail`}
                >
                  <div className="area-h">
                    <span className="area-flag">
                      {findings.length
                        ? `${findings.length} open`
                        : measured
                          ? "clear"
                          : "no verdict"}
                    </span>
                    <strong>
                      <i style={{ background: pillarHue(pillar.pillar) }} />
                      {pillarLabel(pillar.pillar)}
                    </strong>
                  </div>
                  <p>{pillar.question}</p>

                  {/* Health alone is ambiguous — 0% of 4 clauses and 0% of 60 are
                      the same number and nothing like the same situation — so the
                      denominator sits beside it. Rules-run is the third figure and
                      lives in the footer, where there is width for it: three
                      figures on this row wrapped to two lines at card width. */}
                  <div className="area-figs">
                    <span>
                      <b>{measured ? `${Math.round(pillar.healthPercent)}%` : "—"}</b>
                      <em>of read, passed</em>
                    </span>
                    <span>
                      <b>
                        {pillar.assessed}/{pillar.applicable}
                      </b>
                      <em>clauses read</em>
                    </span>
                  </div>

                  {measured ? (
                    <Meter percent={pillar.healthPercent} hue={pillarHue(pillar.pillar)} />
                  ) : (
                    <div className="area-bar void" />
                  )}

                  <div className="area-body">
                    {findings.length ? (
                      <>
                        <div className="area-sevs">
                          {SEV_ORDER.filter((sev) => (pillar.severityCounts[sev] ?? 0) > 0).map(
                            (sev) => (
                              <span className="area-sevc" key={sev}>
                                <i style={{ background: sevHue[sev] }} />
                                {pillar.severityCounts[sev]} {sev}
                              </span>
                            ),
                          )}
                        </div>
                        <ul className="area-probs">
                          {findings.slice(0, 3).map((finding) => (
                            <li key={finding.id}>
                              <i style={{ background: sevHue[finding.severity] }} />
                              {finding.title}
                            </li>
                          ))}
                          {findings.length > 3 ? (
                            <li className="more">+{findings.length - 3} more in this area</li>
                          ) : null}
                        </ul>
                      </>
                    ) : measured ? (
                      <p className="area-none">
                        Every rule that reached a verdict here passed. Nothing is open.
                      </p>
                    ) : (
                      <p className="area-none">
                        No rule here reached a verdict at {tierLabel(scope.tier)}. Nothing was
                        counted as a pass.
                      </p>
                    )}
                  </div>

                  <div className="area-open">
                    <span>
                      {pillar.checksRan}/{pillar.checksTotal} rules ·{" "}
                      {findings.length
                        ? `${playbooks.length} fix${playbooks.length === 1 ? "" : "es"} · ${effort[0]}–${effort[1]}h`
                        : unread > 0
                          ? `${unread} clause${unread === 1 ? "" : "s"} unread`
                          : "fully read"}
                    </span>
                    <span className="area-go" aria-hidden="true">
                      Open ↗
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* ---- III · pack by pack -------------------------------------- */}
        <section className="chapter" id={coverageOnly ? "monitor-packs" : "packs"}>
          <div className="ch-n">
            <em>{coverageOnly ? "Continuous report · II" : "Chapter III"}</em>
            <hr />
          </div>
          <h2>{coverageOnly ? "Standards now" : "Pack by pack"}</h2>
          <p className="lede">
            {coverageOnly
              ? "The same current monitoring result, cut by every selected standard. Open one to see what is covered, what remains unread, every current problem and the exact corrective playbook."
              : "Passed and failed controls, grouped by standard. Open a card for its evaluated controls, findings and fixes."}
          </p>

          <div className="areas">
            {analysis.matrix.map((row) => {
              const measured = row.assessed > 0;
              const detail = byStandard.get(row.standardId);
              const findings = detail?.findings ?? [];
              const playbooks = detail?.playbooks ?? [];
              const effort = detail?.effort ?? [0, 0];
              const worst = findings[0]?.severity;
              const unread = row.applicable - row.assessed;
              const report = result.reports.find((entry) => entry.standardId === row.standardId);
              return (
                <button
                  type="button"
                  className={`card area${findings.length ? ` open ${worst}` : measured ? " clear" : " blank"}`}
                  key={row.standardId}
                  onClick={() => {
                    setOpenPillar(null);
                    setOpenStandard(row.standardId);
                  }}
                  aria-label={`Open ${row.shortName} in detail`}
                >
                  <div className="area-h">
                    <span className="area-flag">
                      {findings.length
                        ? `${findings.length} open`
                        : measured
                          ? "clear"
                          : "no verdict"}
                    </span>
                    <strong>{row.shortName}</strong>
                  </div>
                  {/* Some packs are known by their short name and some are their
                      full title — OWASP printed its own name twice on both lines.
                      A row with no report behind it is the always-on pack, which
                      is worth saying, because nobody selected it. */}
                  <p>
                    {report
                      ? report.name !== row.shortName
                        ? report.name
                        : report.officialReference.authority
                      : "Always on — assessed in every run, selected or not"}
                  </p>

                  {/* Coverage, not health, is the leading figure on this axis. A
                      pack is answered against its own clause list, and "how much
                      of this pack did you actually read" is the first thing
                      anyone asks of a compliance pack. */}
                  <div className="area-figs">
                    <span>
                      <b>{row.coveragePercent}%</b>
                      <em>of pack read</em>
                    </span>
                    <span>
                      <b>
                        {row.assessed}/{row.applicable}
                      </b>
                      <em>clauses read</em>
                    </span>
                  </div>

                  {measured ? (
                    <Meter percent={row.coveragePercent} hue="var(--green)" />
                  ) : (
                    <div className="area-bar void" />
                  )}

                  <div className="area-body">
                    <p className="area-readiness">{row.readiness}</p>
                    {findings.length ? (
                      <ul className="area-probs">
                        {findings.slice(0, 3).map((finding) => (
                          <li key={finding.id}>
                            <i style={{ background: sevHue[finding.severity] }} />
                            {finding.title}
                          </li>
                        ))}
                        {findings.length > 3 ? (
                          <li className="more">+{findings.length - 3} more in this pack</li>
                        ) : null}
                      </ul>
                    ) : measured ? (
                      <p className="area-none">
                        Every clause in this pack that reached a verdict passed. Nothing is open.
                      </p>
                    ) : (
                      <p className="area-none">
                        No clause in this pack reached a verdict at {tierLabel(scope.tier)}. Nothing
                        was counted as a pass.
                      </p>
                    )}
                  </div>

                  <div className="area-open">
                    <span>
                      {measured ? `${Math.round(row.healthPercent)}% passed` : "—"}
                      {" · "}
                      {findings.length
                        ? `${playbooks.length} fix${playbooks.length === 1 ? "" : "es"} · ${effort[0]}–${effort[1]}h`
                        : unread > 0
                          ? `${unread} clause${unread === 1 ? "" : "s"} unread`
                          : "fully read"}
                    </span>
                    <span className="area-go" aria-hidden="true">
                      Open ↗
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* ---- IV · what we could not see ------------------------------ */}
        {!coverageOnly ? (
        <>
        {analysis.gaps.length > 0 && <section className="chapter" id="unseen">
          <div className="ch-n">
            <em>Chapter IV</em>
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

          {analysis.monitorPlan.length && onGoToMonitoring ? (
            <div className="monitor-link-card">
              <div>
                <strong>Keep this result current in Monitoring</strong>
                <p>
                  Configure intervals, activate recurring tests and read the continuous five-pillar
                  and standards report in its own top-level tab.
                </p>
              </div>
              <button className="btn primary sm" type="button" onClick={onGoToMonitoring}>
                Open Monitoring →
              </button>
            </div>
          ) : null}
        </section>}

        {/* ---- VI · the full trace ------------------------------------- */}
        <section className="chapter" id="trace">
          <div className="ch-n">
            <em>Chapter V</em>
            <hr />
          </div>
          <h2>The full trace</h2>
          <p className="lede">
            Every problem, every fix, every rule the engine applied and every request it made, so
            that any number above can be walked back to the thing it came from. The problems and
            fixes are also attached to the area and the pack they belong to, above — these are the
            flat run-wide lists, for when a complete enumeration is what you need.
          </p>

          {/* ---- every problem, run-wide ------------------------------
              These two lists were chapters II and III. They are complete and
              they are ordered, which is exactly what a reader does not want
              when the question is "what is wrong with my retrieval layer" —
              that reader wants the area, and the area now carries them. */}
          <details className="card disc" style={{ marginBottom: 11 }}>
            <summary>
              <span className="sev">›</span>
              <span className="ti">
                Every problem we raised
                <small>
                  {bySeverity.length
                    ? `${bySeverity.length} open · ${SEV_ORDER.filter((sev) => (posture.severityCounts[sev] ?? 0) > 0)
                        .map((sev) => `${posture.severityCounts[sev]} ${sev}`)
                        .join(" · ")}`
                    : "none — every rule that ran reached a pass"}
                </small>
              </span>
              <span className="rt">show</span>
            </summary>
            <div className="disc-body">
              {bySeverity.length ? (
                <div className="sh-finds">
                  {bySeverity.map((finding) => (
                    <FindingCard
                      key={finding.id}
                      finding={finding}
                      book={playbookFor(analysis.playbooks, finding.id, finding.remediationId)}
                    />
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--muted)" }}>
                  No finding was raised. A finding requires a rule to have run and failed, so an
                  empty list here means every rule that ran passed — not that nothing could go
                  wrong.
                </p>
              )}
            </div>
          </details>

          {analysis.playbooks.length ? (
            <details className="card disc" style={{ marginBottom: 11 }}>
              <summary>
                <span className="sev">›</span>
                <span className="ti">
                  Every fix, ranked by what it closes
                  <small>
                    {analysis.playbooks.length} playbook
                    {analysis.playbooks.length === 1 ? "" : "s"} · ranked across every pack, so the
                    first buys the most
                  </small>
                </span>
                <span className="rt">show</span>
              </summary>
              <div className="disc-body" style={{ padding: 0 }}>
                <div className="cards" style={{ padding: 14 }}>
                  {analysis.playbooks.map((play, index) => (
                    <Disc
                      key={play.id}
                      glyph={<Sev severity={play.severity} />}
                      title={`${index + 1}. ${play.title}`}
                      sub={`${play.owner} · ${play.effortHours[0]}–${play.effortHours[1]} hours`}
                      right={`closes ${play.closesCount} in ${play.standardsCount} packs`}
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
                          <span
                            className="mono"
                            style={{ display: "block", marginTop: 5, fontSize: 12 }}
                          >
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
              </div>
            </details>
          ) : null}

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

          {assessmentNotes.length ? (
            <div className="because flat" style={{ marginTop: 16 }}>
              <i>◆</i>
              <span>
                {assessmentNotes.map((note) => (
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
            over collected evidence. The status <span className="mono">not_assessed</span> means{" "}
            {statusMeaning.not_assessed}; a control with no evidence is never counted as a pass.
          </p>
        </section>
        </>
        ) : null}
      </div>

      {openPillar ? (
        <PillarSheet
          result={result}
          pillar={openPillar}
          onClose={() => setOpenPillar(null)}
          onSwitch={setOpenPillar}
        />
      ) : null}

      {openStandard ? (
        <StandardSheet
          result={result}
          standardId={openStandard}
          onClose={() => setOpenStandard(null)}
          onSwitch={setOpenStandard}
        />
      ) : null}
    </div>
  );
}

/* ============================================================================
   Shared sheet parts
   ----------------------------------------------------------------------------
   The area sheet and the pack sheet are two cuts of one result, so the thing a
   reader came for — a problem with its fix under it — is rendered by one
   component. Two copies would drift, and the drift would be silent: both would
   still show a problem and a fix, just differently.
   ========================================================================== */

/** A playbook can close findings in more than one area or pack, so it is looked
 *  up by the finding rather than filtered by either axis — the same fix
 *  legitimately shows under two problems if it closes both. */
function playbookFor(
  playbooks: RemediationPlaybook[],
  findingId: string,
  remediationId?: string,
) {
  return playbooks.find(
    (book) => book.id === remediationId || book.findingIds.includes(findingId),
  );
}

function FindingCard({
  finding,
  book,
  highlightStandardId,
}: {
  finding: Finding;
  book?: RemediationPlaybook;
  /** When a pack is open, its own clauses are the point; the others are context
   *  for how far the problem reaches. Unset from the area sheet, where no pack
   *  is more relevant than another. */
  highlightStandardId?: string;
}) {
  return (
    <article className={`sh-find ${finding.severity}`}>
      <div className="sh-find-h">
        <Sev severity={finding.severity} />
        <strong>{finding.title}</strong>
        <span className="sh-sevword">{finding.severity}</span>
      </div>
      <p className="sh-detail">{finding.detail}</p>
      <p className="sh-impact">
        <span className="sh-lbl">Why it matters</span>
        {finding.impact}
      </p>

      <div className="sh-blast">
        <span>
          <b>{finding.blastRadius.controls}</b> clause
          {finding.blastRadius.controls === 1 ? "" : "s"} breached
        </span>
        <span>
          <b>{finding.blastRadius.standards}</b> pack
          {finding.blastRadius.standards === 1 ? "" : "s"} affected
        </span>
        <span>
          owner <b>{finding.owner}</b>
        </span>
      </div>

      {finding.breaches.length ? (
        <div className="sh-clauses">
          <span className="sh-lbl">What it breaches</span>
          {finding.breaches.map((breach) => (
            <span
              className={`sh-clause${
                highlightStandardId && breach.standardId === highlightStandardId ? " on" : ""
              }`}
              key={`${breach.standardId}:${breach.controlId}`}
            >
              <b>{breach.shortName}</b>
              <span className="mono">{breach.controlId}</span>
              {breach.controlName}
            </span>
          ))}
        </div>
      ) : null}

      {book ? (
        <div className="sh-fix">
          <div className="sh-fix-h">
            <span className="sh-fix-tag">Remediation</span>
            <strong>{book.title}</strong>
          </div>
          <div className="sh-fix-meta">
            <span>
              <em>Owner</em>
              <b>{book.owner}</b>
            </span>
            <span>
              <em>Effort</em>
              <b>
                {book.effortHours[0]}–{book.effortHours[1]}h
              </b>
            </span>
            <span>
              <em>Closes</em>
              <b>
                {book.closesCount} clause{book.closesCount === 1 ? "" : "s"} in{" "}
                {book.standardsCount} pack{book.standardsCount === 1 ? "" : "s"}
              </b>
            </span>
          </div>
          <ol className="sh-steps">
            {book.steps.map((step) => (
              /* Action and location are one grid cell, not two — as siblings the
                 <small> wrapped into the 20px counter column and rendered one
                 letter per line. */
              <li key={step.order}>
                <span>
                  {step.action}
                  <small className="mono">{step.where}</small>
                </span>
              </li>
            ))}
          </ol>
          <p className="sh-verify">
            <span className="sh-lbl">You will know it worked when</span>
            {book.verification.statement}
          </p>
        </div>
      ) : (
        <p className="sh-verify">
          <span className="sh-lbl">Closes when</span>
          {finding.closesWhen}
        </p>
      )}
    </article>
  );
}

/* ============================================================================
   The area sheet
   ----------------------------------------------------------------------------
   One area, opened. It answers three questions in the order a reader asks them:
   what failed here and what do I do about each one, what did you actually
   evaluate to be able to say that, and what stayed out of reach. The first is
   the reason this exists — the fix is nested under the problem it closes.
   ========================================================================== */

function PillarSheet({
  result,
  pillar,
  onClose,
  onSwitch,
}: {
  result: AssessmentResult;
  pillar: Pillar;
  onClose: () => void;
  onSwitch: (pillar: Pillar) => void;
}) {
  const { analysis } = result;
  const posture = analysis.pillars.find((entry) => entry.pillar === pillar);
  const hue = pillarHue(pillar);

  /* Switching areas from the tab strip keeps the sheet mounted, so without this
     a reader who was deep in Security's findings lands mid-way down a shorter
     area and sees no heading — it reads as a broken panel rather than a new one. */
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [pillar]);

  const checks = useMemo(
    () => analysis.checks.filter((check) => check.pillar === pillar),
    [analysis.checks, pillar],
  );
  const ran = useMemo(() => checks.filter((check) => check.ran), [checks]);
  const blocked = useMemo(() => checks.filter((check) => !check.ran), [checks]);
  const findings = useMemo(
    () =>
      analysis.findings
        .filter((finding) => finding.pillar === pillar)
        .sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity)),
    [analysis.findings, pillar],
  );
  const gaps = useMemo(
    () => analysis.gaps.filter((gap) => gap.pillar === pillar),
    [analysis.gaps, pillar],
  );

  /* Distinct clauses, not the sum of each finding's own count — two findings can
     breach the same clause, and adding them would report more breaches than the
     area has clauses. */
  const breached = useMemo(() => {
    const seen = new Set<string>();
    for (const finding of findings) {
      for (const breach of finding.breaches) seen.add(`${breach.standardId}:${breach.controlId}`);
    }
    return seen.size;
  }, [findings]);

  const effort = useMemo(() => {
    const ids = new Set(findings.map((finding) => finding.id));
    const books = analysis.playbooks.filter((book) =>
      book.findingIds.some((id) => ids.has(id)),
    );
    return books.reduce<[number, number, number]>(
      (total, book) => [total[0] + 1, total[1] + book.effortHours[0], total[2] + book.effortHours[1]],
      [0, 0, 0],
    );
  }, [analysis.playbooks, findings]);

  /* Which standards this area's rules actually settled, and how many clauses in
     each. This is the answer to "what is this area doing for the packs I chose". */
  const standards = useMemo(() => {
    const groups = new Map<string, { shortName: string; controls: Set<string> }>();
    for (const check of ran) {
      for (const control of check.controls) {
        const existing = groups.get(control.standardId);
        if (existing) existing.controls.add(control.controlId);
        else
          groups.set(control.standardId, {
            shortName: control.shortName,
            controls: new Set([control.controlId]),
          });
      }
    }
    return [...groups.values()]
      .map((group) => ({ shortName: group.shortName, count: group.controls.size }))
      .sort((a, b) => b.count - a.count);
  }, [ran]);

  if (!posture) return null;
  const measured = posture.assessed > 0;

  return (
    <div className="sheet-scrim" role="dialog" aria-modal="true" aria-label={posture.label}>
      <button className="sheet-back" type="button" aria-label="Close" onClick={onClose} />
      <div className="sheet">
        <header className="sheet-h" style={{ borderTopColor: hue }}>
          <div className="sheet-h-top">
            <span className="sheet-eyebrow">
              <i style={{ background: hue }} />
              Area
            </span>
            <button
              className="sheet-x"
              type="button"
              onClick={onClose}
              aria-label="Close this area"
            >
              <span>Close</span> ✕
            </button>
          </div>
          <h3>{posture.label}</h3>
          <p>{posture.question}</p>

          <div className="sheet-nums">
            <span>
              <em>Rules run</em>
              <b>
                {posture.checksRan}/{posture.checksTotal}
              </b>
            </span>
            <span>
              <em>Clauses assessed</em>
              <b>
                {posture.assessed}/{posture.applicable}
              </b>
            </span>
            <span>
              <em>Of those, passed</em>
              <b>{measured ? `${Math.round(posture.healthPercent)}%` : "—"}</b>
            </span>
            <span className={findings.length ? "hot" : ""}>
              <em>Problems open</em>
              <b>{findings.length}</b>
            </span>
            {findings.length ? (
              <span>
                <em>Fixes · effort</em>
                <b>
                  {effort[0]} · {effort[1]}–{effort[2]}h
                </b>
              </span>
            ) : null}
          </div>

          <nav className="sheet-tabs">
            {analysis.pillars.map((entry) => (
              <button
                type="button"
                key={entry.pillar}
                className={entry.pillar === pillar ? "on" : ""}
                onClick={() => onSwitch(entry.pillar)}
              >
                <i style={{ background: pillarHue(entry.pillar) }} />
                {entry.label}
              </button>
            ))}
          </nav>
        </header>

        <div className="sheet-body" ref={bodyRef}>
          {/* ---- what we found, with the fix under each ---------------- */}
          <section className="sh-sec lead">
            <h4>What failed here, and the fix for each</h4>
            {findings.length ? (
              <>
                <p className="sh-lede">
                  {findings.length} problem{findings.length === 1 ? "" : "s"} open, breaching{" "}
                  {breached} clause{breached === 1 ? "" : "s"}. Every one carries the fix that
                  closes it — owner, steps, and how you will know it worked.
                </p>
                <div className="sh-finds">
                  {findings.map((finding) => (
                    <FindingCard
                      key={finding.id}
                      finding={finding}
                      book={playbookFor(analysis.playbooks, finding.id, finding.remediationId)}
                    />
                  ))}
                </div>
              </>
            ) : (
              <p className="sh-empty">
                Nothing failed in this area. That is a statement about the{" "}
                {posture.assessed} clause{posture.assessed === 1 ? "" : "s"} we could assess, not
                about the {posture.applicable - posture.assessed} we could not.
              </p>
            )}
          </section>

          {/* ---- the evidence behind it, folded away --------------------
              An area is opened to answer "what broke and what do I do", so that
              answer is the page. The rules that ran are the working behind it —
              needed when a verdict is challenged, noise the rest of the time. */}
          <details className="sh-fold">
            <summary>
              <span>What we evaluated here</span>
              <small>
                {posture.checksRan} of {posture.checksTotal} rules · {posture.assessed} clause
                {posture.assessed === 1 ? "" : "s"} read
              </small>
            </summary>
            <p className="sh-lede">
              {posture.checksRan} of this area&rsquo;s {posture.checksTotal} rules reached a verdict
              at {tierLabel(result.scope.tier)}
              {standards.length
                ? `, settling ${posture.assessed} clause${posture.assessed === 1 ? "" : "s"} across ${standards.length} pack${standards.length === 1 ? "" : "s"}.`
                : "."}
            </p>

            {standards.length ? (
              <div className="sh-packs">
                {standards.map((entry) => (
                  <span className="sh-pack" key={entry.shortName}>
                    <b>{entry.shortName}</b>
                    {entry.count} clause{entry.count === 1 ? "" : "s"}
                  </span>
                ))}
              </div>
            ) : null}

            {posture.domains.length ? (
              <div className="sh-domains">
                {posture.domains.map((domain) => (
                  <div className="sh-domain" key={domain.id}>
                    <div className="sh-domain-h">
                      <Pill status={domain.status} />
                      <strong>{domain.label}</strong>
                    </div>
                    <p>{domain.question}</p>
                    <small>
                      {rulePhrase(domain.checksRan, domain.checksTotal)} ·{" "}
                      {domain.findings === 0
                        ? "nothing open"
                        : `${domain.findings} problem${domain.findings === 1 ? "" : "s"} open`}
                    </small>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="sh-rules">
              {ran.map((check) => (
                <details className="sh-rule" key={check.id}>
                  <summary>
                    <Pill status={check.status} />
                    <span className="sh-rule-t">
                      {check.title}
                      <small>
                        <span className="mono">{check.ruleId}</span> ·{" "}
                        {methodPlain[check.method] ?? methodLabel(check.method)}
                        {check.controls.length
                          ? ` · settles ${check.controls.length} clause${check.controls.length === 1 ? "" : "s"}`
                          : ""}
                      </small>
                    </span>
                  </summary>
                  <div className="sh-rule-d">
                    <p className="sh-intent">{check.intent}</p>
                    <div className="sh-facts">
                      {check.request ? (
                        <p>
                          <span className="sh-lbl">Where it looked</span>
                          <span className="mono">
                            {check.request.method} {check.request.endpoint}
                          </span>
                        </p>
                      ) : null}
                      <p>
                        <span className="sh-lbl">Passes when</span>
                        {check.rule.passWhen}
                      </p>
                      <p>
                        <span className="sh-lbl">Fails when</span>
                        {check.rule.failWhen}
                      </p>
                      {check.evidence ? (
                        <p>
                          <span className="sh-lbl">What it found</span>
                          {check.evidence}
                        </p>
                      ) : null}
                    </div>
                    {check.controls.length ? (
                      <div className="sh-clauses">
                        <span className="sh-lbl">Clauses this settles</span>
                        {check.controls.map((control) => (
                          <span
                            className="sh-clause"
                            key={`${control.standardId}:${control.controlId}`}
                          >
                            <b>{control.shortName}</b>
                            <span className="mono">{control.controlId}</span>
                            {control.controlName}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </details>
              ))}
              {!ran.length ? (
                <p className="sh-empty">
                  No rule in this area reached a verdict at {tierLabel(result.scope.tier)}. Raising
                  the depth is what changes that.
                </p>
              ) : null}
            </div>
          </details>

          {/* ---- what stayed out of reach ------------------------------ */}
          {blocked.length || gaps.length ? (
            <details className="sh-fold">
              <summary>
                <span>What stayed out of reach</span>
                <small>
                  {blocked.length} rule{blocked.length === 1 ? "" : "s"} never ran · {gaps.length}{" "}
                  clause{gaps.length === 1 ? "" : "s"} with no verdict
                </small>
              </summary>
              <p className="sh-lede">
                {blocked.length} rule{blocked.length === 1 ? "" : "s"} in this area never ran, so{" "}
                {gaps.length} clause{gaps.length === 1 ? "" : "s"} carries no verdict. None of these
                counted as a pass.
              </p>
              <div className="sh-blocked">
                {blocked.map((check) => (
                  <div className="sh-block" key={check.id}>
                    <span className="sh-block-t">
                      {check.title}
                      <small className="mono">{check.ruleId}</small>
                    </span>
                    <span className="sh-block-r">{check.notRunReason}</span>
                    <span className="sh-block-n">needs {tierLabel(check.tierMinimum)}</span>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   The pack sheet
   ----------------------------------------------------------------------------
   One standard, opened, answering the question an auditor actually asks: of the
   clauses in this pack that apply to me, which did you read, which did you not,
   what failed, and what closes it. Same three-part shape as the area sheet and
   the same components, because it is the same result — only the axis differs.

   Coverage here is against this pack's own applicable clause list. A control
   ruled out before the run is reported separately with its reason and is in no
   denominator: excluding it quietly would flatter every percentage on the page.
   ========================================================================== */

function StandardSheet({
  result,
  standardId,
  onClose,
  onSwitch,
}: {
  result: AssessmentResult;
  standardId: string;
  onClose: () => void;
  onSwitch: (standardId: string) => void;
}) {
  const { analysis } = result;
  const row = analysis.matrix.find((entry) => entry.standardId === standardId);
  const report = result.reports.find((entry) => entry.standardId === standardId);

  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [standardId]);

  const findings = useMemo(
    () =>
      analysis.findings
        .filter((finding) => finding.breaches.some((b) => b.standardId === standardId))
        .sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity)),
    [analysis.findings, standardId],
  );

  /* Clauses of THIS pack that the findings break. A finding's own blastRadius
     counts every pack it touches, which is the wrong number to print on a page
     that is about one of them. */
  const breachedHere = useMemo(() => {
    const seen = new Set<string>();
    for (const finding of findings) {
      for (const breach of finding.breaches) {
        if (breach.standardId === standardId) seen.add(breach.controlId);
      }
    }
    return seen;
  }, [findings, standardId]);

  const effort = useMemo(() => {
    const ids = new Set(findings.map((finding) => finding.id));
    const books = analysis.playbooks.filter((book) =>
      book.findingIds.some((id) => ids.has(id)),
    );
    return books.reduce<[number, number, number]>(
      (total, book) => [total[0] + 1, total[1] + book.effortHours[0], total[2] + book.effortHours[1]],
      [0, 0, 0],
    );
  }, [analysis.playbooks, findings]);

  /* Three lists, and the distinction between the second and the third is the
     whole point of the chapter: "we could not read this" is not "this does not
     apply to you", and only one of them is a gap you can close by testing
     harder. */
  const { settled, unread, ruledOut } = useMemo(() => {
    /* The always-on OWASP pack has a matrix row but no StandardReport — its
       controls are assessed on their own field. Reading only `reports` left its
       sheet claiming four clauses read and then listing none of them. */
    const controls = report?.controls ?? (standardId === OWASP_ID ? result.owasp : []);
    const rank: Record<string, number> = { fail: 0, partial: 1, pass: 2 };
    return {
      settled: controls
        .filter((control) => SETTLED.has(control.status))
        .sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3)),
      unread: controls.filter(
        (control) =>
          control.status === "not_assessed" && control.applicabilityStatus !== "not_applicable",
      ),
      ruledOut: controls.filter((control) => control.status === "not_applicable"),
    };
  }, [report, result.owasp, standardId]);

  /* What would close each unread clause, taken from the gap register rather than
     restated here — the engine already decided, per clause, which depth reaches
     it and what standing in the way. */
  const gapFor = useMemo(() => {
    const map = new Map<string, CoverageGap>();
    for (const gap of analysis.gaps) {
      if (gap.standardId === standardId) map.set(gap.controlId, gap);
    }
    return map;
  }, [analysis.gaps, standardId]);

  if (!row) return null;
  const measured = row.assessed > 0;

  return (
    <div className="sheet-scrim" role="dialog" aria-modal="true" aria-label={row.shortName}>
      <button className="sheet-back" type="button" aria-label="Close" onClick={onClose} />
      <div className="sheet">
        <header className="sheet-h" style={{ borderTopColor: "var(--green)" }}>
          <div className="sheet-h-top">
            <span className="sheet-eyebrow">
              <i style={{ background: "var(--green)" }} />
              Pack
            </span>
            <button
              className="sheet-x"
              type="button"
              onClick={onClose}
              aria-label="Close this pack"
            >
              <span>Close</span> ✕
            </button>
          </div>
          {/* The short name leads, because it is what the reader clicked. The
              full title is context and goes on the line below with everything
              else that qualifies the pack. */}
          <h3>{row.shortName}</h3>
          <p>
            {report && report.name !== row.shortName ? `${report.name} · ` : ""}
            {row.readiness}
            {report?.version ? ` · ${report.version}` : ""}
            {row.excluded > 0
              ? ` · ${row.excluded} clause${row.excluded === 1 ? "" : "s"} ruled out before the run`
              : ""}
          </p>

          <div className="sheet-nums">
            <span>
              <em>Clauses read</em>
              <b>
                {row.assessed}/{row.applicable}
              </b>
            </span>
            <span>
              <em>Coverage</em>
              <b>{row.coveragePercent}%</b>
            </span>
            <span>
              <em>Of those, passed</em>
              <b>{measuredPercent(row.healthPercent, measured)}</b>
            </span>
            <span className={findings.length ? "hot" : ""}>
              <em>Problems open</em>
              <b>{findings.length}</b>
            </span>
            {findings.length ? (
              <span>
                <em>Fixes · effort</em>
                <b>
                  {effort[0]} · {effort[1]}–{effort[2]}h
                </b>
              </span>
            ) : null}
          </div>

          <nav className="sheet-tabs">
            {analysis.matrix.map((entry) => (
              <button
                type="button"
                key={entry.standardId}
                className={entry.standardId === standardId ? "on" : ""}
                onClick={() => onSwitch(entry.standardId)}
              >
                {entry.shortName}
              </button>
            ))}
          </nav>
        </header>

        <div className="sheet-body" ref={bodyRef}>
          {/* ---- what failed, with the fix under each ------------------ */}
          <section className="sh-sec lead">
            <h4>What fails this pack, and the fix for each</h4>
            {findings.length ? (
              <>
                <p className="sh-lede">
                  {findings.length} problem{findings.length === 1 ? "" : "s"} breach{" "}
                  {breachedHere.size} clause{breachedHere.size === 1 ? "" : "s"} of{" "}
                  {row.shortName}. Each carries the fix that closes it — owner, steps, and how you
                  will know it worked. Clauses from this pack are highlighted; the others show how
                  far the same problem reaches.
                </p>
                <div className="sh-finds">
                  {findings.map((finding) => (
                    <FindingCard
                      key={finding.id}
                      finding={finding}
                      book={playbookFor(analysis.playbooks, finding.id, finding.remediationId)}
                      highlightStandardId={standardId}
                    />
                  ))}
                </div>
              </>
            ) : (
              <p className="sh-empty">
                Nothing in this pack failed. That is a statement about the {row.assessed} clause
                {row.assessed === 1 ? "" : "s"} we could read, not about the{" "}
                {row.applicable - row.assessed} we could not.
              </p>
            )}
          </section>

          {/* ---- what was covered -------------------------------------- */}
          <details className="sh-fold">
            <summary>
              <span>What this pack covers</span>
              <small>
                {settled.length} clause{settled.length === 1 ? "" : "s"} read of {row.applicable}{" "}
                applicable · {row.coveragePercent}%
              </small>
            </summary>
            <p className="sh-lede">
              Every clause below reached a verdict from a rule. {row.provenance.direct} came from a
              rule written against the clause itself and {row.provenance.proxy} from an area-level
              proxy standing in where no direct rule exists.
            </p>

            {row.cells.length ? (
              <div className="sh-cells">
                {row.cells.map((cell) => (
                  <div className="sh-cell" key={cell.pillar}>
                    <span className="sh-cell-h">
                      <i style={{ background: pillarHue(cell.pillar) }} />
                      {pillarLabel(cell.pillar)}
                    </span>
                    <b>
                      {cell.assessed}/{cell.applicable}
                    </b>
                    <Meter percent={cell.coveragePercent} hue={pillarHue(cell.pillar)} />
                  </div>
                ))}
              </div>
            ) : null}

            {settled.length ? (
              <div className="sh-clist">
                {settled.map((control) => (
                  <ClauseRow key={control.id} control={control} note={control.evidence} />
                ))}
              </div>
            ) : (
              <p className="sh-empty">
                No clause in this pack reached a verdict at {tierLabel(result.scope.tier)}. Raising
                the depth is what changes that.
              </p>
            )}
          </details>

          {/* ---- what was not covered ---------------------------------- */}
          {unread.length || ruledOut.length ? (
            <details className="sh-fold">
              <summary>
                <span>What this pack does not cover yet</span>
                <small>
                  {unread.length} clause{unread.length === 1 ? "" : "s"} with no verdict
                  {ruledOut.length ? ` · ${ruledOut.length} ruled out before the run` : ""}
                </small>
              </summary>
              <p className="sh-lede">
                {unread.length} clause{unread.length === 1 ? "" : "s"} of {row.shortName} applies to
                you and carries no verdict. None of them counted as a pass anywhere in this report,
                and each names the depth that would reach it.
              </p>

              {unread.length ? (
                <div className="sh-clist">
                  {unread.map((control) => {
                    const gap = gapFor.get(control.id);
                    return (
                      <ClauseRow
                        key={control.id}
                        control={control}
                        /* The depth is named only when raising it is what would
                           actually reach the clause. At the tier the run already
                           used, "needs Tier 2" beside "grant an authorized
                           token" reads as a contradiction. */
                        note={
                          gap
                            ? gap.tierMinimum > result.scope.tier
                              ? `${gap.closedBy} · needs ${tierLabel(gap.tierMinimum)}`
                              : gap.closedBy
                            : control.tierMinimum > result.scope.tier
                              ? `Needs ${tierLabel(control.tierMinimum)}`
                              : undefined
                        }
                      />
                    );
                  })}
                </div>
              ) : null}

              {ruledOut.length ? (
                <>
                  <p className="sh-lede" style={{ marginTop: 18 }}>
                    Ruled out before the run, each with the answer that ruled it out. These are in
                    no denominator on this page.
                  </p>
                  <div className="sh-clist">
                    {ruledOut.map((control) => (
                      <ClauseRow
                        key={control.id}
                        control={control}
                        note={control.applicabilityReason}
                      />
                    ))}
                  </div>
                </>
              ) : null}
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ClauseRow({ control, note }: { control: ControlResult; note?: string }) {
  /* Toned by the clause's own verdict, not by whether a finding touches it. An
     earlier version tinted the breached rows, which in a pack where every read
     clause failed painted the whole list red and said nothing the pill had not
     already said. */
  return (
    <div className={`sh-crow ${control.status}`}>
      <Pill status={control.status} />
      <span className="sh-crow-t">
        <span className="sh-crow-id mono">{control.id}</span>
        {control.name}
        {note ? <small>{note}</small> : null}
      </span>
    </div>
  );
}
