"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LiveRun, type RunEvent } from "@/components/live";
import { Monitoring, useMonitors } from "@/components/monitor";
import { CHAPTERS, Report } from "@/components/report";
import {
  receiptFor,
  Step,
  STEP_TITLE,
  trackFor,
  type PreflightState,
  type ScopeResult,
  type StepId,
} from "@/components/steps";
import { defaultApplicabilityProfile, validateApplicability } from "@/lib/applicability";
import { credentialFields } from "@/lib/assessment";
import { estimate } from "@/lib/metrics";
import { accessSignalsFromCredentials } from "@/lib/plan";
import { createReportHtml } from "@/lib/report-html";
import type { AssessmentInput, AssessmentResult, CheckPlan } from "@/lib/types";

/**
 * Public demo endpoints and context labels are convenient starting values. Password
 * fields contain visibly masked, non-authorized placeholders so the form can be
 * demonstrated without embedding a real access token in the client bundle. An
 * operator replaces them with their own read-only credentials for authenticated
 * Tier 2 or Tier 3 evidence collection.
 */
const DEMO_CREDENTIALS: Record<string, string> = {
  chatbotEndpoint: "https://chat-bot-22j5.onrender.com/",
  tenantId: "aci-infotech",
  chatbotApiKey: "demo-placeholder-chatbot-key",
  cloudProvider: "Render",
  cloudApiKey: "demo-placeholder-audit-key",
  monitoringProvider: "Prometheus",
  monitoringApiKey: "demo-placeholder-monitoring-key",
  cicdUrl: "https://github.com/ashwanth-art/chat_bot/actions",
  repoUrl: "https://github.com/ashwanth-art/chat_bot",
  stagingUrl: "https://chat-bot-22j5.onrender.com/",
  modelRegistryUrl: "https://platform.openai.com/docs/models",
  evidenceManifestUrl: "https://chat-bot-22j5.onrender.com/api/evidence/manifest",
  // The manifest sits behind the audit key rather than a credential of its own.
  evidenceManifestToken: "demo-placeholder-evidence-token",
  githubToken: "demo-placeholder-github-token",
  providerMonitoringApiKey: "demo-placeholder-provider-monitoring-key",
  monitoringApplicationKey: "demo-placeholder-monitoring-app-key",
};

const startingInput: AssessmentInput = {
  organization: "ACI Infotech",
  systemName: "ACI Knowledge Assistant",
  industryId: "finance",
  standardIds: ["mas_ai", "soc2", "iso42001"],
  tier: 1,
  applicability: {
    ...defaultApplicabilityProfile,
    hipaaRole: "not_regulated",
    euTerritorialScope: "out_of_scope",
    euRole: "provider",
    euRiskClass: "limited_or_minimal",
    directHumanInteraction: true,
  },
  credentials: { ...DEMO_CREDENTIALS },
  architecture: {
    modelProvider: "OpenAI",
    modelName: "gpt-5.6-sol",
    vectorDatabase: "MongoDB Atlas Vector Search",
    embeddingModel: "text-embedding-3-small",
  },
};

function parseEventBlock(block: string) {
  let name = "message";
  let data = "";
  block.split("\n").forEach((line) => {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    if (line.startsWith("data:")) data += line.slice(5).trim();
  });
  return { name, data: data ? JSON.parse(data) : null };
}

/**
 * How many events the browser keeps.
 *
 * There has to be a cap, but a plain ring buffer evicts the structural events the
 * screens are built from — a run emits one event per control, so past a few hundred
 * selected controls the buffer silently dropped `assessment_start` and the run
 * screen lost its stage rail on a run that was working perfectly. The cap is
 * selective instead: structural events are never evicted, and the rolling window
 * applies only to the repetitive ones.
 */
const EVENT_WINDOW = 900;

const PINNED_EVENTS = new Set([
  "assessment_start",
  "stage_start",
  "pillar_progress",
  "posture_update",
  "execution_summary",
  "assessment_error",
]);

function appendEvent(current: RunEvent[], next: RunEvent): RunEvent[] {
  const appended = [...current, next];
  if (appended.length <= EVENT_WINDOW) return appended;
  let toDrop = appended.length - EVENT_WINDOW;
  const kept: RunEvent[] = [];
  for (const event of appended) {
    if (toDrop > 0 && !PINNED_EVENTS.has(event.name)) {
      toDrop -= 1;
      continue;
    }
    kept.push(event);
  }
  return kept;
}

