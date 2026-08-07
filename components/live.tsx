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

interface FeedItem {
  key: string;
  status: string;
  text: string;
  detail?: string;
  ms?: number;
  live?: boolean;
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

  /* The feed: probes and rule verdicts, in the order they happened, newest last.
     Rules the depth could not reach are counted rather than listed — 51 rows of
     not_assessed would bury the five verdicts that were actually reached. */
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
        });
      } else if (event.name === "check_result") {
        if (data.ran === false) {
          notRun += 1;
          continue;
        }
        items.push({
          key: `c${index}`,
          status: String(data.status ?? "pass"),
          text: String(data.control ?? "Rule"),
          detail: String(data.ruleId ?? ""),
          ms: Number(data.latencyMs) || undefined,
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

  /* Follow the tail while the run is in flight, and stop following once it settles
     so a reader can scroll back through what happened without being yanked. */
  useEffect(() => {
    if (!running) return;
    const node = feedRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [feed.length, running]);

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
          <div className="feed" ref={feedRef}>
            {feed.map((item) => (
              <div className="feed-row" key={item.key}>
                <span className={`ic ${ICON_CLASS[item.status] ?? "na"}`}>
                  {ICON[item.status] ?? "○"}
                </span>
                <span className="tx">
                  {item.text}
                  {item.detail ? <small> · {item.detail}</small> : null}
                </span>
                <span className="ms">{item.ms ? `${item.ms}ms` : item.live ? "" : "—"}</span>
              </div>
            ))}
          </div>
        ) : null}

        {skipped > 0 ? (
          <p className="faint" style={{ fontSize: 12.5, marginTop: 11 }}>
            {skipped} rules could not be reached at {tierLabel(input.tier)} and are not listed here.
            Each one is reported with its reason in the result.
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
