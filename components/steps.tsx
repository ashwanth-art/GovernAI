"use client";

import { useMemo, useState } from "react";
import { applicabilityKeysByCondition } from "@/lib/applicability";
import { credentialFields } from "@/lib/assessment";
import { industries, industryById, standardById, standards } from "@/lib/catalog";
import { estimate, reachPhrase, requestPhrase } from "@/lib/metrics";
import { pillarLabel } from "@/lib/pillars";
import { tierLabel, tierPlain } from "@/lib/terms";
import type {
  AccessTier,
  ApplicabilityProfile,
  AssessmentInput,
  CheckPlan,
  Pillar,
} from "@/lib/types";

/* ============================================================================
   The track
   ----------------------------------------------------------------------------
   Seven steps at most, one decision each, and the fourth only exists when a
   selected pack actually needs it. The list is derived from the input rather
   than declared, which is what makes the flow dynamic: choosing HIPAA grows the
   track by one step, deselecting it shrinks it again, and no screen is ever shown
   that has nothing to ask.
   ========================================================================== */

export type StepId = "system" | "industry" | "packs" | "scope" | "depth" | "connect" | "ready";

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
  openQuestions: string[];
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

/* ---- the profile answers, and which packs actually consume them ---------- */

type ProfileKey = keyof ApplicabilityProfile;

const SCOPE_QUESTIONS: Array<{
  key: ProfileKey;
  q: string;
  help: string;
  options?: Array<[string, string]>;
}> = [
  {
    key: "hipaaRole",
    q: "What is your organization's role under HIPAA?",
    help: "Decides which of the HIPAA safeguards apply to you at all.",
    options: [
      ["unknown", "Not sure yet"],
      ["covered_entity", "Covered entity — we provide care or coverage"],
      ["business_associate", "Business associate — we handle PHI for someone else"],
      ["not_regulated", "Neither — HIPAA does not reach us"],
    ],
  },
  {
    key: "handlesPhi",
    q: "Does the assistant handle protected health information?",
    help: "Anything a patient could be identified from.",
  },
  {
    key: "handlesEphi",
    q: "Is any of that health information stored electronically?",
    help: "Triggers the HIPAA Security Rule's technical safeguards.",
  },
  {
    key: "usesPhiSubprocessors",
    q: "Do other companies process that health data on your behalf?",
    help: "Each one needs a business associate agreement.",
  },
  {
    key: "maintainsDesignatedRecordSet",
    q: "Does it hold records a patient could ask to see or correct?",
    help: "Triggers the access and amendment obligations.",
  },
  {
    key: "euTerritorialScope",
    q: "Does the EU AI Act reach this system?",
    help: "It applies if you place it on the EU market or its output is used in the EU — wherever you are based.",
    options: [
      ["unknown", "Not sure yet"],
      ["in_scope", "Yes — EU market or EU-used output"],
      ["out_of_scope", "No — neither applies"],
    ],
  },
  {
    key: "euRole",
    q: "What is your role under the EU AI Act?",
    help: "Providers carry the most obligations; deployers carry fewer but different ones.",
    options: [
      ["unknown", "Not sure yet"],
      ["provider", "Provider — we built it or put our name on it"],
      ["deployer", "Deployer — we use someone else's system"],
      ["importer", "Importer"],
      ["distributor", "Distributor"],
      ["product_manufacturer", "Product manufacturer"],
      ["gpai_provider", "General-purpose AI model provider"],
      ["not_in_scope", "None of these"],
    ],
  },
  {
    key: "euRiskClass",
    q: "How is the system classified for risk?",
    help: "High-risk classification is what turns on the heaviest obligations.",
    options: [
      ["unknown", "Not sure yet"],
      ["prohibited", "Prohibited practice"],
      ["high_risk", "High risk"],
      ["transparency", "Transparency obligations only"],
      ["limited_or_minimal", "Limited or minimal risk"],
    ],
  },
  {
    key: "euArticle27Deployer",
    q: "Do you owe a fundamental-rights impact assessment?",
    help: "Article 27 — certain public-body and essential-service deployers.",
  },
  {
    key: "directHumanInteraction",
    q: "Do people talk to it directly?",
    help: "If so, they have to be told they are talking to an AI system.",
  },
];

/**
 * Which profile answers the selected packs actually consume.
 *
 * Asked rather than assumed: a pack whose every control applies to all assessed
 * AI systems consumes nothing, so selecting it adds no questions. This is why
 * most runs never see the scope step at all.
 */
