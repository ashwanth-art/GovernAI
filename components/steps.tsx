"use client";

import { useMemo, useState } from "react";
import { credentialFields } from "@/lib/assessment";
import { industries, industryById, standardById, standards } from "@/lib/catalog";
import { estimate, reachPhrase, requestPhrase } from "@/lib/metrics";
import { pillarLabel } from "@/lib/pillars";
import { tierLabel, tierPlain } from "@/lib/terms";
import type {
  AccessTier,
  AssessmentInput,
  CheckPlan,
  Pillar,
} from "@/lib/types";

/* ============================================================================
   The track
   ----------------------------------------------------------------------------
   Six steps, one decision each. No pack asks scope questions — every selected
   pack is assessed in full — so the track is the same whatever is selected.
   ========================================================================== */

export type StepId = "system" | "industry" | "packs" | "depth" | "connect" | "ready";

export interface ScopeResult {
  applicable: number;
  notApplicable: number;
  unknown: number;
  byPillar: Array<{ pillar: string; label: string; applicable: number }>;
  byStandard: Array<{
    standardId: string;
    shortName: string;
    applicable: number;
    notApplicable: number;
    unknown: number;
    exclusions: Array<{ controlId: string; controlName: string; reason: string }>;
  }>;
}

/** One field's reachability verdict, as returned by `POST /api/preflight`. */
export interface PreflightRow {
  field: string;
  label: string;
  state: "ok" | "warn" | "bad" | "off";
  note: string;
  url?: string;
  method?: string;
  httpStatus?: number;
  latencyMs?: number;
  detected?: string[];
}

export interface PreflightState {
  results: PreflightRow[];
  summary: { ok: number; warn: number; bad: number; off: number };
  checkedAt: string;
}

/** The track. The same six steps for every selection. */
export function trackFor(): StepId[] {
  return ["system", "industry", "packs", "depth", "connect", "ready"];
}

/**
 * A step's receipt: the answer, in the user's own words, for the trail at the top.
 *
 * `null` means the step has nothing worth docking — the ready step is the screen
 * you are on when you would read it, so it never earns a receipt.
 */
export function receiptFor(
  id: StepId,
  input: AssessmentInput,
): { em: string; s: string } | null {
  switch (id) {
    case "system":
      return { em: "system", s: input.systemName.trim() || "unnamed" };
    case "industry":
      return { em: "sector", s: industryById.get(input.industryId)?.name ?? input.industryId };
    case "packs":
      return {
        em: "packs",
        s: input.standardIds.length
          ? input.standardIds.map((id) => standardById.get(id)?.shortName ?? id).join(", ")
          : "none selected",
      };
    case "depth":
      return { em: "depth", s: tierLabel(input.tier) };
    case "connect": {
      const endpoint = input.credentials.chatbotEndpoint?.trim();
      if (!endpoint) return { em: "target", s: "not set" };
      try {
        return { em: "target", s: new URL(endpoint).host };
      } catch {
        return { em: "target", s: endpoint };
      }
    }
    default:
      return null;
  }
}

/** The question at the top of each step. Kept here so the rail can title a dot. */
export const STEP_TITLE: Record<StepId, string> = {
  system: "What are we assessing?",
  industry: "What kind of business runs it?",
  packs: "Which rulebooks should it be held to?",
  depth: "How much of the system can we see?",
  connect: "Where is it, and what may we use?",
  ready: "This is exactly what will run",
};

/* ============================================================================
   The step
   ========================================================================== */

export interface StepProps {
  id: StepId;
  n: number;
  of: number;
  input: AssessmentInput;
  patch: (next: Partial<AssessmentInput>) => void;
  patchCredential: (key: string, value: string) => void;
  scope: ScopeResult | null;
  plan: CheckPlan | null;
  preflight: PreflightState | null;
  preflightLoading: boolean;
  onPreflight: () => void;
}

export function Step(props: StepProps) {
  const { id, n, of } = props;
  return (
    <div className={`step-col${id === "ready" || id === "connect" ? " wide" : ""}`}>
      <span className="q-n">
        Step {n} of {of}
      </span>
      <h1 className="q">{STEP_TITLE[id]}</h1>
      {id === "system" ? <SystemStep {...props} /> : null}
      {id === "industry" ? <IndustryStep {...props} /> : null}
      {id === "packs" ? <PacksStep {...props} /> : null}
      {id === "depth" ? <DepthStep {...props} /> : null}
      {id === "connect" ? <ConnectStep {...props} /> : null}
      {id === "ready" ? <ReadyStep {...props} /> : null}
    </div>
  );
}

