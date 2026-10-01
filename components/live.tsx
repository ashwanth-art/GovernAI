"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Ring } from "@/components/kit";
import { duration, estimate, requestPhrase } from "@/lib/metrics";
import { tierLabel } from "@/lib/terms";
import type { AssessmentInput, CheckPlan } from "@/lib/types";

export interface RunEvent {
  name: string;
  data: Record<string, unknown>;
}

/* ============================================================================
   The run
   ----------------------------------------------------------------------------
   The whole screen, because while it is running it is the only thing happening.

   Everything on it is read from the engine's own event stream. The percentage is
   the stream's weighted stage figure — each stage declares its share of expected
   elapsed time up front, so the bar tracks time rather than the engine's
   chattiness. The feed is the events themselves, in order. Nothing is simulated
   and nothing is smoothed: if the run is slow here, the screen is slow here.
   ========================================================================== */

/** What each stage is doing, said the way you would say it out loud. */
const PLAIN: Record<string, { now: string; sub: string }> = {
  reach: {
    now: "Asking your assistant questions",
    sub: "Bounded, read-only requests to the endpoint you named. Each answer is kept as evidence.",
  },
  map: {
    now: "Matching what we found to each rulebook",
    sub: "Every piece of evidence is bound to the controls it speaks to, in every pack you selected.",
  },
  evaluate: {
    now: "Applying each pass condition",
    sub: "One written rule at a time. No model decides any of these — each verdict is a predicate over the evidence.",
  },
  rollup: {
    now: "Adding it up",
    sub: "Aggregating by area, raising findings, settling the verdict.",
  },
};

interface Progress {
  percentage: number;
  stageId: string;
  stageLabel: string;
  stageCompleted: number;
  stageTotal: number;
  stages: Array<{ id: string; label: string; weight: number; unitTotal: number; unitsDone: number }>;
}

interface FeedControl {
  standardId: string;
  shortName: string;
  controlId: string;
  controlName: string;
}

interface FeedItem {
  key: string;
  status: string;
  text: string;
  detail?: string;
  ms?: number;
  live?: boolean;
  /* Everything below is what turns a one-line ticker into something a reader can
     audit: what the rule was looking for, where it looked, what it concluded, and
     which clause in which rulebook it just settled. */
  ran?: boolean;
  ruleId?: string;
  method?: string;
  pillar?: string;
  severity?: string;
  tierMinimum?: number;
  intent?: string;
  passWhen?: string;
  failWhen?: string;
  evidence?: string;
  endpoint?: string;
  notRunReason?: string;
  controls?: FeedControl[];
}

/** What the run screen is allowed to show at once. */
type FeedFilter = "all" | "ran" | "problems" | "blocked";

const FILTERS: Array<{ id: FeedFilter; label: string }> = [
  { id: "all", label: "Every rule" },
  { id: "ran", label: "Ran" },
  { id: "problems", label: "Problems" },
  { id: "blocked", label: "Out of reach" },
];

/* Keyed on CheckMethod exactly — see the same note in steps.tsx. */
const METHOD_LABEL: Record<string, string> = {
  live_probe: "live probe",
  adapter_read: "config read",
  provider_api: "provider read",
  named_artifact: "evidence record",
  not_supported: "not testable",
};

function matchesFilter(item: FeedItem, filter: FeedFilter): boolean {
  if (filter === "all") return true;
  if (filter === "blocked") return item.ran === false;
  if (filter === "ran") return item.ran !== false;
  return item.ran !== false && (item.status === "fail" || item.status === "partial");
}

/** One row per standard, so a reader sees "GDPR Art. 32(1)(b)" rather than a count. */
function groupByStandard(
  controls: FeedControl[] | undefined,
): Array<{ shortName: string; controls: FeedControl[] }> {
  if (!controls?.length) return [];
  const order: string[] = [];
  const bucket = new Map<string, FeedControl[]>();
  for (const control of controls) {
    if (!bucket.has(control.shortName)) {
      bucket.set(control.shortName, []);
      order.push(control.shortName);
    }
    bucket.get(control.shortName)!.push(control);
  }
  return order.map((shortName) => ({ shortName, controls: bucket.get(shortName)! }));
}