export function neededProfileKeys(standardIds: string[]): ProfileKey[] {
  const needed = new Set<ProfileKey>();
  for (const id of standardIds) {
    for (const control of standardById.get(id)?.controls ?? []) {
      for (const condition of control.applicability ?? []) {
        for (const key of applicabilityKeysByCondition[condition] ?? []) needed.add(key);
      }
    }
  }
  return SCOPE_QUESTIONS.filter((question) => needed.has(question.key)).map((q) => q.key);
}

/** The track, derived. The scope step exists only when something asks for it. */
export function trackFor(input: AssessmentInput): StepId[] {
  const track: StepId[] = ["system", "industry", "packs"];
  if (neededProfileKeys(input.standardIds).length) track.push("scope");
  track.push("depth", "connect", "ready");
  return track;
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
  scope: ScopeResult | null,
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
    case "scope":
      return { em: "scope", s: scope ? `${scope.applicable} controls apply` : "answered" };
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
  scope: "A few questions your rulebooks need answered",
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
      {id === "scope" ? <ScopeStep {...props} /> : null}
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
                  Of those, <b>{scope.applicable}</b> apply to you.{" "}
                  {scope.notApplicable > 0 ? (
                    <>
                      <b>{scope.notApplicable}</b> are ruled out, each with a stated reason.{" "}
                    </>
                  ) : null}
                  {scope.unknown > 0 ? (
                    <>
                      <b>{scope.unknown}</b> cannot be decided until the next screen&rsquo;s
                      questions are answered.
                    </>
                  ) : null}
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

/* ---- 4 · scope (conditional) -------------------------------------------- */

function ScopeStep({ input, patch, scope }: StepProps) {
  const needed = useMemo(() => neededProfileKeys(input.standardIds), [input.standardIds]);
  const questions = SCOPE_QUESTIONS.filter((question) => needed.includes(question.key));
  const profile = input.applicability;
  const set = (key: ProfileKey, value: string | boolean) =>
    patch({ applicability: { ...profile, [key]: value } as ApplicabilityProfile });

  const unanswered = questions.filter(
    (question) => question.options && profile[question.key] === "unknown",
  ).length;

  return (
    <>
      <p className="q-sub">
        Only the packs you selected are asking. Each answer removes controls from the run or brings
        them in — nothing here is scored.
      </p>
      <div className="q-body">
        <div className="fields">
          {questions
            .filter((question) => question.options)
            .map((question) => (
              <label className="field" key={question.key}>
                <span>{question.q}</span>
                <select
                  value={String(profile[question.key])}
                  onChange={(event) => set(question.key, event.target.value)}
                >
                  {question.options?.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <small>{question.help}</small>
              </label>
            ))}
        </div>

        {questions.some((question) => !question.options) ? (
          <div className="switches" style={{ marginTop: 22 }}>
            {questions
              .filter((question) => !question.options)
              .map((question) => {
                const on = Boolean(profile[question.key]);
                return (
                  <button
                    key={question.key}
                    type="button"
                    className={`switch${on ? " on" : ""}`}
                    onClick={() => set(question.key, !on)}
                    aria-pressed={on}
                  >
                    <span>
                      <strong>{question.q}</strong>
                      <p>{question.help}</p>
                    </span>
                    <span className="knob" aria-hidden="true" />
                  </button>
                );
              })}
          </div>
        ) : null}

        {unanswered > 0 ? (
          <div className="because warn">
            <i>▲</i>
            <span>
              <b>{unanswered}</b> still say &ldquo;not sure yet&rdquo;. Left that way, the controls
              that depend on them are <b>neither scored nor excluded</b> — they report unknown
              applicability, which is honest but proves nothing.
            </span>
          </div>
        ) : (
          <div className="because">
            <i>◆</i>
            <span>
              All answered.{" "}
              {scope ? (
                <>
                  <b>{scope.applicable}</b> controls apply, <b>{scope.notApplicable}</b> are ruled
                  out with a reason, and <b>{scope.unknown}</b> are undecided.
                </>
              ) : (
                "Re-scoping…"
              )}
            </span>
          </div>
        )}
      </div>
    </>
  );
}

/* ---- 5 · depth ---------------------------------------------------------- */

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

function DepthStep({ input, patch, plan }: StepProps) {
  return (
    <>
      <p className="q-sub">
        The single biggest lever on how much we can prove. Deeper means more evidence and more
        credentials — nothing else changes.
      </p>
      <div className="q-body">
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

/* ---- 6 · connect -------------------------------------------------------- */

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

/* ---- 7 · ready ---------------------------------------------------------- */

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