/* ---- 1 · system --------------------------------------------------------- */

function SystemStep({ input, patch }: StepProps) {
  const [showStack, setShowStack] = useState(false);
  const stack = input.architecture;
  return (
    <>
      <p className="q-sub">
        Two names, so the report knows whose system it is describing.
      </p>
      <div className="q-body">
        <div className="fields two">
          <label className="field">
            <span>System name</span>
            <input
              value={input.systemName}
              onChange={(event) => patch({ systemName: event.target.value })}
              placeholder="Knowledge Assistant"
              autoFocus
            />
          </label>
          <label className="field">
            <span>Organization</span>
            <input
              value={input.organization}
              onChange={(event) => patch({ organization: event.target.value })}
              placeholder="Your company"
            />
          </label>
        </div>

        {showStack ? (
          <div className="fields two" style={{ marginTop: 18 }}>
            <label className="field mono-in">
              <span>Model provider</span>
              <input
                value={stack.modelProvider}
                onChange={(event) =>
                  patch({ architecture: { ...stack, modelProvider: event.target.value } })
                }
              />
            </label>
            <label className="field mono-in">
              <span>Model</span>
              <input
                value={stack.modelName}
                onChange={(event) =>
                  patch({ architecture: { ...stack, modelName: event.target.value } })
                }
              />
            </label>
            <label className="field mono-in">
              <span>Vector database</span>
              <input
                value={stack.vectorDatabase}
                onChange={(event) =>
                  patch({ architecture: { ...stack, vectorDatabase: event.target.value } })
                }
              />
            </label>
            <label className="field mono-in">
              <span>Embedding model</span>
              <input
                value={stack.embeddingModel}
                onChange={(event) =>
                  patch({ architecture: { ...stack, embeddingModel: event.target.value } })
                }
              />
            </label>
          </div>
        ) : null}

        <div className="because flat">
          <i>◆</i>
          <span>
            {showStack ? (
              <>
                This stack is a <b>declaration</b>, not a question the run asks. From Tier 2 the
                audit adapter reports what the service is actually running, and a mismatch between
                the two is itself a finding.
              </>
            ) : (
              <>
                The retrieval stack is set to <b>{stack.modelName}</b> on {stack.modelProvider}, over{" "}
                <b>{stack.vectorDatabase}</b>.{" "}
                <button
                  type="button"
                  onClick={() => setShowStack(true)}
                  style={{
                    textDecoration: "underline",
                    textUnderlineOffset: 3,
                    color: "var(--green)",
                    fontWeight: 600,
                  }}
                >
                  Change it
                </button>
              </>
            )}
          </span>
        </div>
      </div>
    </>
  );
}

/* ---- 2 · industry ------------------------------------------------------- */

function IndustryStep({ input, patch }: StepProps) {
  const chosen = industryById.get(input.industryId);
  const suggested = chosen?.recommendations ?? [];
  const controlCount = suggested.reduce(
    (sum, entry) => sum + (standardById.get(entry.standardId)?.controls.length ?? 0),
    0,
  );
  return (
    <>
      <p className="q-sub">
        This only decides which rulebooks we suggest. You choose the real list on the next screen.
      </p>
      <div className="q-body">
        {/* No pack count on the card: every sector suggests three, so printing it
            ten times distinguishes nothing. The consequence line below names the
            actual three for whichever one is chosen. */}
        <div className="picks tight">
          {industries.map((industry) => (
            <button
              key={industry.id}
              type="button"
              className={`pick${industry.id === input.industryId ? " on" : ""}`}
              onClick={() =>
                patch({
                  industryId: industry.id,
                  standardIds: industry.recommendations.map((entry) => entry.standardId),
                })
              }
            >
              <span className="pick-box round" aria-hidden="true">
                ●
              </span>
              <span>
                <strong>{industry.name}</strong>
                <p>{industry.description}</p>
              </span>
            </button>
          ))}
        </div>
        <div className="because">
          <i>◆</i>
          <span>
            {chosen ? (
              <>
                For {chosen.name.toLowerCase()} we suggest <b>{suggested.length}</b> packs covering{" "}
                <b>{controlCount}</b> controls:{" "}
                {suggested
                  .map((entry) => standardById.get(entry.standardId)?.shortName ?? entry.standardId)
                  .join(" · ")}
                . Picking a sector <b>replaces</b> the selection, so change it before you fine-tune.
              </>
            ) : (
              "Pick the sector this system operates in."
            )}
          </span>
        </div>
      </div>
    </>
  );
}

