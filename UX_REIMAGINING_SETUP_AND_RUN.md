# Reimagining the setup and the run

Document date: 4 August 2026
Scope: the two screens the user configures and waits on — `components/setup.tsx` and `components/run.tsx`, plus the state that feeds them (`app/workspace.tsx`, `lib/assessment.ts`, `app/api/assessments/stream/route.ts`).
Method: read the full frontend, backend and design docs; ran the app locally and executed a real Tier 1 assessment against the demo target; measured the DOM; researched how comparable products solve the same two problems.

Everything in Part 1 is measured from a real run, not inferred.

---

## 0. The one-paragraph version

The product's ideas are better than its experience of them. The setup screen has the right *content* — applicability with reasons, a per-tier coverage forecast, a named pre-flight plan, a safety contract — but delivers it as 5.7 screens of vertical scroll under a header that promises "one screen · about two minutes", and its default configuration is one where 90% of the work is out of reach. The run screen has the right *idea* — five columns filling as your system is tested — but the engine emits the events that fill those columns only **after** all the other work is done, so the columns sit at zero for the entire run and snap-fill at the end. The progress bar spends 3% of its travel on the five real network calls and 94% on local arithmetic that is artificially slowed to 90 ms a step to look like work. Fix those two structural inversions and the screens you already have become the screens you designed.

---

# PART 1 — DIAGNOSIS

Measured from a Tier 1 run: ACI Infotech / ACI Knowledge Assistant, Finance, packs `mas_ai + soc2 + iso42001`, against `chat-bot-22j5.onrender.com`, assessment `AGR-78A494FB`.

## 1.1 The setup screen claims one screen and delivers 5.7

```
document.querySelector('.scroll') → scrollHeight 3499 · clientHeight 614
```

Page eyebrow: *"First run · one screen · about two minutes."* ([setup.tsx:345](components/setup.tsx:345))

Five and a half viewports of scroll is not a screen, and the promise is what makes it feel worse than it is — a reader who is told "one screen" and then scrolls four times assumes they have missed something. The four numbered steps are only the first 60% of it; below them sit two more full-width sections ("Exactly what will run", "What we will not do") which are the most persuasive material on the page and the least likely to be seen.

Compounding it: the left nav calls this **"1 · Set up the run"**, the run screen's eyebrow calls itself **"step 4 of 4"**, and the setup screen numbers its own internal sections 1–4. Three numbering systems for two screens.

## 1.2 The default configuration is one that cannot succeed

The shipped default is Tier 1 + three packs. The consequences are stated on screen, accurately, and they are brutal:

| Surface | What it says |
|---|---|
| Tier forecast matrix | trust 10% · security 13% · data_protection 10% · governance 4% · **compliance 0%** |
| Amber callout | "At this depth we cannot reach **124 of your 137** controls." |
| Hero CTA card | **137** controls apply · "5 checks & rules will run · ~17s · 124 out of reach" |
| "Exactly what will run" | trust *1 will run · 14 can't* · security *2/19* · data_protection *1/6* · governance *1/9* · compliance *0/3* |
| Final result | `insufficient_evidence` — "Only 17 of 147 applicable controls could be assessed (12%)" · health 100% · exposure 0 · **0 open findings** |

The first run a new user takes, on the defaults, ends with a verdict of *insufficient evidence*, a 100% pass rate on a 12% sample, and nothing wrong. That is the honest answer to the question that was asked — and it is the wrong question to have let them ask. The product's own restructure plan anticipated this ("saying this **before** the run converts the eventual verdict from a disappointment into a prediction fulfilled") and the warning did get built. What did not get built is the part that stops them running it that way.

The hero number is also the wrong one. **137** is displayed at 30px in the CTA card; **13** is what the run will actually verify. The largest number on the screen is the one the run does not deliver.

## 1.3 The differentiating feature renders blank on the default selection

The right rail's entire top card is "Applicability result" — the applies/doesn't-apply ledger, the thing the restructure plan correctly identifies as the difference between a checklist vendor and an assurance product. On the shipped default it reads:

```
MAS FEAT        32 controls    32 apply · 0 none removed · 0 ✓ nothing unresolved
SOC 2 Type II   49 controls    49 apply · 0 none removed · 0 ✓ nothing unresolved
ISO/IEC 42001   56 controls    56 apply · 0 none removed · 0 ✓ nothing unresolved
```

Three identical full-width bars, three zeros, no reasons — because only HIPAA and the EU AI Act carry applicability conditions ([setup.tsx:57–63](components/setup.tsx:57)). The screen is honest and the code comment says so, but the effect is that the most valuable card on the page occupies the most valuable real estate to say nothing, on the default path, for most industries.