type Phase = "setup" | "run" | "report";

/**
 * The two top-level surfaces.
 *
 * Monitoring is a tab rather than a chapter of the report because it answers a
 * different question on a different clock: the report is a statement about a
 * moment, the monitor is a standing claim that the moment still holds. Folding it
 * into the report would also mean it only existed while a report was on screen,
 * and a schedule that stops when you navigate away is not a schedule.
 */
type View = "assess" | "monitor";

export function AssessmentWorkspace() {
  const [view, setView] = useState<View>("assess");
  const [phase, setPhase] = useState<Phase>("setup");
  const [at, setAt] = useState(0);
  const [reached, setReached] = useState(0);
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [input, setInput] = useState<AssessmentInput>(startingInput);
  const [errors, setErrors] = useState<string[]>([]);
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [scope, setScope] = useState<ScopeResult | null>(null);
  const [plan, setPlan] = useState<CheckPlan | null>(null);
  const [preflight, setPreflight] = useState<PreflightState | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [chapter, setChapter] = useState<string>(CHAPTERS[0].id);
  const stageRef = useRef<HTMLDivElement>(null);
  const trailRef = useRef<HTMLDivElement>(null);
  /* Held so a run can be stopped. A stream the reader has abandoned still holds a
     connection open and still issues the requests it was going to issue — a stop
     button that only hides the screen is not a stop button. */
  const abortRef = useRef<AbortController | null>(null);

  const track = useMemo(() => trackFor(input), [input]);
  const step: StepId = track[Math.min(at, track.length - 1)] ?? "system";

  /* Mounted here, not inside the monitoring screen: this build runs a due cycle when
     the state is read, so the poll has to survive switching back to the assessment. */
  const monitors = useMonitors();

  /* ---- the form, kept across reloads ------------------------------------ */

  useEffect(() => {
    /* Fired from a task rather than the effect body: sessionStorage is client-only,
       so this cannot run during the server render, and a synchronous setState here
       would cascade. */
    const task = window.setTimeout(() => {
      try {
        const saved = window.sessionStorage.getItem("governai.setup");
        if (!saved) return;
        const parsed = JSON.parse(saved) as Partial<AssessmentInput>;
        setInput((current) => ({
          ...current,
          ...parsed,
          // Never restored from storage, by design.
          credentials: current.credentials,
        }));
      } catch {
        /* A corrupt or unavailable store is not worth surfacing — the defaults are fine. */
      }
    }, 0);
    return () => window.clearTimeout(task);
  }, []);

  useEffect(() => {
    try {
      const persisted: Partial<AssessmentInput> = { ...input };
      delete persisted.credentials;
      window.sessionStorage.setItem("governai.setup", JSON.stringify(persisted));
    } catch {
      /* Private browsing and full quotas both land here. Nothing depends on it. */
    }
  }, [input]);

  /* ---- editing ---------------------------------------------------------- */

  const patch = useCallback((next: Partial<AssessmentInput>) => {
    setInput((current) => ({ ...current, ...next }));
    setErrors([]);
    setScope(null);
    setPlan(null);
    /* Changing the depth changes which locations a run reads, so a pre-flight taken
       against the old depth is no longer about the run that would happen. */
    if (next.tier !== undefined) setPreflight(null);
  }, []);

  const patchCredential = useCallback((key: string, value: string) => {
    setInput((current) => ({ ...current, credentials: { ...current.credentials, [key]: value } }));
    setErrors([]);
    setPlan(null);
    setPreflight(null);
  }, []);

  /* ---- scope and plan, rebuilt whenever an answer invalidates them ------- */

  const resolveScope = useCallback(async (body: AssessmentInput) => {
    try {
      const response = await fetch("/api/scope", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          standardIds: body.standardIds,
          tier: body.tier,
          applicability: body.applicability,
        }),
      });
      if (!response.ok) return;
      setScope((await response.json()) as ScopeResult);
    } catch {
      /* A failed re-scope leaves the consequence line saying it is working, which is
         better than replacing a real figure with a stale one. */
    }
  }, []);

  const buildPlan = useCallback(async (body: AssessmentInput) => {
    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          standardIds: body.standardIds,
          tier: body.tier,
          applicability: body.applicability,
          access: accessSignalsFromCredentials(body.credentials),
        }),
      });
      if (!response.ok) return;
      setPlan((await response.json()) as CheckPlan);
    } catch {
      /* As above. */
    }
  }, []);

  useEffect(() => {
    if (!input.standardIds.length) return;
    if (scope && plan) return;
    const task = window.setTimeout(() => {
      if (!scope) void resolveScope(input);
      if (!plan) void buildPlan(input);
    }, 60);
    return () => window.clearTimeout(task);
  }, [input, scope, plan, resolveScope, buildPlan]);

  const runPreflight = useCallback(async () => {
    setPreflightLoading(true);
    try {
      const response = await fetch("/api/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: input.tier, credentials: input.credentials }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { errors?: string[] };
        setErrors(body.errors ?? ["The connection check could not be completed."]);
        return;
      }
      setPreflight((await response.json()) as PreflightState);
    } catch (error) {
      setErrors([
        error instanceof Error ? error.message : "The connection check could not be completed.",
      ]);
    } finally {
      setPreflightLoading(false);
    }
  }, [input.credentials, input.tier]);

  /* ---- what stops a step from being left -------------------------------- */

  const blocked = useMemo(() => {
    if (step === "system") {
      if (!input.systemName.trim()) return "Give the system a name.";
      if (!input.organization.trim()) return "Name the organization.";
      const stack = input.architecture;
      if (!stack.modelProvider.trim() || !stack.modelName.trim()) {
        return "The model provider and model are part of the stack — fill both in.";
      }
      if (!stack.vectorDatabase.trim() || !stack.embeddingModel.trim()) {
        return "The vector database and embedding model are required: the engine only assesses RAG systems.";
      }
      return null;
    }
    if (step === "packs") {
      return input.standardIds.length ? null : "Select at least one pack.";
    }
    if (step === "connect") {
      for (const field of credentialFields[input.tier]) {
        const value = input.credentials[field.key]?.trim();
        if (field.required !== false && !value) return `${field.label} is required at this depth.`;
        if (field.type === "url" && value) {
          try {
            const url = new URL(value);
            const local =
              url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
            if (url.protocol !== "https:" && !local) return `${field.label} must use HTTPS.`;
          } catch {
            return `${field.label} must be a valid URL.`;
          }
        }
      }
      return null;
    }
    if (step === "ready") {
      const issues = validateApplicability(input);
      return issues.length ? issues[0] : null;
    }
    return null;
  }, [step, input]);

  /* ---- moving along the track ------------------------------------------- */

  const goTo = useCallback(
    (index: number) => {
      const next = Math.max(0, Math.min(index, track.length - 1));
      setDir(next >= at ? "fwd" : "back");
      setAt(next);
      setReached((current) => Math.max(current, next));
      setErrors([]);
      if (stageRef.current) stageRef.current.scrollTop = 0;
    },
    [at, track.length],
  );

  const next = useCallback(() => {
    if (blocked) {
      setErrors([blocked]);
      return;
    }
    goTo(at + 1);
  }, [blocked, goTo, at]);

  const back = useCallback(() => goTo(at - 1), [goTo, at]);

  const cancelRun = useCallback(() => abortRef.current?.abort(), []);

  const start = useCallback(async () => {
    const issues = validateApplicability(input);
    if (issues.length) {
      setErrors(issues);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setFailed(false);
    setResult(null);
    setEvents([]);
    setErrors([]);
    setStartedAt(Date.now());
    setPhase("run");
    try {
      const response = await fetch("/api/assessments/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = (await response.json()) as { errors?: string[] };
        throw new Error(body.errors?.join("\n") || "The assessment could not be started.");
      }
      if (!response.body) throw new Error("The assessment stream was unavailable.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        blocks.filter(Boolean).forEach((block) => {
          const parsed = parseEventBlock(block);
          if (parsed.name === "assessment_complete") {
            setResult(parsed.data as AssessmentResult);
            setFailed(false);
            return;
          }
          if (parsed.name === "assessment_error") {
            const failure = parsed.data as {
              message?: string;
              details?: string;
              errorCode?: string;
            };
            setFailed(true);
            setErrors([
              `${failure.errorCode ?? "ASSESSMENT_FAILED"}: ${failure.details ?? failure.message ?? "The assessment failed."}`,
            ]);
          }
          setEvents((current) =>
            appendEvent(current, {
              name: parsed.name,
              data: (parsed.data ?? {}) as Record<string, unknown>,
            }),
          );
        });
        if (done) break;
      }
      /* The run screen is not torn down when the stream closes. Routing away on the
         closing event replaced it in the same frame the rules finished resolving, so
         a reader watched the slow network stage and missed the stage that produced
         every verdict. It settles in place and offers the report as a choice. */
    } catch (error) {
      /* A run the reader stopped is not a run that failed. */
      if (error instanceof DOMException && error.name === "AbortError") {
        setErrors(["The run was stopped. Nothing was scored — a partial run produces no result."]);
        setFailed(true);
      } else {
        setFailed(true);
        setErrors([error instanceof Error ? error.message : "The assessment failed."]);
      }
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  }, [input]);

  const toReport = useCallback(() => {
    setPhase("report");
    setChapter(CHAPTERS[0].id);
    if (stageRef.current) stageRef.current.scrollTop = 0;
  }, []);

  const toSetup = useCallback(() => {
    setPhase("setup");
    setDir("back");
    if (stageRef.current) stageRef.current.scrollTop = 0;
  }, []);

  /* The trail grows to the right and overflows once there are four or five
     receipts, which would clip the one just added — the only one the reader is
     looking for confirmation of. Keep the tail in view. */
  useEffect(() => {
    const node = trailRef.current;
    if (node) node.scrollLeft = node.scrollWidth;
  }, [at]);

  /* ---- keyboard: the whole track is operable without the mouse ---------- */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      /* Enter on the monitoring tab must not advance a wizard the reader cannot see. */
      if (view !== "assess") return;
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "TEXTAREA";
      if (event.key === "Enter" && !typing) {
        if (phase === "setup") {
          event.preventDefault();
          if (step === "ready") void start();
          else next();
        } else if (phase === "run" && result && !running) {
          event.preventDefault();
          toReport();
        }
      }
      if (event.key === "Escape" && phase === "setup" && at > 0) {
        event.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, phase, step, at, result, running, next, back, start, toReport]);

  /* ---- exports ---------------------------------------------------------- */

  const printReport = useCallback(() => {
    if (!result) return;
    const blob = new Blob([createReportHtml(result)], { type: "text/html;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const printWindow = window.open(href, "_blank");
    if (!printWindow) {
      URL.revokeObjectURL(href);
      setErrors(["Pop-ups are blocked. Allow pop-ups to print or save this report as PDF."]);
      return;
    }
    printWindow.opener = null;
    window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
  }, [result]);

  const exportJson = useCallback(() => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `${result.assessmentId}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
  }, [result]);

  /* ---- the rail --------------------------------------------------------- */

  const railFill =
    phase === "report"
      ? 100
      : phase === "run"
        ? 100
        : Math.round(((at + (blocked ? 0 : 1)) / track.length) * 100);

  const armedCount = monitors.state?.armed.length ?? 0;
  const alertCount = monitors.state?.alerts.length ?? 0;

  const railNote =
    view === "monitor"
      ? monitors.state?.running
        ? "cycle running"
        : armedCount
          ? `${armedCount} armed · ${monitors.state?.cyclesRun ?? 0} cycles · ${alertCount} alert${alertCount === 1 ? "" : "s"}`
          : "nothing armed"
      : phase === "report" && result
        ? `${result.analysis.posture.assessed}/${result.analysis.posture.applicable} assessed · ${result.analysis.posture.openFindings} open`
        : phase === "run"
          ? running
            ? "running"
            : result
              ? "settled"
              : "stopped"
          : plan
            ? `${plan.runnableChecks} rules · ${plan.boundedRequests} requests · ${estimate(plan.estimatedSeconds)}`
            : "planning…";

  const receipts =
    phase === "setup"
      ? track
          .slice(0, at)
          .map((id) => ({ id, r: receiptFor(id, input, scope) }))
          .filter((entry): entry is { id: StepId; r: { em: string; s: string } } => entry.r !== null)
      : [];

  return (
    <div className="app">
      <header className="rail">
        <div className="rail-fill" style={{ width: `${railFill}%` }} />
        <span className="mark">
          <i>A</i>
          <b>
            ARQ <span>Governance</span>
          </b>
        </span>

        <nav className="tabs" aria-label="Sections">
          <button
            type="button"
            className={view === "assess" ? "on" : ""}
            aria-current={view === "assess" ? "page" : undefined}
            onClick={() => setView("assess")}
          >
            Assessment
          </button>
          <button
            type="button"
            className={view === "monitor" ? "on" : ""}
            aria-current={view === "monitor" ? "page" : undefined}
            onClick={() => setView("monitor")}
          >
            Monitoring
            {/* An alert outranks a count: a reader on the assessment tab needs to see
                that something regressed without having to go and look. */}
            {alertCount ? (
              <b className="bad">{alertCount}</b>
            ) : armedCount ? (
              <b>{armedCount}</b>
            ) : null}
          </button>
        </nav>

        {view === "assess" && phase === "setup" ? (
          <nav className="dots" aria-label="Setup steps">
            {track.map((id, index) => (
              <button
                key={id}
                type="button"
                title={`${index + 1}. ${STEP_TITLE[id]}`}
                aria-label={STEP_TITLE[id]}
                aria-current={index === at ? "step" : undefined}
                className={index === at ? "now" : index < at || index <= reached ? "done" : ""}
                disabled={index > reached}
                onClick={() => goTo(index)}
              />
            ))}
          </nav>
        ) : null}

        {view === "assess" && phase === "report" ? (
          <nav className="dots" aria-label="Report chapters">
            {CHAPTERS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                title={`${entry.n}. ${entry.label}`}
                aria-label={entry.label}
                aria-current={entry.id === chapter ? "true" : undefined}
                className={entry.id === chapter ? "now" : "done"}
                onClick={() =>
                  document.getElementById(entry.id)?.scrollIntoView({ behavior: "smooth" })
                }
              />
            ))}
          </nav>
        ) : null}

        <span className="rail-spacer" />
        <span className="rail-note">
          {view === "assess" && phase !== "setup" ? (
            <b>{input.systemName || "Unnamed system"}</b>
          ) : null}{" "}
          {view === "assess" && phase !== "setup" ? "· " : ""}
          {railNote}
        </span>
      </header>

      {view === "assess" && receipts.length ? (
        <div className="trail" ref={trailRef}>
          {receipts.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="receipt"
              title={`Back to: ${STEP_TITLE[entry.id]}`}
              onClick={() => goTo(track.indexOf(entry.id))}
            >
              <em>{entry.r.em}</em>
              <s>{entry.r.s}</s>
            </button>
          ))}
        </div>
      ) : null}

      <div className="stage" ref={stageRef}>
        {view === "assess" && phase === "setup" ? (
          <div className={`step ${dir}`} key={step}>
            <Step
              id={step}
              n={at + 1}
              of={track.length}
              input={input}
              patch={patch}
              patchCredential={patchCredential}
              scope={scope}
              plan={plan}
              preflight={preflight}
              preflightLoading={preflightLoading}
              onPreflight={runPreflight}
            />
            <div className="step-col" style={{ marginTop: 0 }}>
              {errors.length ? (
                <div className="because warn" style={{ marginTop: 22 }}>
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
              <div className="actions">
                {at > 0 ? (
                  <button className="btn quiet" type="button" onClick={back}>
                    ← Back
                  </button>
                ) : null}
                <span className="gap" />
                {step === "ready" ? (
                  <button
                    className="btn primary go"
                    type="button"
                    onClick={() => void start()}
                    disabled={!plan}
                  >
                    Start the run <kbd>↵</kbd>
                  </button>
                ) : (
                  <button className="btn primary" type="button" onClick={next}>
                    Continue <kbd>↵</kbd>
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {view === "assess" && phase === "run" ? (
          <LiveRun
            events={events}
            running={running}
            failed={failed && !result}
            errors={errors}
            startedAt={startedAt}
            plan={plan}
            input={input}
            hasResult={Boolean(result)}
            onStop={cancelRun}
            onSeeReport={toReport}
            onBack={toSetup}
          />
        ) : null}

        {view === "assess" && phase === "report" && result ? (
          <Report
            result={result}
            onActiveChapter={setChapter}
            onPrint={printReport}
            onExport={exportJson}
            onRerun={toSetup}
            onGoToMonitoring={() => setView("monitor")}
          />
        ) : null}

        {view === "monitor" ? (
          <Monitoring
            result={result}
            input={input}
            state={monitors.state}
            errors={monitors.errors}
            busy={monitors.busy}
            command={monitors.command}
            chosen={monitors.chosen}
            setChosen={monitors.setChosen}
            onGoToAssessment={() => setView("assess")}
          />
        ) : null}
      </div>
    </div>
  );
}