/* ---- 3 · packs ---------------------------------------------------------- */

function PacksStep({ input, patch, scope }: StepProps) {
  const industry = industryById.get(input.industryId);
  const total = input.standardIds.reduce(
    (sum, id) => sum + (standardById.get(id)?.controls.length ?? 0),
    0,
  );
  const toggle = (id: string) =>
    patch({
      standardIds: input.standardIds.includes(id)
        ? input.standardIds.filter((entry) => entry !== id)
        : [...input.standardIds, id],
    });

  /**
   * Three groups, so a catalogue of twenty-three reads as a short list plus a
   * long one rather than a wall. Anything the sector suggests comes first,
   * anything added by hand comes next so it cannot be lost in the tail, and the
   * remainder is the rest of the catalogue.
   */
  const groups = useMemo(() => {
    const recommended = new Set(
      (industry?.recommendations ?? []).map((entry) => entry.standardId),
    );
    const suggested = standards.filter((standard) => recommended.has(standard.id));
    const added = standards.filter(
      (standard) => !recommended.has(standard.id) && input.standardIds.includes(standard.id),
    );
    const rest = standards.filter(
      (standard) => !recommended.has(standard.id) && !input.standardIds.includes(standard.id),
    );
    return [
      { label: `Suggested for ${industry?.name ?? "your sector"}`, items: suggested },
      ...(added.length ? [{ label: "Added by you", items: added }] : []),
      { label: "The rest of the catalogue", items: rest },
    ].filter((group) => group.items.length > 0);
  }, [input.standardIds, industry]);

  return (
    <>
      <p className="q-sub">
        Suggested for {industry?.name.toLowerCase() ?? "your sector"}. Add or remove any — there is
        no cap, and every pack you select is assessed in full rather than sampled.
      </p>
      <div className="q-body">
        {groups.map((group) => (
          <div className="pgroup" key={group.label}>
            <div className="grouped">
              <span>{group.label}</span>
              <hr />
              <span>{group.items.length}</span>
            </div>
            <div className="plist">
              {group.items.map((standard) => {
                const on = input.standardIds.includes(standard.id);
                return (
                  <button
                    key={standard.id}
                    type="button"
                    className={`prow${on ? " on" : ""}`}
                    onClick={() => toggle(standard.id)}
                    aria-pressed={on}
                  >
                    <span className="bx" aria-hidden="true">
                      ✓
                    </span>
                    <span className="nm">
                      {standard.shortName}
                      <small>
                        {standard.kind} · {standard.jurisdiction}
                      </small>
                    </span>
                    <span className="ct">{standard.controls.length}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {input.standardIds.length === 0 ? (
          <div className="because warn">
            <i>▲</i>
            <span>
              Nothing is selected, so there is nothing to assess. Pick at least one pack.
            </span>
          </div>
        ) : (
          <div className="because">
            <i>◆</i>
            <span>
              <b>{input.standardIds.length}</b> packs · <b>{total}</b> controls between them.{" "}
              {scope ? (
                <>
                  All <b>{scope.applicable}</b> are assessed — no pack asks scope questions, so
                  nothing is ruled out.
                </>
              ) : (
                "Working out which of them apply to you…"
              )}
            </span>
          </div>
        )}
      </div>
    </>
  );
}

/* ---- 4 · depth ---------------------------------------------------------- */

const DEPTH: Record<AccessTier, { needs: string; gain: string }> = {
  1: {
    needs: "Just a URL",
    gain: "Everything that needs a configuration read or a document reports not_assessed, with its reason.",
  },
  2: {
    needs: "A read-only token",
    gain: "Unlocks the configuration and logging evidence Tier 1 cannot see. We read; we never write.",
  },
  3: {
    needs: "Provider URLs and an evidence manifest",
    gain: "The only depth that can close the documentation and process controls. Document content is never interpreted — only a named procedure verdict is accepted.",
  },
};

/* How a rule gets its evidence, said plainly. The engine's own word for this is
   `method`; these are the same four values written for a reader. */
/* Keyed on CheckMethod exactly. Inventing shorthand ids here ("probe",
   "adapter") silently matched nothing, every group returned zero rows, and the
   whole rail rendered blank — the failure looked like "no data" rather than
   "wrong key", which is why it survived a clean type-check. */
const METHOD_GROUP: Array<{ id: string; label: string; blurb: string }> = [
  { id: "live_probe", label: "Live probes", blurb: "Bounded questions sent to your assistant." },
  { id: "adapter_read", label: "Configuration reads", blurb: "Read-only facts from your own adapters." },
  { id: "provider_api", label: "Provider reads", blurb: "Read-only calls to your cloud or monitoring provider." },
  { id: "named_artifact", label: "Evidence records", blurb: "Named procedure verdicts you publish." },
];

function DepthStep({ input, patch, plan }: StepProps) {
  const checks = plan?.checks ?? [];
  const willRun = checks.filter((check) => check.tierMinimum <= input.tier);
  const outOfReach = checks.filter((check) => check.tierMinimum > input.tier);

  return (
    <>
      <p className="q-sub">
        The single biggest lever on how much we can prove. Deeper means more evidence and more
        credentials — nothing else changes.
      </p>
      <div className="q-body">
        <div className="depth-split">
          <div className="picks">
            {([1, 2, 3] as AccessTier[]).map((tier) => {
              const forecast = plan?.forecast.find((entry) => entry.tier === tier);
              const on = input.tier === tier;
              return (
                <button
                  key={tier}
                  type="button"
                  className={`pick deep${on ? " on" : ""}`}
                  onClick={() => patch({ tier })}
                >
                  <span className="pick-head">
                    <span className="n">{tierLabel(tier).replace(" · ", " · ")}</span>
                    <strong>{tierPlain[tier]}</strong>
                  </span>
                  <p style={{ fontSize: 13.5, color: "var(--muted)" }}>{DEPTH[tier].needs}</p>
                  {forecast ? (
                    <span className="reach">
                      <span className="bar">
                        <i style={{ width: `${forecast.percent}%` }} />
                      </span>
                      <span className="num">
                        {forecast.reachable}/{forecast.applicable} controls
                      </span>
                    </span>
                  ) : null}
                  <span className="gain">{DEPTH[tier].gain}</span>
                </button>
              );
            })}
          </div>

          {/* The right rail: the actual rule list for whichever depth is selected.
              A reader choosing a depth is choosing a set of rules, so the set is
              what the screen should show — not only how many of them there are. */}
          <aside className="depth-rail" aria-live="polite">
            <div className="dr-head">
              <span className="dr-tier">{tierLabel(input.tier)}</span>
              <strong>What runs at this depth</strong>
              {plan ? (
                <p>
                  <b>{willRun.length}</b> of {checks.length} rules run, closing{" "}
                  <b>{plan.reachableControls}</b> of {plan.applicableControls} in-scope controls.
                </p>
              ) : (
                <p>Working out what this depth can reach…</p>
              )}
            </div>

            {METHOD_GROUP.map((group) => {
              const rows = willRun.filter((check) => check.method === group.id);
              if (!rows.length) return null;
              return (
                <div className="dr-group" key={group.id}>
                  <div className="dr-group-h">
                    <b>{group.label}</b>
                    <span>{rows.length}</span>
                  </div>
                  <p className="dr-blurb">{group.blurb}</p>
                  <ul className="dr-list">
                    {rows.map((check) => (
                      <li key={check.id}>
                        <span className="dr-dot" aria-hidden="true">
                          ●
                        </span>
                        <span>
                          {check.title}
                          <small>
                            {check.controlCount} control{check.controlCount === 1 ? "" : "s"}
                            {check.request ? ` · ${check.request.method} ${check.request.endpoint}` : ""}
                          </small>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}

            {outOfReach.length ? (
              <div className="dr-group locked">
                <div className="dr-group-h">
                  <b>Still out of reach</b>
                  <span>{outOfReach.length}</span>
                </div>
                <p className="dr-blurb">
                  These report <span className="mono">not_assessed</span> at this depth — never a
                  pass, never a fail. Each names the depth that would unlock it.
                </p>
                <ul className="dr-list">
                  {outOfReach.map((check) => (
                    <li key={check.id}>
                      <span className="dr-dot lock" aria-hidden="true">
                        ○
                      </span>
                      <span>
                        {check.title}
                        <small>needs {tierLabel(check.tierMinimum)}</small>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </aside>
        </div>

        <div className="because">
          <i>◆</i>
          <span>
            {plan ? (
              <>
                At {tierLabel(input.tier)}: <b>{reachPhrase(plan.reachableControls, plan.applicableControls)}</b>.
                That is {plan.runnableChecks} rules we can run and {plan.blockedChecks} we cannot —
                every blocked one names what would unblock it.
              </>
            ) : (
              "Working out what each depth can reach…"
            )}
          </span>
        </div>
      </div>
    </>
  );
}

/* ---- 5 · connect -------------------------------------------------------- */

const STATE_GLYPH: Record<PreflightRow["state"], string> = {
  ok: "●",
  warn: "◐",
  bad: "✕",
  off: "○",
};

function ConnectStep({
  input,
  patchCredential,
  preflight,
  preflightLoading,
  onPreflight,
}: StepProps) {
  const fields = credentialFields[input.tier];
  return (
    <>
      <p className="q-sub">
        {tierLabel(input.tier)} needs {fields.length} {fields.length === 1 ? "field" : "fields"}.
        Credentials are held for the length of one run and are never written anywhere.
      </p>
      <div className="q-body">
        <div className="fields two">
          {fields.map((field) => (
            <label className="field mono-in" key={field.key}>
              <span>
                {field.label}
                {field.required === false ? " · optional" : ""}
              </span>
              <input
                type={field.type === "password" ? "password" : "text"}
                value={input.credentials[field.key] ?? ""}
                onChange={(event) => patchCredential(field.key, event.target.value)}
                placeholder={field.placeholder}
                autoComplete="off"
              />
              {field.help ? <small>{field.help}</small> : null}
            </label>
          ))}
        </div>

        <div className="actions" style={{ marginTop: 22 }}>
          <button className="btn" type="button" onClick={onPreflight} disabled={preflightLoading}>
            {preflightLoading ? "Checking…" : preflight ? "Check again" : "Check the connection"}
          </button>
          <span className="faint" style={{ fontSize: 13 }}>
            Reachability only. Nothing is scored and nothing is stored.
          </span>
        </div>

        {preflight ? (
          <>
            <div className="reach-list">
              {preflight.results.map((row) => (
                <div className="reach-row" key={row.field}>
                  <span className={`st ${row.state}`}>{STATE_GLYPH[row.state]}</span>
                  <span className="lbl">
                    {row.label}
                    <small>{row.note}</small>
                  </span>
                  <span className="meta">
                    {row.httpStatus ? `${row.httpStatus}` : ""}
                    {row.latencyMs !== undefined ? ` · ${row.latencyMs}ms` : ""}
                  </span>
                </div>
              ))}
            </div>
            <div className={`because${preflight.summary.bad > 0 ? " warn" : ""}`}>
              <i>{preflight.summary.bad > 0 ? "▲" : "◆"}</i>
              <span>
                <b>{preflight.summary.ok}</b> reachable
                {preflight.summary.warn > 0 ? (
                  <>
                    , <b>{preflight.summary.warn}</b> answered oddly
                  </>
                ) : null}
                {preflight.summary.bad > 0 ? (
                  <>
                    , <b>{preflight.summary.bad}</b> unreachable
                  </>
                ) : null}
                {preflight.summary.off > 0 ? (
                  <>
                    , <b>{preflight.summary.off}</b> left blank
                  </>
                ) : null}
                .{" "}
                {preflight.summary.bad > 0
                  ? "A run will still start, but anything behind an unreachable location reports not_assessed rather than failing."
                  : "Every location this depth needs answered."}
              </span>
            </div>
          </>
        ) : (
          <div className="because flat">
            <i>◆</i>
            <span>
              Checking now answers a wrong URL or a rejected key <b>here</b>, next to the field —
              rather than several seconds into a run, dressed up as a control failure.
            </span>
          </div>
        )}
      </div>
    </>
  );
}

/* ---- 6 · ready ---------------------------------------------------------- */

function ReadyStep({ input, plan, scope }: StepProps) {
  const blocked = useMemo(() => {
    if (!plan) return [];
    const groups = new Map<string, number>();
    for (const check of plan.checks) {
      if (check.willRun) continue;
      groups.set(check.notRunReason, (groups.get(check.notRunReason) ?? 0) + 1);
    }
    return [...groups.entries()].sort((a, b) => b[1] - a[1]);
  }, [plan]);

  const byPillar = useMemo(() => {
    if (!plan) return [];
    const counts = new Map<Pillar, number>();
    for (const check of plan.checks) {
      if (!check.willRun) continue;
      counts.set(check.pillar, (counts.get(check.pillar) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [plan]);

  if (!plan) {
    return (
      <>
        <p className="q-sub">Building the plan…</p>
      </>
    );
  }

  return (
    <>
      <p className="q-sub">
        Nothing below is a guess. This is the plan the engine will execute, built by the same code
        that runs it.
      </p>
      <div className="q-body">
        <div className="stats">
          <div className="stat pass">
            <em>Rules that will run</em>
            <strong>{plan.runnableChecks}</strong>
            <p>each one a written pass condition</p>
          </div>
          <div className="stat">
            <em>Requests we will send</em>
            <strong>{plan.boundedRequests}</strong>
            <p>bounded, read-only, to hosts you named</p>
          </div>
          <div className="stat">
            <em>Controls in scope</em>
            <strong>
              {plan.reachableControls}
              <span style={{ color: "var(--faint)", fontWeight: 500 }}>/{plan.applicableControls}</span>
            </strong>
            <p>reachable at {tierLabel(input.tier)}</p>
          </div>
          <div className="stat">
            <em>Expected time</em>
            <strong>{estimate(plan.estimatedSeconds)}</strong>
            <p>{requestPhrase(plan.boundedRequests)}</p>
          </div>
        </div>

        {byPillar.length ? (
          <div style={{ marginTop: 20 }}>
            <div className="tags">
              {byPillar.map(([pillar, count]) => (
                <span className="tag-s" key={pillar}>
                  {pillarLabel(pillar)} <b>{count}</b>
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {blocked.length ? (
          <details className="card disc" style={{ marginTop: 20 }}>
            <summary>
              <span className="sev">○</span>
              <span className="ti">
                {plan.blockedChecks} rules will not run
                <small>Named up front, with what would unblock each one.</small>
              </span>
              <span className="rt">show</span>
            </summary>
            <div className="disc-body">
              {blocked.map(([reason, count]) => (
                <div className="reach-row" key={reason}>
                  <span className="st off">○</span>
                  <span className="lbl">{reason}</span>
                  <span className="meta">{count} rules</span>
                </div>
              ))}
            </div>
          </details>
        ) : null}

        {plan.blindSpots.length ? (
          <div className="cards" style={{ marginTop: 12 }}>
            {plan.blindSpots.map((spot) => (
              <div className="card blind" key={spot.reason}>
                <div>
                  <strong>{spot.reason}</strong>
                  <p>{spot.closedBy}</p>
                </div>
                <span className="n">
                  {spot.controls}
                  <small>CONTROLS</small>
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="because">
          <i>◆</i>
          <span>
            {scope && scope.unknown > 0 ? (
              <>
                <b>{scope.unknown}</b> controls have undecided applicability and will report as
                such — they are counted in neither the pass nor the fail column.{" "}
              </>
            ) : null}
            Nothing is written to your system. Every request is a read, to a host you named, and{" "}
            <b>no model judges anything</b> — every verdict comes from a rule with a written pass
            condition.
          </span>
        </div>

        {plan.safety.length ? (
          <ul
            style={{
              margin: "16px 0 0",
              padding: 0,
              listStyle: "none",
              display: "grid",
              gap: 7,
            }}
          >
            {plan.safety.map((line) => (
              <li
                key={line}
                style={{
                  display: "grid",
                  gridTemplateColumns: "15px 1fr",
                  gap: 9,
                  fontSize: 13,
                  color: "var(--muted)",
                  lineHeight: 1.5,
                }}
              >
                <span style={{ color: "var(--pass)" }}>✓</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </>
  );
}