## 1.4 There is no connection test before the run

The rail card is titled "What we will contact" and every row reads `pending`, with a `not contacted yet` lamp. It only becomes real *after* a run completes ([setup.tsx:928–996](components/setup.tsx:928)).

So the first time anyone learns whether the URL is right, the token is valid, or the host is even awake is 30 seconds into a live assessment. During the run I observed, `GET /health` sat in flight for **over 30 seconds** — a Render cold start — with the progress bar at 0%, the counter at "0 of 146 steps", no elapsed timer and no "still waiting" affordance. There is no way to distinguish that from a hang.

Validation is also all-or-nothing and deferred to the launch click ([workspace.tsx:210–252](app/workspace.tsx:210)): press start with a bad field and you are bounced back to a red list. Errors from step 4 are reported at the bottom of a 3,499px page.

## 1.5 The run screen's headline is inert for the entire run

This is the most consequential finding in the document.

The engine's emission order ([lib/assessment.ts](lib/assessment.ts)):

| Line | Event | Count on this run | Timing |
|---|---|---|---|
| 1872 | `assessment_start` | 1 | t=0 |
| 1889 | `run_plan` | 1 | t=0 |
| 673–1147 | `probe_start` / `probe_complete` / `rag_trace` | ~14 | **the only real network work** — ~10–30 s |
| 1923–1966 | `standard_start` → `control_result` ×137 → `standard_complete` | ~143 | **~12.3 s of pure local arithmetic**, paced at 90 ms/event |
| 1990 | `owasp_complete` | 1 | — |
| **2025** | **`check_result` ×56** | **56** | **all at once, at the very end** |
| 2046 | `pillar_progress` ×5 | 5 | after that |
| 2074 | `posture_update` | 1 | last |

`components/run.tsx` builds "What each pillar is having verified" — the five columns, the bars, the per-row `queued → verifying → verdict` transitions, the whole centrepiece — from `check_result` ([run.tsx:155](components/run.tsx:155), [run.tsx:230](components/run.tsx:230)) and `pillar_progress` ([run.tsx:159](components/run.tsx:159)).

Both arrive **after everything else**. Mid-run screenshot, taken while the bar read *115 of 146 steps*:

```
What each pillar is having verified      0 of 56 rule specs verified
trust      0 of 15 · 0 of 36 controls     [ every row: queued / n/a ]
security   0 of 21 · 0 of 49 controls
…
```

So the designed choreography — rows lighting up one at a time as their probe lands — never happens. The columns hold at zero for the whole run, then fill instantly in one frame. The "validation theatre" is a still photograph followed by a jump cut.

## 1.6 The progress bar measures the wrong work

`totalSteps = expectedLiveCheckCount + totalControlSteps + standards + 1` ([assessment.ts:1817](lib/assessment.ts:1817)) — on this run, 146. Of those:

- **5** are real bounded HTTP requests to the customer's system, and they consume 10–30 seconds of wall clock.
- **137** are `control_result` events: local mapping of already-collected evidence onto framework clauses, deliberately slowed by `eventDelayMs: 90` ([stream/route.ts:71](app/api/assessments/stream/route.ts:71), [assessment.ts:1915](lib/assessment.ts:1915)) "for human-visible progression".

The bar therefore spends **3% of its travel on 100% of the real work**, then sprints across 94% during an artificial delay loop. At the end it is solid green at 100% — while the same screen says *5 of 56 rule specs verified*. Two progress semantics, both true, directly contradicting each other 40 pixels apart.

The 90 ms pacing scales with the catalog, not the work: 404 controls exist across the 23 standards and the selection cap was removed (commit `6796810`). Select everything and the UI pads a ~25-second run out to **~61 seconds**, of which 36 are a `setTimeout`.

## 1.7 Five denominators for one run

Across two adjacent screens, on one configuration:

| Number | Where | Means |
|---|---|---|
| **137** | setup CTA, 30px | controls applicable in the 3 selected packs |
| **147** | posture strip, result header | + the always-on OWASP pack |
| **5** | setup CTA button, "Start the 5 checks & rules" | runnable rules |
| **56** | run screen, "0 of 56 rule specs verified" | *all* rules including the 51 this tier cannot reach |
| **146** | run screen, "115 of 146 steps" | engine steps |
| **17** | result, "17 of 147 assessed" | controls that got a verdict |

Six numbers, all defensible, no stated relationship. `TECHNICAL_DOCUMENTATION.md:242` has to explain the 137/147 gap in prose, which is the tell.

The column denominators are the worst of it: `trust 1 of 15` means "1 of the 15 rules in this pillar, 14 of which cannot run at this tier". So a *flawless* Tier 1 run leaves every bar at 7–10% full. The bar is measuring against a total the configuration has already ruled out.

