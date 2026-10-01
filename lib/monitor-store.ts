/**
 * Continuous monitoring: the part that actually runs.
 *
 * A one-off assessment is a photograph. A monitor is the claim that the photograph
 * is still true, and that claim can only be made by going and looking again. This
 * module holds the three things that turns a derived plan into a working monitor:
 *
 * 1. **The input to re-run with.** A scheduled re-verification needs the same
 *    endpoints and the same read-only tokens the first run used. They are held in
 *    this process's memory for exactly as long as at least one monitor is armed,
 *    are never serialised into any response, log, event or export, and are dropped
 *    the moment the last monitor is disarmed. That is a real change in the build's
 *    security posture, so `credentialsHeld` is reported on every read and the UI
 *    states it at the point of arming rather than in a footnote.
 *
 * 2. **History.** Cycles are kept newest-first and capped. Nothing is written to
 *    disk, so a server restart is an honest reset, not a silent gap.
 *
 * 3. **Drift.** The difference between the newest reading of a check and the last
 *    reading before it. A status that got worse is a regression and becomes an
 *    alert; a status that got better is an improvement and is reported as one;
 *    identical statuses with different evidence are neither, and are labelled as
 *    such rather than dressed up as change.
 *
 * A cycle re-runs the assessment in full and then attributes the resulting check
 * verdicts to the armed monitors. Re-running only a subset would be cheaper and
 * would mean a monitor's verdict came from a different code path than the run it
 * claims to be re-verifying — the drift would then be partly our own artefact.
 */

import { runAssessment } from "./assessment";
import type {
  AccessTier,
  AssessmentInput,
  AssessmentResult,
  ControlStatus,
  MonitorPlanEntry,
  Pillar,
} from "./types";

const MAX_CYCLES = 24;

/** Lowest tolerable spacing between cycles. A monitor is not a load generator. */
const MIN_CADENCE_SECONDS = 60;

export interface MonitorCheckReading {
  checkId: string;
  title: string;
  status: ControlStatus;
  evidence: string;
  confidence: number;
}

export type DriftDirection = "regression" | "improvement" | "evidence_changed";

