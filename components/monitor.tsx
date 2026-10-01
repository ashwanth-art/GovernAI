"use client";

import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Meter, Pill } from "@/components/kit";
import { Report } from "@/components/report";
import { duration } from "@/lib/metrics";
import { pillarHue, pillarLabel, pillarOrder } from "@/lib/pillars";
import { methodLabel, methodPlain } from "@/lib/terms";
import type {
  AssessmentInput,
  AssessmentResult,
  CheckExecution,
  ControlStatus,
  MonitorPlanEntry,
  Pillar,
} from "@/lib/types";

/* ============================================================================
   MONITORING
   The assessment answers "is this true today". This screen answers "is it still
   true", which is a different question and needs a different surface: the thing
   being configured is not a run, it is a schedule.
   ========================================================================== */

/* ---- the wire types, mirroring lib/monitor-store.ts --------------------- */

type DriftDirection = "regression" | "improvement" | "evidence_changed";

interface DriftEntry {
  checkId: string;
  title: string;
  monitorIds: string[];
  pillar: Pillar;
  from: ControlStatus;
  to: ControlStatus;
  direction: DriftDirection;
  detail: string;
  previousEvidence: string;
  currentEvidence: string;
  at: string;
}

interface MonitorCycle {
  id: string;
  sequence: number;
  at: string;
  trigger: "manual" | "due";
  tier: 1 | 2 | 3;
  durationMs: number;
  monitors: Array<{
    monitorId: string;
    label: string;
    pillar: Pillar;
    status: ControlStatus;
    checksRead: number;
  }>;
  readings: Array<{
    checkId: string;
    title: string;
    status: ControlStatus;
    evidence: string;
    confidence: number;
  }>;
  drift: DriftEntry[];
  error?: string;
}

interface ArmedMonitor {
  monitorId: string;
  label: string;
  pillar: Pillar;
  cadenceSeconds: number;
  declaredCadence: string;
  checkIds: string[];
  armedAt: string;
  lastReadAt: string | null;
  nextDueAt: string;
  status: ControlStatus | null;
  checksRead: number;
}

export interface MonitorState {
  armed: ArmedMonitor[];
  cycles: MonitorCycle[];
  running: boolean;
  credentialsHeld: boolean;
  nextDueAt: string | null;
  lastCycleAt: string | null;
  cyclesRun: number;
  minCadenceSeconds: number;
  alerts: DriftEntry[];
  latestResult: AssessmentResult | null;
  note: string;
}

/* ---- intervals ---------------------------------------------------------- */

/**
 * The intervals on offer.
 *
 * The floor is the store's floor — a monitor is not a load generator, and the
 * store clamps anything tighter regardless of what is sent. Every cadence the
 * derived plan recommends (6h for a live probe, 12h for an adapter read, daily
 * for a provider API) is on this list, so a row can always be returned to the
 * value the run itself suggested.
 */
const INTERVALS: Array<{ seconds: number; label: string }> = [
  { seconds: 60, label: "Every minute" },
  { seconds: 300, label: "Every 5 minutes" },
  { seconds: 900, label: "Every 15 minutes" },
  { seconds: 1800, label: "Every 30 minutes" },
  { seconds: 3600, label: "Hourly" },
  { seconds: 10800, label: "Every 3 hours" },
  { seconds: 21600, label: "Every 6 hours" },
  { seconds: 43200, label: "Every 12 hours" },
  { seconds: 86400, label: "Daily" },
];

/** 30 days of minutes — the window the plan's own requests-per-month figure uses. */
const MINUTES_PER_MONTH = 43200;

function intervalLabel(seconds: number): string {
  const known = INTERVALS.find((entry) => entry.seconds === seconds);
  if (known) return known.label;
  if (seconds % 3600 === 0) return `Every ${seconds / 3600} hours`;
  if (seconds % 60 === 0) return `Every ${seconds / 60} minutes`;
  return `Every ${seconds} seconds`;
}

function requestsPerMonth(seconds: number, rules: number): number {
  return Math.round((MINUTES_PER_MONTH / (seconds / 60)) * rules);
}

/**
 * The row's heading: what this monitor actually does, in words.
 *
 * `methodPlain` already carries the sentence and it is the only description of a
 * method in the codebase, so it is reused rather than paraphrased — a second
 * vocabulary for the same six values is how the two drift apart.
 */