## 1.8 `0% healthy` on a pillar that assessed nothing

Run screen, compliance column, final state:

```
compliance    0 of 3 rule specs verified · 0 of 8 requirements · 0% healthy
```

`pillar_progress` carries `healthPercent: 0` for an unassessed pillar, and [run.tsx:481](components/run.tsx:481) prints it verbatim. The engine *already knows better* — it sets `status: "not_assessed"` when `coveragePercent === 0` ([assessment.ts:2050](lib/assessment.ts:2050)) — and the run screen ignores that field. This is the one place in the product where "not assessed" is rendered as a failing score, in a product whose central promise is that it never does that.

## 1.9 The event buffer can silently delete the run screen

[workspace.tsx:352](app/workspace.tsx:352) keeps the last 400 events: `...current.slice(-399)`.

This run produced **226** events for 137 controls — 137 of them `control_result`, the other ~89 fixed overhead (probes, traces, the 56 `check_result`, pillars, per-standard bookends). Only the `control_result` count scales with selection, and 404 controls are selectable. Past roughly **310** selected controls the buffer evicts the head of the stream — which is exactly where `run_plan` lives (event #2).

`plannedChecks` derives entirely from `run_plan` ([run.tsx:215](components/run.tsx:215)). Lose it and the five columns render *empty*, "Every request, as it is sent" renders empty, and the call-in-flight strip loses its rule attribution. The screen degrades to a raw event trace with no warning, at exactly the configuration a serious evaluator would choose.

## 1.10 The audience toggle does not reach these two screens

Switched to **Executive**, the run screen still shows: `POST /v1/web-chat`, `HTTP 200 · 287 ms`, hatched rows labelled `n/a`, "The engineer's rail", and **"Full execution trace — 226 events · each row names the module and function that produced it"** with all 226 cards expanded. The restructure plan's own table says Executive *hides* "sequence numbers, module/function names, execution stage, raw HTTP" ([GOVERNAI_RESTRUCTURE_PLAN.md:579](GOVERNAI_RESTRUCTURE_PLAN.md:579)). Nothing in `run.tsx` reads `register` for gating — only for wording.

Also unchanged after completion: the lede still reads *"The request being sent right now…"* and the eyebrow still says *"step 4 of 4"*, on a finished run.

## 1.11 Everything is lost on refresh

All input, events and results are React state. No URL state, no `sessionStorage`, no persistence ([TECHNICAL_DOCUMENTATION.md:264](TECHNICAL_DOCUMENTATION.md:264)). A refresh during a 60-second run destroys the run; a refresh after it destroys the result. You cannot link a colleague to a finding, and re-configuring costs the full setup again. For an organisation with a portfolio of AI systems this is the whole objection, and the restructure plan says so.

## 1.12 Smaller things worth a line each

- **Credentials pre-filled with live service keys in source** ([workspace.tsx:47–62](app/workspace.tsx:47)) — deliberate and documented, but it means step 4 is never exercised as a real first-run surface, and the "one click to run" convenience hides how hard the real path is.
- **The amber "we cannot reach 124" callout has no action.** It names the fix in prose ("Supply an Evidence Manifest entry…") with nothing to click ([setup.tsx:723](components/setup.tsx:723)).
- **`Ident`-shortened column heads truncate** to "Account." and "Audit" in Executive mode.
- **No cancel.** Once started, a run cannot be stopped.
- **`Rebuild the plan` / `Rebuild`** are exposed as user actions for something the app already does automatically on every change ([workspace.tsx:410–420](app/workspace.tsx:410)). Two buttons for a machine's housekeeping.

---

# PART 2 — HOW OTHER PRODUCTS SOLVE THESE

I looked for products with the same two shapes: **(a)** a configuration step whose job is to scope obligations, and **(b)** a long, opaque, machine-driven run the user must be persuaded to trust. They are not all compliance products; the closest analogues aren't.

## 2.1 Scoping: tax software is the closest analogue, not compliance software

GovernAI's applicability engine is functionally the same object as a tax interview: a large body of rules, most of which don't apply to you, and the product's value is knowing which. TurboTax's answer is that **questions are driven by conditional logic so the user never sees a question that isn't relevant to their situation**, and a handful of early answers determine which forms — and therefore which questions — exist at all.

Two transferable moves:

1. **The scoping questions come first and are few.** A small number of high-leverage answers (industry, data classes, who uses it, jurisdiction) collapse the space before anything detailed is asked. GovernAI has exactly this capability and currently asks it in the wrong order: you pick packs, *then* the packs conditionally reveal their questions.
2. **Removal is shown as progress, not as absence.** "We skipped these because they don't apply to you" is a *feature announcement*. GovernAI computes this and renders it as three zero-bars.

## 2.2 Non-applicability: Lighthouse is the reference implementation

Lighthouse faced precisely GovernAI's `not_assessed` problem and solved it structurally: audits are bucketed into **Passed**, **Failed**, **Not applicable**, and **"Additional items to manually check"**. Not-applicable audits are moved out of the scoring surface entirely and **do not affect the score**; manual checks are listed but explicitly excluded from it.

The lesson for GovernAI is not the vocabulary — GovernAI's `not_assessed` treatment is already more rigorous than most — it's the **layout consequence**: unreachable items are *collapsed into a labelled bucket*, not interleaved as hatched rows in the main list. GovernAI currently renders 51 unreachable rules inline among 5 reachable ones, so the dominant visual texture of the run screen is grey hatching. Lighthouse would have shown five live rows and one collapsed line reading "51 not applicable at this depth".

## 2.3 Long runs: the async-job pattern library

The most directly useful research was a catalogue of async/background-job UI patterns. Nine of the thirteen apply here, and GovernAI implements two:

| Pattern | GovernAI today |
|---|---|
| **Progress counter within pipeline** ("X of Y completed") | Present — but counting the wrong Y (§1.6) |
| **Active step highlight** | Present — the call-in-flight strip is good |
| **Specific contextual microcopy** ("Validating 300 records", "step 4 of 6") | Partial — the strip says it, the bar doesn't |
| **Partial results breakdown** ("20 succeeded, 3 failed, 5 skipped") | Missing as a live summary |
| **Queue status with estimated time** ("why you are waiting") | Missing — the plan's `~17s` estimate is never carried into the run |
| **Retry attempt transparency** ("retried 2× at…") | Missing — `runChatProbe` retries once silently |
| **Status persistence across navigation** | Missing (§1.11) — flagged in the source as *"critical for building trust"* |
| **Cancellation with partial-result clarity** | Missing — no cancel at all |
| **Success summary with outcome details** | Present, on a different screen |

Two further rules from loading-UX research, both directly contradicted by the current build:

- **Past ~10 seconds, show a progress bar *and* a percentage *and* a status line, and let the task collapse into a background state so the user is not blocked.** GovernAI blocks the user for the whole run and shows a bar whose semantics are inverted.
- **Front-load the bar** — fast at the start, slowing at the end — because *"waiting to start a task feels longer than waiting for it to finish"*. GovernAI does the exact opposite: 30 seconds at 0–3%, then a sprint.
- **Skeleton screens beat spinners** because they communicate structure. GovernAI already has the ideal skeleton — the plan is known before the first request — and then leaves it at zero (§1.5).

## 2.4 Compliance platforms: what the onboarding archetypes trade away

The three incumbents have made three different bets, and they map cleanly onto choices GovernAI has to make:

- **Vanta** — self-serve, fastest to first value, automated guides and checklists; the choice for a first-time buyer.
- **Drata** — a structured, guided roadmap **you cannot deviate from**; less flexible, but non-technical users navigate it more easily day to day.
- **Secureframe** — white-glove: the vendor's team does much of the setup, which *reduces the number of decisions the user has to make*; reported to feel like it "works against you" the further you diverge from the standard playbook, and quality drops when the support intensity does.

GovernAI is currently shaped like **none** of the three: it is a self-serve product with an expert-grade configuration surface and no guidance layer. The Secureframe insight is the one to steal without hiring anyone — *reduce the number of decisions* — and the Drata insight is the one to steal for first run only: **make the first path linear and opinionated, and unlock the expert surface afterwards.** Which is what §5.2 of the existing restructure plan already proposes; it just hasn't been built.

## 2.5 CI/CD and agent traces: the shape of a trustworthy log

GitHub Actions' streaming logs deliver **the previous 1,000 lines immediately on open, so a viewer gets instant context into the run's progress** rather than joining a blank tail. Vercel-style deploy views break a run into named phases (install → build → upload), each collapsible, each with its own duration, with exactly one expanded — the phase running now.

The emerging agent-UI protocols (AG-UI and similar) formalise the same insight for LLM agents: users need *"streaming updates, intermediate results, and transparent progress indicators"* over tool calls, and applications need **domain-specific projections** — progress events, structured plans, metrics — rendered live rather than a token stream.

GovernAI's SSE stream is already a well-designed event protocol of exactly this kind, richer than most (`module`, `functionName`, `executionStage`, `probeId`, `ruleId`, `validationMethod`, per-event progress). The gap is entirely in the *projection*: one flat 226-card trace plus a 14-line tail, instead of collapsible phases with durations.

---

# PART 3 — THE REIMAGINED SETUP

Design goal: **the first run should be impossible to configure into a 12% result, and the expert surface should still be there for the second one.**

## 3.1 Two modes for one screen

Keep the single-screen architecture — it is the right call and better than the old five-step wizard. Split it by *audience state*, not by content:

```
FIRST RUN  ─── guided, linear, one decision visible at a time, ~4 decisions total
             ↓ (after the first completed run)
CONFIGURE  ─── the current expert surface, all sections open, editable forever
```

`SetupStage` already receives everything it needs to do this (`result` tells it whether a run has happened). The difference is a `mode` prop and a wrapper that renders one section at a time in guided mode.

## 3.2 Guided first run — four decisions, an accordion, a live rail

```
┌─ SET UP THE RUN ─────────────────────────────────┬─ WHAT THIS MEANS ──────────┐
│                                                  │                            │
│ ✓ 1  Your system      ACI · Finance      [edit]  │  ▸ Connection              │
│ ✓ 2  What we can see  Outside + settings [edit]  │    ● https://…/health  180ms│
│ ▾ 3  Connect                                     │    ● /v1/web-chat      ok   │
│      Base URL   [https://…            ] ● 180ms  │    ○ /api/audit/config      │
│      Audit token[••••••••             ] ● ok     │      401 — token rejected   │
│      Monitoring  [••••••••            ] ○ 401 ↻  │                            │
│                                                  │  ▸ Detected architecture   │
│      Detected: OpenAI · gpt-5.6 · MongoDB Atlas   │    OpenAI · gpt-5.6 ·      │
│                                                  │    MongoDB Atlas · te-3-sm │
│   4  Standards        3 recommended       …       │                            │
│                                                  │  ▸ This run will verify    │
└──────────────────────────────────────────────────┤    ████████░░ 71 of 137     │
                                                   │    52% at this depth        │
                                                   │    ─────────────────        │
                                                   │    Go deeper → +58          │
                                                   │    [ Start · 26 rules ]     │
                                                   └────────────────────────────┘
```

Four changes carry most of the value:

**(a) Depth moves before connection, and connection is tested live.** The credential list is generated from depth already ([setup.tsx:754](components/setup.tsx:754)); make each field own a lamp that fires on blur against a new `POST /api/preflight` (one bounded `HEAD`/`GET` per host, no scoring). This is the restructure plan's "six live lamps", and it converts §1.4's 30-second mystery into a 200 ms answer. It also gives step 3 the thing forms lack: **response**.

**(b) Detected architecture replaces declared architecture.** `/health` already advertises provider, model and vector store, and the audit adapter reports what is actually running. Read it in the preflight and render it as a chip row. This is the single highest-value 20 seconds in the product — *the tool demonstrating it understands RAG specifically, unprompted* — and it currently sits behind a nav item called "scope passport" that nobody opens on a first run. Keep the declared values as a second row where they differ, labelled `declared` vs `observed`.

**(c) The rail's hero number becomes what the run will deliver.** Replace **137 applicable** with **71 of 137 · 52% at this depth**, and put the reachable count in the CTA. The applicable total stays, in the supporting line. One rule: *the biggest number on the screen must be a number the run produces.*

**(d) Guided mode refuses to start a run below a coverage floor.** Not a hard block — a confirm step:

> **This run would check 13 of your 137 requirements (9%).**
> The other 124 need a read-only token or a named evidence procedure — they will be reported as *couldn't check*, never as passing.
> `[ Add a token — takes a minute, +58 requirements ]` `[ Run anyway at 9% ]`

Everything in that dialog already exists: `plan.blindSpots[].closedBy` names the input, and `plan.forecast` has the per-tier delta. It is currently prose in an amber box with nothing to click.

## 3.3 Make the applicability ledger earn its rail position

The card is blank for most industries (§1.3). Three fixes, in order of effort:

1. **Collapse the null case.** When a pack has zero removals and zero unknowns, render one line — `ISO/IEC 42001 · 56 requirements · all apply` — not three bars. Reserve the bar treatment for packs with something to say. This alone reclaims two thirds of the rail.
2. **Show the removals that *did* happen, across packs, as a single list with reasons.** The exclusions detail already exists but is buried in a `<details>` at [setup.tsx:579](components/setup.tsx:579), below the fold, on the left. It belongs in the rail — it is the claim.
3. **Extend applicability conditions past HIPAA/EU.** This is a content job, not a UI job, and it is the real fix: SOC 2 and ISO 42001 have obvious scoping axes (does the system make consequential decisions? is there a human in the loop? is training data customer-derived?). Until packs carry conditions, the ledger's best case is a flat bar — no layout can rescue that.

## 3.4 Sequence and honesty fixes

- Delete the "one screen · about two minutes" eyebrow. In guided mode the accordion makes it true; in configure mode, say what it is: *"Everything about this run, editable at any time."*
- One numbering system. The nav owns it (`1 · Set up`, `2 · Live run`); the page eyebrows stop counting.
- Validate per field, on blur, next to the field. Keep the summary list for launch, but no error should be reported 3,000 pixels from its cause.
- Delete `Rebuild the plan` and `Rebuild`. Replace with the state the rail already shows (`live` / `rebuilding`). A user should never be asked to press refresh on the app's own bookkeeping.
- Move "What we will not do" into the rail as a persistent collapsed line — *"Read-only · bounded · nothing written · credentials never logged ▸"*. Seven safety guarantees at the very bottom of a 3,499 px page is the same as not having them.

---

# PART 4 — THE REIMAGINED RUN

Design goal: **the screen should move when the work moves, and the bar should measure the work the user is waiting for.**

## 4.1 Fix the emission order (backend — do this first)

Nothing on the run screen can be fixed downstream of §1.5. The change is small and structural:

> **Emit each `check_result` as soon as its rule is judged, not after all control mapping.**

Rules are judged from probe facts; the facts exist the moment `collectLiveSignals()` returns. Move the `check_result` loop ([assessment.ts:2025](lib/assessment.ts:2025)) to immediately after evidence collection and before `standard_start` — or better, interleave: as each probe completes, emit the `check_result` for every rule whose `probeId` matches. `plannedChecks` already carries that join ([run.tsx:260](components/run.tsx:260)), so the client needs no change at all.

Second, matching change: **drop `eventDelayMs` to 0 for `control_result`** and let the control-mapping phase take the ~30 ms it actually takes. Artificial pacing was introduced to make progress "human-visible"; once `check_result` events arrive during the probe phase, the screen has real motion and the padding becomes what it is — 12 to 36 seconds of manufactured waiting.

Expected shape after the change, on the same run: ~25 s total (all of it real), five columns filling continuously from second three, bar reaching 100% when the last verdict lands.

## 4.2 Re-base every denominator on the plan

One rule, applied everywhere: **progress is measured against what this run will do, not against the catalog.**

| Surface | Now | Change to |
|---|---|---|
| Header counter | `115 of 146 steps` | `4 of 5 requests sent · 18 of 26 rules verified` |
| Section note | `5 of 56 rule specs verified` | `5 of 5 verified · 51 out of reach at this depth ▸` |
| Column head | `1 of 15 rule specs · 2 of 36 controls` | `1 of 1 verified · 2 of 36 requirements closed · 14 out of reach ▸` |
| Column bar | `done / total` (7% on a perfect run) | `done / runnable` (100% on a perfect run) |
| Progress bar | `completedSteps / 146` | weighted: requests 70%, mapping 30% |

The unreachable rules stop being 51 hatched rows interleaved with 5 live ones and become **one collapsed line per column** — the Lighthouse bucket (§2.2). The five columns then contain 5 rows total on a Tier 1 run, all of them moving, and the honesty is preserved in a line that expands.

## 4.3 Never render an unmeasured pillar as `0% healthy`

[run.tsx:481](components/run.tsx:481): when `assessed === 0`, print `not measured` in the `not_assessed` treatment. The engine already emits `status: "not_assessed"` for exactly this case ([assessment.ts:2050](lib/assessment.ts:2050)); read it. Same rule for the column bar — hatched, not empty-green.

## 4.4 Give the wait a shape

Three additions, all from §2.3, all cheap:

**(a) Phase rail with live durations, replacing the flat trace.** The `phases` memo ([run.tsx:107](components/run.tsx:107)) already derives the engine's own stages from `phase_start`. Promote it to the top of the screen, give each phase its accumulated duration, collapse all but the running one:

```
▸ Probe        5 requests   ●●●●●        12.4 s   done
▾ Evaluate     56 rules     ●●●○○○○      running · 3.1 s
    prompt-injection containment          pass   287 ms  ← guardrail blocked
    combined RAG safety boundary          pass   264 ms
    retrieval grounding and source        pass  10.2 s
▹ Roll-up      3 reports                          queued
```

**(b) Elapsed and expected.** `plan.estimatedSeconds` is computed and shown on the setup screen, then thrown away. Carry it into the run: `0:14 elapsed · ~0:25 expected`. Past 1.5× the estimate, switch the line to *"Your system is slower than expected — still waiting on `GET /health` (32 s)"*. That one sentence is the difference between a cold start and a hang.

**(c) Retry and cancel, both visible.** `runChatProbe` already retries once on 502/503/504 — say so (`retried once after 600 ms`) rather than hiding a 30-second stall. And wire the reader's `AbortController` to a `Cancel run` button, with the partial-result statement the product's own copy already gets right: *nothing partial is scored*.

## 4.5 Make the register toggle real on this screen

Three gates in `run.tsx`, no new content:

| Region | Executive | Compliance | Engineering |
|---|---|---|---|
| Phase rail + five columns + call-in-flight | ✓ | ✓ | ✓ |
| "Every request, as it is sent" | collapsed | ✓ | ✓ |
| The engineer's rail (14-line tail) | ✕ | ✕ | ✓ |
| Full execution trace (226 cards) | ✕ | collapsed | ✓ |
| `HTTP 200 · 287 ms` on the strip | `responded · 287 ms` | ✓ | ✓ |

And make the trace paginated or virtualised when it renders — 226 fully-expanded article cards is most of the page's DOM and all of its scroll.

## 4.6 Two things to keep exactly as they are

- **The call-in-flight strip.** `POST /v1/web-chat · verifying 1 rule · 3 requirements · governance` is the single best component in the product: it answers *what are you doing* and *why* in one line. The `probeId` join that powers it is a genuinely good piece of engineering.
- **The guardrail-blocked treatment.** Painting a 400 as a green pass with *"refused by your guardrail, before retrieval"* is a real insight about the domain, correctly implemented, and it will land in every demo. Do not touch it.

---

# PART 5 — CROSS-CUTTING

## 5.1 One number system, defined once

Publish a `lib/metrics.ts` glossary and use its labels verbatim everywhere, including exports:

| Concept | Canonical phrasing | Never |
|---|---|---|
| Applicable | `137 requirements apply to you` | the hero number |
| Reachable at this depth | `71 checkable now · 66 need deeper access` | "coverage" unqualified |
| Verified | `26 of 26 rules verified` | measured against unreachable totals |
| Closed | `71 of 137 requirements closed` | mixed with rule counts in one sentence |
| Health | `100% of what we checked passed` | a bare `100%` next to a 12% sample |
| Unmeasured | `not measured` / `couldn't check` | `0%` |

The rule that prevents recurrence: **any percentage on screen must render its own numerator and denominator within the same component.** `12%` alone caused §1.7; `assessed 17 ÷ applicable 147` does not.

## 5.2 Survive a refresh

Two steps, in order:

1. **URL state + `sessionStorage`.** Route from `?view=…&pillar=…&finding=…` (already in the restructure plan) and mirror `input` + `result` into `sessionStorage`. Deep links, survivable reloads, and a shareable finding — for a day's work, no schema.
2. **Then persist.** `db/schema.ts` is empty and `getDb()` is uncalled; the recommended tables are already named in `TECHNICAL_DOCUMENTATION.md:409`. Persistence is what turns "a report generator" into "a control", and it is the prerequisite for templates, trend lines and the second AI system costing 90 seconds instead of six minutes.

## 5.3 Design-system notes

The visual system is genuinely good — restrained palette, one accent, real charts drawn from real numbers, a hatch treatment that means something. Four adjustments:

- **The hatch is doing too much.** On a Tier 1 run it covers most of two screens. Once unreachable rules collapse into buckets (§4.2), hatching becomes an accent again — which is what makes it legible.
- **Add one motion primitive.** A row transitioning `queued → verifying → verdict` needs ~150 ms of colour/opacity transition. Right now results appear instantly, which after §4.1 will read as flicker. One `transition: background-color .15s, color .15s` on `.pitem` covers it.
- **`live-dot` is overloaded.** It means "rebuilding", "live", "observed", "not contacted yet", "Live target", "Run complete", "Idle" — seven states, one component, some of them adjacent. Split into `Pulse` (work in flight) and `Stamp` (a settled fact).
- **Don't let `Ident` truncate a column head.** "Account." and "Audit" in Executive mode are worse than wrapping to two lines.

---

# PART 6 — SEQUENCE

Ordered by (impact ÷ effort), and by dependency: 1 unblocks 2–4.

| # | Change | Where | Effort | Why now |
|---|---|---|---|---|
| **1** | Emit `check_result` during the probe phase; `eventDelayMs → 0` | [assessment.ts:2025](lib/assessment.ts:2025), [stream/route.ts:71](app/api/assessments/stream/route.ts:71) | S | The run screen is inert without it (§1.5). No client change needed. |
| **2** | Re-base all run-screen denominators on the plan; collapse unreachable rules into per-column buckets | [run.tsx:283–550](components/run.tsx:283) | M | Kills §1.7 and §1.2's visual despair in one edit |
| **3** | `not measured` instead of `0% healthy` | [run.tsx:481](components/run.tsx:481) | XS | It is the one place the product breaks its own central promise |
| **4** | Elapsed + expected + slow-target line; wire cancel | run.tsx, workspace.tsx | S | Removes the 30-second cold-start mystery |
| **5** | Raise/remove the 400-event cap, or pin `run_plan`/`assessment_start` outside the ring buffer | [workspace.tsx:352](app/workspace.tsx:352) | XS | Latent, silent, and reachable today (§1.9) |
| **6** | `POST /api/preflight` + per-field lamps + detected architecture | new route, [setup.tsx:742](components/setup.tsx:742) | M | Turns the form into a conversation; best 20 seconds in the product |
| **7** | Reachable-first hero number; coverage-floor confirm before a sub-25% run | [setup.tsx:872](components/setup.tsx:872) | S | Stops the default 12% first run (§1.2) |
| **8** | Guided/configure split with accordion; collapse null applicability rows; safety into the rail | setup.tsx | M | Makes "one screen" true instead of aspirational |
| **9** | Register gating on the run screen; virtualise the trace | run.tsx | S | The toggle currently promises something it doesn't do |
| **10** | URL state + `sessionStorage` | workspace.tsx | M | Refresh-safety and shareable links, no schema |
| **11** | Applicability conditions on SOC 2 / ISO 42001 / MAS | `lib/framework-packs/*` | L | Content work; the only real fix for the blank ledger (§1.3) |
| **12** | Persistence, templates, owners, trend | db/, new screens | L | The portfolio story; restructure plan §5.2 already specifies it |

1–5 are roughly two days and fix the run screen. 6–9 are the setup screen. 10–12 are the product.

---

## Sources

- [Designing Better Loading and Progress UX — Smart Interface Design Patterns](https://smart-interface-design-patterns.com/articles/designing-better-loading-progress-ux/)
- [UI patterns for async workflows, background jobs, and data pipelines — LogRocket](https://blog.logrocket.com/ux-design/ui-patterns-for-async-workflows-background-jobs-and-data-pipelines/)
- [How do non-applicable audits work? — GoogleChrome/lighthouse #7660](https://github.com/GoogleChrome/lighthouse/issues/7660)
- [Understanding Lighthouse Accessibility Audit Reports — DebugBear](https://www.debugbear.com/blog/lighthouse-accessibility)
- [Lighthouse Accessibility Audit Guide — Unlighthouse](https://unlighthouse.dev/learn-lighthouse/accessibility)
- [Using Conditional Logic to Improve Form Design and UX — Telerik](https://www.telerik.com/blogs/using-conditional-logic-improve-form-design-ux)
- [How TurboTax turns a dreadful user experience into a delightful one — Appcues](https://www.appcues.com/blog/how-turbotax-makes-a-dreadful-user-experience-a-delightful-one)
- [Building Customer Onboarding Experiences: Lessons from TurboTax — Onramp](https://onramp.us/blog/customer-onboarding-experience-turbotax)
- [Secureframe vs Vanta vs Drata: Who actually delivers on Compliance? — Sprinto](https://sprinto.com/blog/secureframe-vs-vanta-vs-drata/)
- [Drata vs Vanta: A Comprehensive Comparison — Bright Defense](https://www.brightdefense.com/resources/drata-vs-vanta-a-comparison/)
- [Drata vs Vanta vs Secureframe: Which Compliance Tool Is Best? — Silent Sector](https://silentsector.com/blog/drata-vs-vanta-secureframe)
- [GitHub Actions: UI Improvements — GitHub Changelog](https://github.blog/changelog/2024-04-30-github-actions-ui-improvements/)
- [Building Interactive Agent UIs with AG-UI and Microsoft Agent Framework — Microsoft](https://techcommunity.microsoft.com/blog/azuredevcommunityblog/building-interactive-agent-uis-with-ag-ui-and-microsoft-agent-framework/4488249)
- [From Token Streams to Agent Streams — LangChain](https://www.langchain.com/blog/token-streams-to-agent-streams)
- [Progress Tracker Design: UX Best Practices — UXPin](https://www.uxpin.com/studio/blog/design-progress-trackers/)
- [CLI UX best practices: 3 patterns for improving progress displays — Evil Martians](https://evilmartians.com/chronicles/cli-ux-best-practices-3-patterns-for-improving-progress-displays)
- [Progressive disclosure — GitLab Pajamas Design System](https://design.gitlab.com/patterns/progressive-disclosure/)
- [UX for AI Compliance and Regulatory UX in 2026 — Markswebb](https://markswebb.com/insights/ux-for-ai-compliance-regulatory-ux/)