const ICON: Record<string, string> = {
  pass: "✓",
  fail: "✕",
  partial: "◐",
  not_assessed: "○",
  not_applicable: "○",
  running: "◐",
};

const ICON_CLASS: Record<string, string> = {
  pass: "pass",
  fail: "fail",
  partial: "partial",
  not_assessed: "na",
  not_applicable: "na",
  running: "live",
};

export function LiveRun({
  events,
  running,
  failed,
  errors,
  startedAt,
  plan,
  input,
  hasResult,
  onStop,
  onSeeReport,
  onBack,
}: {
  events: RunEvent[];
  running: boolean;
  failed: boolean;
  errors: string[];
  startedAt: number | null;
  plan: CheckPlan | null;
  input: AssessmentInput;
  hasResult: boolean;
  onStop: () => void;
  onSeeReport: () => void;
  onBack: () => void;
}) {
  const feedRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState<number | null>(null);
  const [filter, setFilter] = useState<FeedFilter>("all");
  const [openRow, setOpenRow] = useState<string | null>(null);

  /* A local clock, because the reach stage can hold the stream open for eight
     seconds. Without it the elapsed figure freezes exactly when a reader is
     asking whether the run is slow or stuck. */
  useEffect(() => {
    if (!running) return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [running]);

  const last = events[events.length - 1];
  const progress = (last?.data.progress ?? null) as Progress | null;
  const startEvent = events.find((event) => event.name === "assessment_start");

  const elapsedMs = useMemo(() => {
    if (running && startedAt && now) return now - startedAt;
    const fromStream = Number(last?.data.elapsedMs);
    return Number.isFinite(fromStream) ? fromStream : 0;
  }, [running, startedAt, now, last]);

  const percent = failed
    ? (progress?.percentage ?? 0)
    : hasResult
      ? 100
      : (progress?.percentage ?? 0);

  /* The feed: every probe and every rule verdict, in the order they happened.
     Rules the depth could not reach used to be counted rather than listed, which
     on a Tier 1 run silently dropped 51 of 56 rules behind a single grey line —
     the reader could not see what was skipped, only that something was. They are
     rows now, carrying the reason, and the filter above decides what is on screen. */
  const { feed, skipped } = useMemo(() => {
    const items: FeedItem[] = [];
    let notRun = 0;
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      const data = event.data;
      if (event.name === "probe_complete") {
        items.push({
          key: `p${index}`,
          status: String(data.status ?? "pass"),
          text: String(data.control ?? "Probe"),
          detail: String(data.standard ?? ""),
          ms: Number(data.latencyMs) || undefined,
          ran: true,
          method: "live_probe",
        });
      } else if (event.name === "check_result") {
        const ran = data.ran !== false;
        if (!ran) notRun += 1;
        items.push({
          key: `c${index}`,
          status: String(data.status ?? "pass"),
          text: String(data.control ?? "Rule"),
          detail: String(data.ruleId ?? ""),
          ms: Number(data.latencyMs) || undefined,
          ran,
          ruleId: typeof data.ruleId === "string" ? data.ruleId : undefined,
          method: typeof data.method === "string" ? data.method : undefined,
          pillar: typeof data.pillar === "string" ? data.pillar : undefined,
          severity: typeof data.severity === "string" ? data.severity : undefined,
          tierMinimum: Number(data.tierMinimum) || undefined,
          intent: typeof data.intent === "string" ? data.intent : undefined,
          passWhen: typeof data.passWhen === "string" ? data.passWhen : undefined,
          failWhen: typeof data.failWhen === "string" ? data.failWhen : undefined,
          evidence: typeof data.evidence === "string" ? data.evidence : undefined,
          endpoint: typeof data.endpoint === "string" ? data.endpoint : undefined,
          notRunReason: typeof data.notRunReason === "string" ? data.notRunReason : undefined,
          controls: Array.isArray(data.controls) ? (data.controls as FeedControl[]) : undefined,
        });
      }
    }
    /* The rule currently being applied, shown once at the tail while it is in
       flight. It has no verdict yet, so it cannot be a feed row like the others. */
    if (running) {
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event.name === "check_result") break;
        if (event.name === "check_verifying") {
          items.push({
            key: `v${index}`,
            status: "running",
            text: String(event.data.control ?? "Rule"),
            detail: String(event.data.ruleId ?? ""),
            live: true,
          });
          break;
        }
      }
    }
    return { feed: items, skipped: notRun };
  }, [events, running]);

  const visible = useMemo(
    () => feed.filter((item) => matchesFilter(item, filter)),
    [feed, filter],
  );

  /* Follow the tail while the run is in flight, and stop following once it settles
     so a reader can scroll back through what happened without being yanked. Reading
     a detail pins the feed: yanking the list while someone is reading a rule they
     deliberately opened is the one moment auto-scroll is actively hostile. */
  useEffect(() => {
    if (!running || openRow) return;
    const node = feedRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [visible.length, running, openRow]);

  const stage = progress?.stageId ?? "reach";
  const plain = PLAIN[stage] ?? PLAIN.reach;
  const expectedSeconds = Number(startEvent?.data.estimatedSeconds) || plan?.estimatedSeconds || 0;
  const over = expectedSeconds > 0 && elapsedMs > expectedSeconds * 1000;

  if (failed) {
    return (
      <div className="run">
        <div className="run-col oops">
          <div className="ic">✕</div>
          <h2>The run stopped before it reached a verdict</h2>
          <p>
            Nothing was scored. A partial run produces no result — there is no half-assessment
            here, because a number built from an interrupted run would look exactly like a number
            built from a finished one.
          </p>
          {errors.length ? <div className="why">{errors.join("\n")}</div> : null}
          <div className="actions" style={{ justifyContent: "center" }}>
            <button className="btn primary" type="button" onClick={onBack}>
              Back to the plan
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="run">
      <div className="run-col">
        <Ring
          percent={percent}
          elapsed={duration(elapsedMs)}
          tone={hasResult ? "done" : "live"}
        />

        <div className="run-now">
          <strong>{hasResult ? "Done" : plain.now}</strong>
          <p>
            {hasResult
              ? `${requestPhrase(Number(startEvent?.data.boundedRequests ?? plan?.boundedRequests ?? 0))} sent · ${duration(elapsedMs)} · nothing written, nothing stored`
              : plain.sub}
          </p>
        </div>

        {progress?.stages?.length ? (
          <div className="segs">
            {progress.stages.map((entry) => {
              const done = entry.unitsDone >= entry.unitTotal;
              const isNow = entry.id === stage && !hasResult;
              return (
                <div className={`seg${isNow ? " now" : done ? " done" : ""}`} key={entry.id}>
                  <div className="bar">
                    <i
                      style={{
                        width: `${Math.min(100, (entry.unitsDone / Math.max(1, entry.unitTotal)) * 100)}%`,
                      }}
                    />
                  </div>
                  <div className="lb">
                    <b>{entry.label}</b>
                    <span className="c">
                      {entry.unitsDone}/{entry.unitTotal}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {feed.length ? (
          <>
            <div className="feed-bar">
              <div className="feed-tabs">
                {FILTERS.map((entry) => {
                  const count =
                    entry.id === "all"
                      ? feed.length
                      : feed.filter((item) => matchesFilter(item, entry.id)).length;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className={`feed-tab${filter === entry.id ? " on" : ""}`}
                      onClick={() => setFilter(entry.id)}
                    >
                      {entry.label} <b>{count}</b>
                    </button>
                  );
                })}
              </div>
              <span className="feed-hint">Click any rule to see what it checked</span>
            </div>

            <div className="feed" ref={feedRef}>
              {visible.map((item) => {
                const open = openRow === item.key;
                const grouped = groupByStandard(item.controls);
                return (
                  <div className={`feed-item${open ? " open" : ""}`} key={item.key}>
                    <button
                      type="button"
                      className={`feed-row${item.ran === false ? " dim" : ""}`}
                      onClick={() => setOpenRow(open ? null : item.key)}
                      aria-expanded={open}
                    >
                      <span className={`ic ${ICON_CLASS[item.status] ?? "na"}`}>
                        {ICON[item.status] ?? "○"}
                      </span>
                      <span className="tx">
                        {item.text}
                        <small>
                          {item.ruleId ? ` · ${item.ruleId}` : item.detail ? ` · ${item.detail}` : ""}
                          {item.method ? ` · ${METHOD_LABEL[item.method] ?? item.method}` : ""}
                          {item.controls?.length
                            ? ` · closes ${item.controls.length} control${item.controls.length === 1 ? "" : "s"} in ${grouped.length} standard${grouped.length === 1 ? "" : "s"}`
                            : ""}
                        </small>
                      </span>
                      <span className="ms">
                        {item.ran === false
                          ? `needs T${item.tierMinimum ?? "?"}`
                          : item.ms
                            ? `${item.ms}ms`
                            : item.live
                              ? ""
                              : "—"}
                      </span>
                    </button>

                    {open ? (
                      <div className="feed-detail">
                        {item.intent ? (
                          <p className="fd-intent">{item.intent}</p>
                        ) : null}
                        <dl className="fd-facts">
                          {item.endpoint ? (
                            <>
                              <dt>Where it looked</dt>
                              <dd className="mono">{item.endpoint}</dd>
                            </>
                          ) : null}
                          {item.passWhen ? (
                            <>
                              <dt>Passes when</dt>
                              <dd>{item.passWhen}</dd>
                            </>
                          ) : null}
                          {item.failWhen ? (
                            <>
                              <dt>Fails when</dt>
                              <dd>{item.failWhen}</dd>
                            </>
                          ) : null}
                          {item.ran === false && item.notRunReason ? (
                            <>
                              <dt>Why it did not run</dt>
                              <dd>{item.notRunReason}</dd>
                            </>
                          ) : null}
                          {item.ran !== false && item.evidence ? (
                            <>
                              <dt>What it found</dt>
                              <dd>{item.evidence}</dd>
                            </>
                          ) : null}
                        </dl>

                        {grouped.length ? (
                          <div className="fd-standards">
                            <span className="fd-lbl">
                              Controls this rule settles, per standard
                            </span>
                            {grouped.map((group) => (
                              <div className="fd-std" key={group.shortName}>
                                <b>{group.shortName}</b>
                                <span>
                                  {group.controls
                                    .map((control) => control.controlId)
                                    .join(" · ")}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {visible.length === 0 ? (
                <p className="faint" style={{ padding: "14px 4px", fontSize: 13 }}>
                  Nothing in this view yet.
                </p>
              ) : null}
            </div>
          </>
        ) : null}

        {skipped > 0 ? (
          <p className="faint" style={{ fontSize: 12.5, marginTop: 11 }}>
            {skipped} of {feed.length} rules could not be reached at {tierLabel(input.tier)}. They
            are listed above under <b>Out of reach</b>, each with the reason and the depth that
            would unlock it.
          </p>
        ) : null}

        {over && !hasResult ? (
          <p className="faint" style={{ fontSize: 12.5, marginTop: 11, color: "var(--partial)" }}>
            Running longer than the {estimate(expectedSeconds)} planned. Still in flight — the
            stage bar above shows where.
          </p>
        ) : null}

        <div className="promise">
          <i>✓</i>
          <span>
            Reads only · {requestPhrase(Number(startEvent?.data.boundedRequests ?? plan?.boundedRequests ?? 0))} ·
            nothing written to your system
          </span>
        </div>

        <div className="actions" style={{ justifyContent: "center", marginTop: 22 }}>
          {running ? (
            <button className="btn" type="button" onClick={onStop}>
              Stop the run
            </button>
          ) : hasResult ? (
            <button className="btn primary" type="button" onClick={onSeeReport}>
              Read the result <kbd>↵</kbd>
            </button>
          ) : (
            <button className="btn" type="button" onClick={onBack}>
              Back to the plan
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