function monitorTitle(method: string): string {
  const plain = methodPlain[method];
  if (!plain) return methodLabel(method);
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}

const ignoreReportAction = () => undefined;

/** Worse is higher, matching the store. Used to roll a pillar up to one status. */
const SEVERITY_OF_STATUS: Record<ControlStatus, number> = {
  pass: 0,
  not_applicable: 0,
  not_assessed: 1,
  partial: 2,
  fail: 3,
};

function worstOf(statuses: ControlStatus[]): ControlStatus | null {
  if (!statuses.length) return null;
  return statuses.reduce((worst, status) =>
    SEVERITY_OF_STATUS[status] > SEVERITY_OF_STATUS[worst] ? status : worst,
  );
}

/* ---- clocks ------------------------------------------------------------- */

/**
 * A signed gap in words. Signed matters: "due in 4m" and "due 4m ago" are
 * different facts about a schedule, and a monitor that is overdue because nobody
 * has the app open must say so rather than showing a comfortable countdown.
 */
function gap(fromMs: number, toMs: number): string {
  const seconds = Math.round((toMs - fromMs) / 1000);
  const magnitude = Math.abs(seconds);
  const unit =
    magnitude < 60
      ? `${magnitude}s`
      : magnitude < 3600
        ? `${Math.round(magnitude / 60)}m`
        : magnitude < 86400
          ? `${Math.round(magnitude / 3600)}h`
          : `${Math.round(magnitude / 86400)}d`;
  if (magnitude < 5) return "now";
  return seconds >= 0 ? `in ${unit}` : `${unit} ago`;
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/* ---- the hook: one poller for the whole app ----------------------------- */

/**
 * Monitor state, polled.
 *
 * This build has no background worker: the server runs a due cycle when someone
 * reads the monitor state. That is a real constraint and it decides where this
 * hook lives — it is called once at the top of the app, not inside the monitoring
 * screen, so arming a monitor and then going back to the assessment tab does not
 * quietly stop the schedule. The screen renders what the hook holds.
 */
export function useMonitors(pollMs = 15_000) {
  const [state, setState] = useState<MonitorState | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  /*
   * Intervals the operator has chosen, and nothing else.
   *
   * The effective interval for a row is derived, not stored: the server owns it
   * once a monitor is armed, this map owns it before that, and the run's own
   * recommendation is the floor of the fallback chain. Mirroring the server into
   * local state instead would mean two copies of one number and an effect to keep
   * them level — and the copy would be wrong for exactly as long as a command was
   * in flight.
   *
   * It lives up here with the poller rather than in the screen, because the screen
   * unmounts on a tab switch: an interval chosen but not yet armed would otherwise
   * be silently forgotten by walking away and coming back.
   */
  const [chosen, setChosen] = useState<Record<string, number>>({});
  /* Held so a poll landing mid-command cannot overwrite the command's own reply
     with an older reading. */
  const commandsInFlight = useRef(0);

  const read = useCallback(async () => {
    try {
      const response = await fetch("/api/monitors");
      if (!response.ok) return;
      const next = (await response.json()) as MonitorState;
      if (commandsInFlight.current === 0) setState(next);
    } catch {
      /* A dropped poll is not worth a banner; the next one is 15 seconds away. */
    }
  }, []);

  const command = useCallback(async (body: Record<string, unknown>) => {
    commandsInFlight.current += 1;
    setBusy(true);
    setErrors([]);
    try {
      const response = await fetch("/api/monitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as MonitorState & { errors?: string[] };
      if (!response.ok) {
        setErrors(payload.errors ?? ["The monitor could not be changed."]);
        return false;
      }
      setState(payload);
      return true;
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "The monitor could not be changed."]);
      return false;
    } finally {
      commandsInFlight.current -= 1;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    /* The first read is fired from a task rather than the effect body: it resolves
       into setState, and a setState reachable synchronously from an effect is the
       cascading-render pattern the codebase avoids everywhere else. */
    const first = window.setTimeout(() => void read(), 0);
    const timer = window.setInterval(() => void read(), pollMs);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [read, pollMs]);

  return { state, errors, busy, command, refresh: read, chosen, setChosen };
}

/* ---- the screen --------------------------------------------------------- */

export function Monitoring({
  result,
  input,
  state,
  errors,
  busy,
  command,
  chosen,
  setChosen,
  onGoToAssessment,
}: {
  result: AssessmentResult | null;
  input: AssessmentInput;
  state: MonitorState | null;
  errors: string[];
  busy: boolean;
  command: (body: Record<string, unknown>) => Promise<boolean>;
  chosen: Record<string, number>;
  setChosen: Dispatch<SetStateAction<Record<string, number>>>;
  onGoToAssessment: () => void;
}) {
  const plan = useMemo(() => result?.analysis.monitorPlan ?? [], [result]);
  const checks = useMemo(() => result?.analysis.checks ?? [], [result]);

  const [openRules, setOpenRules] = useState<string | null>(null);
  const [tick, setTick] = useState(() => Date.now());

  /* The countdowns are the only thing on this screen that changes without the
     server saying anything, so they get their own second hand. */
  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const armedById = useMemo(
    () => new Map((state?.armed ?? []).map((entry) => [entry.monitorId, entry])),
    [state?.armed],
  );

  const checkById = useMemo(
    () => new Map(checks.map((check) => [check.id, check])),
    [checks],
  );

  /* Rules that ran but no monitor covers. Never inferred from the plan's absence
     alone — the reason is read off the check's own method, so the screen can say
     why a rule cannot be re-run instead of just leaving it out. */
  const unmonitorable = useMemo(() => {
    const covered = new Set(plan.flatMap((entry) => entry.checkIds));
    return checks.filter((check) => check.ran && !covered.has(check.id));
  }, [plan, checks]);

  const byPillar = useMemo(() => {
    const groups = new Map<Pillar, MonitorPlanEntry[]>();
    for (const entry of plan) {
      groups.set(entry.pillar, [...(groups.get(entry.pillar) ?? []), entry]);
    }
    return pillarOrder
      .filter((pillar) => groups.has(pillar))
      .map((pillar) => ({ pillar, monitors: groups.get(pillar) ?? [] }));
  }, [plan]);

  const intervalFor = useCallback(
    (entry: MonitorPlanEntry) =>
      armedById.get(entry.id)?.cadenceSeconds ?? chosen[entry.id] ?? entry.cadenceMinutes * 60,
    [armedById, chosen],
  );

  const armCommand = useCallback(
    (entry: MonitorPlanEntry) =>
      command({
        action: "arm",
        monitorId: entry.id,
        input,
        plan,
        cadenceSeconds: intervalFor(entry),
      }),
    [command, input, plan, intervalFor],
  );

  const toggle = useCallback(
    (entry: MonitorPlanEntry) =>
      armedById.has(entry.id)
        ? command({ action: "disarm", monitorId: entry.id })
        : armCommand(entry),
    [armedById, command, armCommand],
  );

  const changeInterval = useCallback(
    (entry: MonitorPlanEntry, seconds: number) => {
      setChosen((current) => ({ ...current, [entry.id]: seconds }));
      /* Only armed monitors have a schedule on the server to change. An unarmed
         row is configuration, and configuration does not need a round trip. */
      if (armedById.has(entry.id)) {
        void command({ action: "set_cadence", monitorId: entry.id, cadenceSeconds: seconds });
      }
    },
    [armedById, command, setChosen],
  );

  const armEverything = useCallback(
    () =>
      command({
        action: "arm_all",
        input,
        plan,
        cadences: Object.fromEntries(plan.map((entry) => [entry.id, intervalFor(entry)])),
      }),
    [command, input, plan, intervalFor],
  );

  if (!result) {
    return (
      <div className="report">
        <div className="report-col">
          <section className="chapter">
            <div className="ch-n">
              <em>Monitoring</em>
              <hr />
            </div>
            <h2>Nothing to watch yet</h2>
            <p className="lede">
              A monitor re-runs rules that a completed assessment proved it could run. Until one
              run has finished, there is no way to know which of your rules can be re-verified
              without asking a human for something — so this screen would be a list of guesses.
            </p>
            <div className="actions" style={{ marginTop: 26 }}>
              <button className="btn primary" type="button" onClick={onGoToAssessment}>
                Go to the assessment
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  const armedCount = state?.armed.length ?? 0;
  const totalRules = plan.reduce((sum, entry) => sum + entry.checkIds.length, 0);
  const armedRules = (state?.armed ?? []).reduce((sum, entry) => sum + entry.checkIds.length, 0);
  const monthly = (state?.armed ?? []).reduce(
    (sum, entry) => sum + requestsPerMonth(entry.cadenceSeconds, entry.checkIds.length),
    0,
  );
  /* A cycle executes the complete assessment even when only one monitor is due.
     Its full result is therefore the honest current report. Before the first
     cycle, the completed assessment is the clearly-labelled baseline. */
  const currentResult = state?.latestResult ?? result;

  return (
    <div className="report">
      <div className="report-col">
        {/* ---- I · the board ------------------------------------------- */}
        <section className="chapter">
          <div className="ch-n">
            <em>Monitoring · I</em>
            <hr />
          </div>
          <h2>What is being watched</h2>
          <p className="lede">
            {armedCount
              ? `${armedCount} of ${plan.length} monitors armed, covering ${armedRules} of the ${totalRules} rules that can be re-run without asking anyone for anything. Each one is read on its own interval.`
              : `Nothing is armed. ${plan.length} monitors are available from the last run, covering ${totalRules} rules that can be re-run unattended.`}
          </p>

          <div className="stats" style={{ marginTop: 24 }}>
            <div className="stat">
              <em>Armed</em>
              <strong>
                {armedCount}/{plan.length}
              </strong>
              <p>{armedRules} rules on a schedule</p>
            </div>
            <div className="stat">
              <em>Cycles run</em>
              <strong>{state?.cyclesRun ?? 0}</strong>
              <p>
                {state?.lastCycleAt ? `last ${gap(tick, Date.parse(state.lastCycleAt))}` : "none yet"}
              </p>
            </div>
            <div className={`stat ${state?.alerts.length ? "fail" : "pass"}`}>
              <em>Standing alerts</em>
              <strong>{state?.alerts.length ?? 0}</strong>
              <p>regressions still open</p>
            </div>
            <div className="stat">
              <em>Next due</em>
              <strong style={{ fontSize: 19 }}>
                {state?.running
                  ? "running"
                  : state?.nextDueAt
                    ? gap(tick, Date.parse(state.nextDueAt))
                    : "—"}
              </strong>
              <p>{armedCount ? "earliest monitor on the board" : "nothing armed"}</p>
            </div>
            <div className="stat">
              <em>Requests / month</em>
              <strong>{monthly.toLocaleString()}</strong>
              <p>against your system, at these intervals</p>
            </div>
          </div>

          <div className="actions" style={{ marginTop: 20, flexWrap: "wrap", gap: 9 }}>
            <button
              className="btn primary sm"
              type="button"
              disabled={busy || !armedCount || state?.running}
              onClick={() => void command({ action: "cycle" })}
            >
              {state?.running ? "Cycle running…" : "Run a cycle now"}
            </button>
            <button className="btn sm" type="button" disabled={busy} onClick={() => void armEverything()}>
              Arm everything
            </button>
            <button
              className="btn sm"
              type="button"
              disabled={busy || !armedCount}
              onClick={() => void command({ action: "disarm_all" })}
            >
              Disarm everything
            </button>
            <span className="gap" />
            <button
              className="btn quiet sm"
              type="button"
              disabled={busy || !(state?.cycles.length ?? 0)}
              onClick={() => void command({ action: "clear_history" })}
            >
              Clear history
            </button>
          </div>

          {errors.length ? (
            <div className="because warn" style={{ marginTop: 18 }}>
              <i>▲</i>
              <span>
                {errors.map((message) => (
                  <span key={message} style={{ display: "block" }}>
                    {message}
                  </span>
                ))}
              </span>
            </div>
          ) : null}

          <div className="because" style={{ marginTop: 18 }}>
            <i>◆</i>
            <span>
              {state?.credentialsHeld
                ? "This run's read-only tokens are held in the server's memory for as long as anything is armed, because a re-run needs the same access the first run had. Disarming everything drops them."
                : "No tokens are held. Arming a monitor puts this run's read-only tokens in the server's memory until you disarm."}
            </span>
          </div>
        </section>

        <div className={`monitor-report-source${state?.latestResult ? " current" : " baseline"}`}>
          <i>{state?.latestResult ? "LIVE" : "BASELINE"}</i>
          <span>
            <strong>
              {state?.latestResult
                ? `Latest complete cycle · ${clock(state.latestResult.generatedAt)}`
                : `Assessment baseline · ${clock(result.generatedAt)}`}
            </strong>
            <small>
              {state?.latestResult
                ? "All assessment rules were evaluated again; the five pillars and standards below are the current result."
                : "No monitoring cycle has completed yet. The same five pillars and standards from the assessment are shown until fresh evidence replaces them."}
            </small>
          </span>
        </div>

        <Report
          result={currentResult}
          coverageOnly
          onActiveChapter={ignoreReportAction}
          onPrint={ignoreReportAction}
          onExport={ignoreReportAction}
          onRerun={ignoreReportAction}
        />

        {/* ---- scheduling ------------------------------------------------ */}
        <section className="chapter">
          <div className="ch-n">
            <em>Scheduling</em>
            <hr />
          </div>
          <h2>What runs, and how often</h2>
          <p className="lede">
            One row per monitor, grouped by the area it answers for. Open a row to see the exact
            rules it re-runs. A cycle re-runs the whole assessment and then reads only the monitors
            whose interval has elapsed — so the tightest interval here sets how often your system
            is contacted, and every other row keeps its own reading schedule.
          </p>

          {byPillar.map(({ pillar, monitors }) => {
            const armedHere = monitors.filter((entry) => armedById.has(entry.id)).length;
            const statusHere = worstOf(
              monitors
                .map((entry) => armedById.get(entry.id)?.status)
                .filter((status): status is ControlStatus => Boolean(status)),
            );
            return (
              <div className="mon-group" key={pillar}>
                <div className="mon-group-h">
                  <i style={{ background: pillarHue(pillar) }} />
                  <strong>{pillarLabel(pillar)}</strong>
                  <span>
                    {armedHere}/{monitors.length} armed ·{" "}
                    {monitors.reduce((sum, entry) => sum + entry.checkIds.length, 0)} rules
                  </span>
                  {statusHere ? <Pill status={statusHere} /> : null}
                </div>

                {monitors.map((entry) => {
                  const armed = armedById.get(entry.id);
                  const seconds = intervalFor(entry);
                  const rules = entry.checkIds
                    .map((id) => checkById.get(id))
                    .filter((check): check is CheckExecution => Boolean(check));
                  const open = openRules === entry.id;
                  return (
                    <div className={`mon-row${armed ? " on" : ""}`} key={entry.id}>
                      <button
                        className={`switch mon-sw${armed ? " on" : ""}`}
                        type="button"
                        role="switch"
                        aria-checked={Boolean(armed)}
                        aria-label={`${armed ? "Disarm" : "Arm"} ${methodLabel(entry.method)} re-verification for ${pillarLabel(entry.pillar)}`}
                        disabled={busy}
                        onClick={() => void toggle(entry)}
                      >
                        <span className="knob" />
                      </button>

                      <div className="mon-body">
                        <div className="mon-t">
                          {/* What it does leads; the method key follows as a key. The
                              terminology rule in lib/terms.ts is that an identifier is
                              never renamed for display — so it is shown as one rather
                              than dressed up as a title. */}
                          <strong>{monitorTitle(entry.method)}</strong>
                          <em>
                            {entry.checkIds.length} rule{entry.checkIds.length === 1 ? "" : "s"}
                          </em>
                          {armed?.status ? <Pill status={armed.status} /> : null}
                        </div>
                        <p className="mono">{methodLabel(entry.method)}</p>

                        <div className="mon-meta">
                          <span>
                            {requestsPerMonth(seconds, entry.checkIds.length).toLocaleString()}{" "}
                            requests / month
                          </span>
                          <span>
                            run suggested {intervalLabel(entry.cadenceMinutes * 60).toLowerCase()}
                          </span>
                          {armed ? (
                            <>
                              <span>
                                {armed.lastReadAt
                                  ? `read ${gap(tick, Date.parse(armed.lastReadAt))}`
                                  : "never read"}
                              </span>
                              <span className={Date.parse(armed.nextDueAt) < tick ? "due" : undefined}>
                                due {gap(tick, Date.parse(armed.nextDueAt))}
                              </span>
                            </>
                          ) : null}
                        </div>

                        <button
                          className="mon-more"
                          type="button"
                          aria-expanded={open}
                          onClick={() => setOpenRules(open ? null : entry.id)}
                        >
                          {open ? "Hide" : "Show"} the {rules.length} rule
                          {rules.length === 1 ? "" : "s"} this re-runs
                        </button>

                        {open ? (
                          <div className="mon-rules">
                            {rules.map((check) => (
                              <div className={`mon-rule ${check.status}`} key={check.id}>
                                <Pill status={check.status} />
                                <span>
                                  <b>{check.title}</b>
                                  <small className="mono">{check.id}</small>
                                  <small>{check.rule.statement}</small>
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      <label className="mon-int">
                        <span>Interval</span>
                        <select
                          value={seconds}
                          disabled={busy}
                          onChange={(event) => changeInterval(entry, Number(event.target.value))}
                        >
                          {INTERVALS.filter(
                            (option) => option.seconds >= (state?.minCadenceSeconds ?? 60),
                          ).map((option) => (
                            <option key={option.seconds} value={option.seconds}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  );
                })}
              </div>
            );
          })}

          {unmonitorable.length ? (
            <details className="card disc" style={{ marginTop: 20 }}>
              <summary>
                <span className="sev">›</span>
                <span className="ti">
                  What cannot be put on a schedule
                  <small>
                    {unmonitorable.length} rule{unmonitorable.length === 1 ? "" : "s"} ran, but
                    re-running them needs a person
                  </small>
                </span>
              </summary>
              <div className="disc-body">
                <p className="lede" style={{ marginBottom: 14 }}>
                  These rules reached a verdict from something handed over once — a named
                  procedure, a declared scope answer. Re-running them on a timer would re-read the
                  same handover and report it as fresh evidence, which is worse than not
                  monitoring them at all.
                </p>
                <div className="mon-rules">
                  {unmonitorable.map((check) => (
                    <div className={`mon-rule ${check.status}`} key={check.id}>
                      <Pill status={check.status} />
                      <span>
                        <b>{check.title}</b>
                        <small className="mono">{check.id}</small>
                        <small>{methodLabel(check.method)} — not re-runnable unattended</small>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </details>
          ) : null}
        </section>

        {/* ---- change history ------------------------------------------ */}
        <section className="chapter">
          <div className="ch-n">
            <em>Change history</em>
            <hr />
          </div>
          <h2>What has changed since</h2>
          <p className="lede">
            The report the assessment produced was true on the day it was collected. This is the
            part that keeps score: every reading that moved, which way it moved, and the evidence
            on both sides of the move. A regression stands as an alert until a later reading clears
            it. An improvement is reported as an improvement and never as an alert.
          </p>

          <PillarBoard armed={state?.armed ?? []} tick={tick} />

          {state?.alerts.length ? (
            <>
              <h3 className="mon-h3">Standing alerts</h3>
              <div className="cards">
                {state.alerts.map((alert) => (
                  <DriftCard key={`${alert.checkId}-${alert.at}`} entry={alert} />
                ))}
              </div>
            </>
          ) : (
            <div className="because" style={{ marginTop: 22 }}>
              <i>✓</i>
              <span>
                {state?.cyclesRun
                  ? `No regression is standing across ${state.cyclesRun} cycle${state.cyclesRun === 1 ? "" : "s"}. Every reading is at or above where it was.`
                  : "No cycle has run yet, so there is nothing to compare against. The first cycle establishes the baseline and raises no alerts."}
              </span>
            </div>
          )}

          <h3 className="mon-h3">Cycle history</h3>
          {state?.cycles.length ? (
            <div className="cards">
              {state.cycles.map((cycle) => (
                <details className="card disc" key={cycle.id}>
                  <summary>
                    <span className="sev">{cycle.error ? "▲" : cycle.drift.length ? "◆" : "✓"}</span>
                    <span className="ti">
                      Cycle {cycle.sequence} · {clock(cycle.at)}
                      <small>
                        {cycle.error
                          ? cycle.error
                          : `${cycle.trigger === "manual" ? "run by hand" : "fell due"} · read ${cycle.monitors.length} monitor${cycle.monitors.length === 1 ? "" : "s"} · ${cycle.readings.length} rules · ${duration(cycle.durationMs)}`}
                      </small>
                    </span>
                    <span className="rt">
                      {cycle.drift.length
                        ? `${cycle.drift.length} change${cycle.drift.length === 1 ? "" : "s"}`
                        : "no change"}
                    </span>
                  </summary>
                  <div className="disc-body">
                    <div className="mon-cyc">
                      {cycle.monitors.map((monitor) => (
                        <span key={monitor.monitorId}>
                          <i style={{ background: pillarHue(monitor.pillar) }} />
                          <Pill status={monitor.status} />
                          {monitor.label}
                          <em>{monitor.checksRead} read</em>
                        </span>
                      ))}
                    </div>
                    {cycle.drift.length ? (
                      <div className="cards" style={{ marginTop: 14 }}>
                        {cycle.drift.map((entry) => (
                          <DriftCard key={`${cycle.id}-${entry.checkId}`} entry={entry} />
                        ))}
                      </div>
                    ) : (
                      <p className="faint" style={{ fontSize: 13, marginTop: 12 }}>
                        Every rule this cycle read came back exactly as it did last time, evidence
                        included.
                      </p>
                    )}
                  </div>
                </details>
              ))}
            </div>
          ) : (
            <p className="faint" style={{ fontSize: 13.5, marginTop: 12 }}>
              No cycle has run. Arm a monitor and either wait for its interval or run one by hand.
            </p>
          )}

          {state?.note ? (
            <div className="because" style={{ marginTop: 24 }}>
              <i>◆</i>
              <span>{state.note}</span>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

/* ---- pieces ------------------------------------------------------------- */

/** Where each area currently stands, from its armed monitors' last readings. */
function PillarBoard({ armed, tick }: { armed: ArmedMonitor[]; tick: number }) {
  const rows = pillarOrder.map((pillar) => {
    const mine = armed.filter((entry) => entry.pillar === pillar);
    const read = mine.filter((entry) => entry.lastReadAt);
    const status = worstOf(
      read.map((entry) => entry.status).filter((value): value is ControlStatus => Boolean(value)),
    );
    const newest = read
      .map((entry) => Date.parse(entry.lastReadAt as string))
      .sort((left, right) => right - left)[0];
    return { pillar, monitors: mine.length, read: read.length, status, newest };
  });

  return (
    <div className="sh-cells" style={{ marginTop: 22 }}>
      {rows.map((row) => (
        <div className="sh-cell" key={row.pillar}>
          <span className="sh-cell-h">
            <i style={{ background: pillarHue(row.pillar) }} />
            {pillarLabel(row.pillar)}
          </span>
          <b>{row.status ? <Pill status={row.status} /> : row.monitors ? "not read yet" : "not armed"}</b>
          {row.monitors ? (
            <Meter
              percent={(row.read / row.monitors) * 100}
              hue={
                row.status === "fail"
                  ? "var(--fail)"
                  : row.status === "partial"
                    ? "var(--partial)"
                    : "var(--pass)"
              }
            />
          ) : (
            <div className="area-bar void" />
          )}
          <small className="faint" style={{ fontSize: 11.5 }}>
            {row.monitors
              ? `${row.read}/${row.monitors} monitors read${row.newest ? ` · ${gap(tick, row.newest)}` : ""}`
              : "no monitor covers this area"}
          </small>
        </div>
      ))}
    </div>
  );
}

/** One movement in one rule, with the evidence on both sides of it. */
function DriftCard({ entry }: { entry: DriftEntry }) {
  const word =
    entry.direction === "regression"
      ? "Regression"
      : entry.direction === "improvement"
        ? "Improvement"
        : "Same verdict, new evidence";
  return (
    <div className={`mon-drift ${entry.direction}`}>
      <div className="mon-drift-h">
        <i style={{ background: pillarHue(entry.pillar) }} />
        <strong>{entry.title}</strong>
        <span className="mon-drift-w">{word}</span>
      </div>
      <div className="mon-drift-move">
        <Pill status={entry.from} />
        <span aria-hidden="true">→</span>
        <Pill status={entry.to} />
        <em>
          {pillarLabel(entry.pillar)} · {clock(entry.at)}
        </em>
      </div>
      <p>{entry.detail}</p>
      <div className="mon-drift-ev">
        <div>
          <em>Before</em>
          <span>{entry.previousEvidence}</span>
        </div>
        <div>
          <em>Now</em>
          <span>{entry.currentEvidence}</span>
        </div>
      </div>
    </div>
  );
}