export interface DriftEntry {
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

export interface MonitorCycle {
  id: string;
  sequence: number;
  at: string;
  trigger: "manual" | "due";
  tier: AccessTier;
  durationMs: number;
  monitors: Array<{
    monitorId: string;
    label: string;
    pillar: Pillar;
    status: ControlStatus;
    checksRead: number;
  }>;
  readings: MonitorCheckReading[];
  drift: DriftEntry[];
  error?: string;
}

export interface ArmedMonitor {
  monitorId: string;
  label: string;
  pillar: Pillar;
  cadenceSeconds: number;
  declaredCadence: string;
  checkIds: string[];
  armedAt: string;
  /** When this monitor was last actually read. Null until its first reading. */
  lastReadAt: string | null;
  /** When it is next due on its own interval — not the run's, not the tightest one. */
  nextDueAt: string;
  /** Worst status across its checks as of `lastReadAt`. Null until then. */
  status: ControlStatus | null;
  /** How many of its checks the last reading actually reached. */
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
  /** The floor the store clamps every interval to. The UI offers nothing below it. */
  minCadenceSeconds: number;
  /** Every regression still standing, newest first. Improvements are not alerts. */
  alerts: DriftEntry[];
  /** The complete deterministic report produced by the newest successful cycle. */
  latestResult: AssessmentResult | null;
  note: string;
}

/**
 * An armed monitor as the store holds it.
 *
 * `lastReadMs` is the whole reason this is a separate shape from `ArmedMonitor`: a
 * monitor's interval is meaningless unless the interval is measured from the last
 * time *that* monitor was read. Measuring from the last cycle instead makes every
 * interval collapse to the tightest one on the board.
 */
interface ArmedRecord {
  monitorId: string;
  label: string;
  pillar: Pillar;
  cadenceSeconds: number;
  declaredCadence: string;
  checkIds: string[];
  armedAt: string;
  lastReadMs: number | null;
  status: ControlStatus | null;
  checksRead: number;
}

interface Store {
  input: AssessmentInput | null;
  plan: MonitorPlanEntry[];
  armed: Map<string, ArmedRecord>;
  cycles: MonitorCycle[];
  cyclesRun: number;
  running: boolean;
  lastCycleAt: number | null;
  latestResult: AssessmentResult | null;
}

const store: Store = {
  input: null,
  plan: [],
  armed: new Map(),
  cycles: [],
  cyclesRun: 0,
  running: false,
  lastCycleAt: null,
  latestResult: null,
};

/** Worse is higher. Used only to decide whether a change is a regression. */
const SEVERITY_OF_STATUS: Record<ControlStatus, number> = {
  pass: 0,
  not_applicable: 0,
  not_assessed: 1,
  partial: 2,
  fail: 3,
};

function cadenceFor(entry: MonitorPlanEntry, requested?: number): number {
  const asked = requested ?? entry.cadenceMinutes * 60;
  return Math.max(MIN_CADENCE_SECONDS, Math.round(asked));
}

/**
 * When a single monitor is next due.
 *
 * A monitor that has never been read is due immediately: the first reading is the
 * baseline every later comparison is made against, and delaying it by a full
 * interval would mean the first drift report could not arrive for two intervals.
 */
function dueAtMs(entry: ArmedRecord): number {
  if (entry.lastReadMs === null) return Date.parse(entry.armedAt);
  return entry.lastReadMs + entry.cadenceSeconds * 1000;
}

/** The earliest moment any armed monitor wants attention. */
function nextDueMs(): number | null {
  if (!store.armed.size) return null;
  return Math.min(...[...store.armed.values()].map(dueAtMs));
}

/** The monitors whose own interval has elapsed as of `nowMs`. */
function dueMonitors(nowMs: number): ArmedRecord[] {
  return [...store.armed.values()].filter((entry) => dueAtMs(entry) <= nowMs);
}

function publicView(entry: ArmedRecord): ArmedMonitor {
  return {
    monitorId: entry.monitorId,
    label: entry.label,
    pillar: entry.pillar,
    cadenceSeconds: entry.cadenceSeconds,
    declaredCadence: entry.declaredCadence,
    checkIds: entry.checkIds,
    armedAt: entry.armedAt,
    lastReadAt: entry.lastReadMs === null ? null : new Date(entry.lastReadMs).toISOString(),
    nextDueAt: new Date(dueAtMs(entry)).toISOString(),
    status: entry.status,
    checksRead: entry.checksRead,
  };
}

/**
 * The last reading of this check before the cycle being built. Searching backwards
 * through history rather than only the previous cycle matters: a check that could
 * not be read in one cycle should be compared against the last time it *was* read,
 * not treated as a fresh observation with no past.
 */
function previousReading(checkId: string): MonitorCheckReading | null {
  for (const cycle of store.cycles) {
    const reading = cycle.readings.find((entry) => entry.checkId === checkId);
    if (reading) return reading;
  }
  return null;
}

function driftFor(
  readings: MonitorCheckReading[],
  result: AssessmentResult,
  at: string,
): DriftEntry[] {
  const drift: DriftEntry[] = [];
  for (const reading of readings) {
    const previous = previousReading(reading.checkId);
    if (!previous) continue;
    const check = result.analysis.checks.find((entry) => entry.id === reading.checkId);
    const statusChanged = previous.status !== reading.status;
    const evidenceChanged = previous.evidence !== reading.evidence;
    if (!statusChanged && !evidenceChanged) continue;
    const worse = SEVERITY_OF_STATUS[reading.status] > SEVERITY_OF_STATUS[previous.status];
    const direction: DriftDirection = !statusChanged
      ? "evidence_changed"
      : worse
        ? "regression"
        : "improvement";
    drift.push({
      checkId: reading.checkId,
      title: reading.title,
      monitorIds: [...store.armed.values()]
        .filter((entry) => entry.checkIds.includes(reading.checkId))
        .map((entry) => entry.monitorId),
      pillar: check?.pillar ?? "governance",
      from: previous.status,
      to: reading.status,
      direction,
      detail: statusChanged
        ? `${reading.title} moved from ${previous.status} to ${reading.status} between cycles.`
        : `${reading.title} still reads ${reading.status}, but the evidence behind it changed.`,
      previousEvidence: previous.evidence,
      currentEvidence: reading.evidence,
      at,
    });
  }
  const rank: Record<DriftDirection, number> = {
    regression: 0,
    improvement: 1,
    evidence_changed: 2,
  };
  return drift.sort((left, right) => rank[left.direction] - rank[right.direction]);
}

export function armMonitor(
  monitorId: string,
  input: AssessmentInput,
  plan: MonitorPlanEntry[],
  cadenceSeconds?: number,
): { ok: boolean; error?: string } {
  const entry = plan.find((item) => item.id === monitorId);
  if (!entry) return { ok: false, error: `No monitor in the plan with id ${monitorId}.` };
  store.plan = plan;
  // Held only while something is armed. Replaced on every arm so a re-armed monitor
  // uses the credentials the operator most recently supplied, not a stale copy.
  store.input = input;
  // Re-arming an already-armed monitor changes its settings; it does not erase what
  // it has already read. Resetting the clock here would make `arm_all` silently
  // destroy the baseline of every monitor that was already running.
  const existing = store.armed.get(monitorId);
  store.armed.set(monitorId, {
    monitorId,
    label: entry.label,
    pillar: entry.pillar,
    cadenceSeconds: cadenceFor(entry, cadenceSeconds),
    declaredCadence: entry.cadence,
    checkIds: entry.checkIds,
    armedAt: existing?.armedAt ?? new Date().toISOString(),
    lastReadMs: existing?.lastReadMs ?? null,
    status: existing?.status ?? null,
    checksRead: existing?.checksRead ?? 0,
  });
  return { ok: true };
}

/**
 * Change an armed monitor's interval without re-arming it.
 *
 * Re-arming would work, but it needs the credentials in the request body, which
 * means changing a dropdown would put tokens back on the wire for no reason.
 */
export function setCadence(
  monitorId: string,
  cadenceSeconds: number,
): { ok: boolean; error?: string } {
  const record = store.armed.get(monitorId);
  if (!record) return { ok: false, error: `Monitor ${monitorId} is not armed.` };
  if (!Number.isFinite(cadenceSeconds)) return { ok: false, error: "The interval must be a number of seconds." };
  record.cadenceSeconds = Math.max(MIN_CADENCE_SECONDS, Math.round(cadenceSeconds));
  return { ok: true };
}

/**
 * Arm several monitors at once — the whole plan, or the subset named by `monitorIds`.
 *
 * Nine monitors armed one switch at a time is nine round trips and nine chances to end up
 * half-armed, which is a worse state than either extreme: the screen would show cycles
 * running while most of what the run assessed goes unwatched. `plan` stays the whole plan
 * whichever subset is being armed, so an armed monitor is always defined against the run
 * that produced it.
 */
export function armAll(
  input: AssessmentInput,
  plan: MonitorPlanEntry[],
  cadenceSeconds?: number,
  monitorIds?: string[],
  /** Per-monitor intervals, so arming the board in one call keeps each row's own
   *  setting instead of flattening nine configured intervals into one. */
  cadences?: Record<string, number>,
): { ok: boolean; error?: string; armed: number } {
  const wanted = monitorIds?.length
    ? plan.filter((entry) => monitorIds.includes(entry.id))
    : plan;
  if (!wanted.length) return { ok: false, error: "No monitor in the plan to arm.", armed: 0 };
  const alreadyArmed = new Set(store.armed.keys());
  for (const entry of wanted) {
    const armed = armMonitor(entry.id, input, plan, cadences?.[entry.id] ?? cadenceSeconds);
    if (!armed.ok) {
      // All or nothing for this call, without disturbing whatever was armed before it.
      for (const id of wanted.map((item) => item.id)) {
        if (!alreadyArmed.has(id)) disarmMonitor(id);
      }
      return { ok: false, error: armed.error, armed: 0 };
    }
  }
  return { ok: true, armed: wanted.length };
}

export function disarmMonitor(monitorId: string): { ok: boolean } {
  store.armed.delete(monitorId);
  if (!store.armed.size) {
    // Nothing is armed, so nothing needs the tokens. Dropping them here is the
    // whole reason arming is a deliberate act with a stated cost.
    store.input = null;
  }
  return { ok: true };
}

export function disarmAll(): { ok: boolean } {
  store.armed.clear();
  store.input = null;
  return { ok: true };
}

/** Forget the history too. Separate from disarming: an operator may want one, not both. */
export function clearHistory(): { ok: boolean } {
  store.cycles = [];
  store.cyclesRun = 0;
  store.lastCycleAt = null;
  store.latestResult = null;
  return { ok: true };
}

export async function runCycle(
  trigger: MonitorCycle["trigger"],
): Promise<{ ok: boolean; error?: string }> {
  if (!store.armed.size) return { ok: false, error: "No monitor is armed." };
  if (!store.input) return { ok: false, error: "No credentials are held; re-arm the monitor." };
  if (store.running) return { ok: false, error: "A cycle is already running." };

  const startedMs = Date.now();
  /*
   * Who this cycle is for, decided before the assessment starts rather than after.
   *
   * A manual cycle is an operator asking for a reading now, so it reads everything
   * armed. A due cycle reads only the monitors whose own interval has elapsed —
   * that is the whole difference between per-monitor intervals meaning something
   * and every interval collapsing to the tightest one on the board. Deciding the
   * set up front also stops a monitor becoming due *during* the run and then being
   * marked read against evidence collected before it was due.
   */
  const reading = trigger === "manual" ? [...store.armed.values()] : dueMonitors(startedMs);
  if (!reading.length) return { ok: false, error: "No monitor is due yet." };

  store.running = true;
  const at = new Date().toISOString();
  const sequence = store.cyclesRun + 1;
  try {
    const result = await runAssessment(store.input, () => undefined, { eventDelayMs: 0 });
    const watched = new Set(reading.flatMap((entry) => entry.checkIds));
    const readings: MonitorCheckReading[] = result.analysis.checks
      .filter((check) => watched.has(check.id))
      .map((check) => ({
        checkId: check.id,
        title: check.title,
        status: check.status,
        evidence: check.evidence,
        confidence: check.confidence,
      }));
    const drift = driftFor(readings, result, at);
    const readMs = Date.now();
    const monitors = reading.map((entry) => {
      const mine = readings.filter((item) => entry.checkIds.includes(item.checkId));
      const worst = mine.reduce<ControlStatus>(
        (acc, item) =>
          SEVERITY_OF_STATUS[item.status] > SEVERITY_OF_STATUS[acc] ? item.status : acc,
        "pass",
      );
      const status = mine.length ? worst : ("not_assessed" as ControlStatus);
      /* A monitor's clock advances only when the monitor was actually read, so a
         monitor left out of this cycle stays due instead of silently slipping an
         interval. */
      entry.lastReadMs = readMs;
      entry.status = status;
      entry.checksRead = mine.length;
      return {
        monitorId: entry.monitorId,
        label: entry.label,
        pillar: entry.pillar,
        status,
        checksRead: mine.length,
      };
    });
    store.cycles = [
      {
        id: `cyc-${sequence}`,
        sequence,
        at,
        trigger,
        tier: store.input.tier,
        durationMs: Date.now() - startedMs,
        monitors,
        readings,
        drift,
      },
      ...store.cycles,
    ].slice(0, MAX_CYCLES);
    store.cyclesRun = sequence;
    store.lastCycleAt = Date.now();
    /* AssessmentResult deliberately contains collected evidence and verdicts but
       never the input credentials. Keeping it lets the monitoring surface show
       the same five-pillar and pack report as the assessment instead of reducing
       a full run to nine monitor badges. */
    store.latestResult = result;
    return { ok: true };
  } catch (error) {
    // A failed cycle is recorded, not swallowed. A monitor that cannot reach the
    // target is itself a finding about the target, and silence would hide it.
    store.cycles = [
      {
        id: `cyc-${sequence}`,
        sequence,
        at,
        trigger,
        tier: store.input.tier,
        durationMs: Date.now() - startedMs,
        monitors: [],
        readings: [],
        drift: [],
        error: error instanceof Error ? error.message : "The cycle failed for an unknown reason.",
      },
      ...store.cycles,
    ].slice(0, MAX_CYCLES);
    store.cyclesRun = sequence;
    store.lastCycleAt = Date.now();
    return { ok: false, error: error instanceof Error ? error.message : "Cycle failed." };
  } finally {
    store.running = false;
  }
}

/**
 * Run a cycle if one is due. Called on every read of the monitor state, which makes
 * the schedule self-healing without a background worker: whenever anyone is looking,
 * the cadence is honoured. Nobody looking for an hour means a late cycle, and the
 * state says when the last one actually ran rather than implying it kept up.
 */
export async function runDueCycle(): Promise<void> {
  const due = nextDueMs();
  if (due === null || store.running || Date.now() < due) return;
  await runCycle("due");
}

export function monitorState(): MonitorState {
  // An alert is a regression that still stands, not every regression that ever
  // happened: a control that broke and was fixed must stop shouting, or the panel
  // fills with alerts nobody can action. Cycles are newest first, so the first
  // status change seen for a check is its current one. An `evidence_changed` entry
  // is skipped here — the wording moved, the verdict did not.
  const decided = new Set<string>();
  const alerts: DriftEntry[] = [];
  for (const cycle of store.cycles) {
    for (const entry of cycle.drift) {
      if (entry.direction === "evidence_changed" || decided.has(entry.checkId)) continue;
      decided.add(entry.checkId);
      if (entry.direction === "regression") alerts.push(entry);
    }
  }
  const due = nextDueMs();
  return {
    armed: [...store.armed.values()].map(publicView),
    cycles: store.cycles,
    running: store.running,
    credentialsHeld: Boolean(store.input),
    nextDueAt: due === null ? null : new Date(due).toISOString(),
    lastCycleAt: store.lastCycleAt === null ? null : new Date(store.lastCycleAt).toISOString(),
    cyclesRun: store.cyclesRun,
    minCadenceSeconds: MIN_CADENCE_SECONDS,
    alerts,
    latestResult: store.latestResult,
    note:
      "Cycles run in this server process while the app is reachable, and history is held in " +
      "memory only. A restart resets it, which is reported as a reset rather than a gap. Each " +
      "monitor is read on its own interval, but a cycle re-runs the whole assessment — so the " +
      "tightest interval armed sets how often your system is contacted, for every monitor.",
  };
}

/** Test seam: drop every trace of a session, including held credentials. */
export function resetMonitorStore(): void {
  store.input = null;
  store.plan = [];
  store.armed.clear();
  store.cycles = [];
  store.cyclesRun = 0;
  store.running = false;
  store.lastCycleAt = null;
  store.latestResult = null;
}
