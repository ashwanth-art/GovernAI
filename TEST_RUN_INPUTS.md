# Test run input sheet — Tier 1 through Tier 3

**Every field below is already pre-filled in the app.** Open it, pick a tier, press start.
This sheet says what those values are, why each one is there, and what each tier should
produce so you can tell a good run from a broken one.

The defaults live in `DEMO_CREDENTIALS` in [app/workspace.tsx](app/workspace.tsx) and are
all editable in step 4 — replace any of them to point at your own system.

---

## 1. Start the app

Node 22 is required — `vinext` will not boot on the system Node.

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH" && cd "/Users/HXT/AI Governance" && npm run dev
```

The dev server prints its port and picks a free one, so read it off the console rather than
assuming. `vinext dev` ignores `PORT`; if you need a fixed port use `.claude/launch.json`,
which forwards `-- --port`.

Before a Tier 2 or Tier 3 run, wake the target — it is on Render's free tier and cold-starts
in roughly 50 seconds. A run against a sleeping target reports adapter facts as
`not_assessed`, which is correct behaviour but a poor demo.

```bash
curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" https://chat-bot-22j5.onrender.com/health
```

Expect `200` and a fast second call.

---

## 2. The three service keys

Tier 2 and Tier 3 read protected adapters on the target, each behind its own bearer token.
All three are **already filled in** — the fields are password-masked, so nothing legible
appears on screen during a demo.

| Form field | Same value as | Guards |
| --- | --- | --- |
| Chatbot API key | `CHATBOT_API_KEY` in `.env` | `POST /v1/chat` |
| Audit/config API key | `CLOUD_AUDIT_API_KEY` | `GET /api/audit/config`, `GET /api/evidence/manifest` |
| Monitoring API key | `MONITORING_API_KEY` | `GET /api/monitoring/summary`, `GET /api/monitoring/requests/{id}` |
| Evidence manifest token | `CLOUD_AUDIT_API_KEY` again | the manifest has no key of its own |

If a run starts returning `403` from the adapters, the two copies have drifted — compare
them:

```bash
grep -E '^(CHATBOT_API_KEY|CLOUD_AUDIT_API_KEY|MONITORING_API_KEY)=' "/Users/HXT/AI Governance/.env"
```

The keys are sent to the target as `Authorization: Bearer …` and to nowhere else. They are
redacted from the execution log, and never reach a report, an event or an export.

All three are the target's own `…-change-before-deploy` placeholders. Fine for a demo on a
throwaway service; because they now sit in a tracked source file, clear the
`DEMO_CREDENTIALS` block before this app points at anything real.

---

## 3. Step 1 — Identity and industry

| Field | Value |
| --- | --- |
| Organization | `ACI Infotech` |
| System name | `ACI Knowledge Assistant` |
| Industry | `Finance / Banking` |

The RAG architecture is no longer asked here. It is configuration on the **scope passport**
(left nav, under SETUP), pre-filled with the values below. Check them once; you do not need
to touch them again.

| Passport field | Value |
| --- | --- |
| Model provider | `OpenAI` |
| Model name | `gpt-5.6-sol` |
| Vector database | `MongoDB Atlas Vector Search` |
| Embedding model | `text-embedding-3-small` |

From Tier 2 the audit adapter reports what the service is actually running, and the
passport's **What the run observed** card shows it beside your declaration. On this target
the two agree: `gpt-5.6-sol`, `text-embedding-3-small` at 1536 dimensions, retrieving from
`openai_vector_index` filtered on `tenant_id`.

---

## 4. Step 2 — Framework packs

Finance pre-selects the three packs that carry authored, tier-split controls. **Leave this
selection alone for the main demo** — these are the only three where every control has an
evidence path, so Tier 3 reaches 97% on the inputs below and 100% once a GitHub read-only
token is added (see §7).

| Pack | Controls | Provenance badge | Why it is in the demo |
| --- | --- | --- | --- |
| ISO/IEC 42001 | 56 | native mapping | Every control in the verification library |
| SOC 2 Type II | 49 | native mapping | Client-trust framing of the same evidence |
| MAS FEAT | 32 | native mapping | Financial-sector, mandatory in Singapore |

Total **137 controls** across the three, plus the always-on OWASP LLM Top 10 pack's 10, which
is why the strip at the bottom reads **/147** and not /137. With this selection step 4 says
*"Nothing to answer for this selection"* — none of the three gate their controls on your
organizational role.

**Read the grey line on each pack card.** `native mapping — a rule spec per control` means
every verdict from that pack came from a rule written for that specific control. The three
finance packs all say this. The amber variant — `N of M judged by pillar proxy` — means that
many controls have no rule of their own and are answered by a pillar-level probe instead. The
evidence is real, but it is about the pillar's behaviour rather than the clause's text, and
the app repeats the warning on the check row, in the drawer, and in the printed report.

Twenty more packs are available behind the search box (HIPAA, NIST AI RMF, EU AI Act, SR
11-7, NYC LL144, and so on). Adding one promotes it to a full card so you can read its
provenance badge before running. Six of them (HIPAA, NIST AI RMF, EU AI Act, and the three
above) are natively mapped; the rest are 50–75% pillar proxy at Tier 3 — NYC LL144, for
instance, shows `6 of 8 judged by pillar proxy`. Add them to show breadth, not depth — and see
[section 9](#9-optional-adding-a-gated-pack) for the extra questions they raise.

---

## 5. Step 3 — Depth

Run the tiers in order in the same session so the numbers climb in front of the audience.
Nothing is persisted between sessions, so a reload starts over.

| Tier | Name | What it adds |
| --- | --- | --- |
| 1 | black-box | Public behaviour only — bounded prompts, judged answers |
| 2 | gray-box | Read-only audit, monitoring and request-trace adapters |
| 3 | white-box | Named evidence procedures from the GovernAI manifest, plus provider APIs |

---

## 6. Step 4 — Credentials, by tier

All of this is already filled in. Each tier keeps everything from the tier below it, and the
field list regenerates when you change the depth in step 3 — Tier 1 shows 3 fields, Tier 2
shows 8, Tier 3 shows 18.

### Tier 1 — 3 fields

| Field | Value |
| --- | --- |
| Chatbot base URL or API endpoint | `https://chat-bot-22j5.onrender.com/` |
| Tenant ID *(optional)* | `aci-infotech` |
| Chatbot API key *(optional)* | filled — same as `CHATBOT_API_KEY` |

The public `/v1/web-chat` route needs no key, so Tier 1 works with the URL alone. It is
filled anyway, because the same value is required from Tier 2 up.

### Tier 2 — the 3 above, plus 5

| Field | Value |
| --- | --- |
| Infrastructure provider | `Render` |
| Audit/config API key | filled — same as `CLOUD_AUDIT_API_KEY` |
| Monitoring provider | `Prometheus` |
| Monitoring API key | filled — same as `MONITORING_API_KEY` |
| CI/CD pipeline URL | `https://github.com/ashwanth-art/chat_bot/actions` |

The two provider names are context labels only. Tier 2 reads the target application's own
adapters; it does not sign in to Render or to Prometheus. The CI/CD URL is a reachability
check — no workflow logs are read.

### Tier 3 — the 8 above, plus 5

| Field | Value |
| --- | --- |
| Source repository URL | `https://github.com/ashwanth-art/chat_bot` |
| Staging environment URL | `https://chat-bot-22j5.onrender.com/` |
| Model registry URL | `https://platform.openai.com/docs/models` |
| Evidence manifest URL | `https://chat-bot-22j5.onrender.com/api/evidence/manifest` |
| Evidence manifest token | filled — the audit key again, the manifest has none of its own |

**The evidence manifest URL is the field that makes Tier 3 work.** Clear it and the 30
document and artifact controls have no named procedure to read, so every one of them
reports `not_assessed` — coverage stalls near 51% and the run looks identical to Tier 2.
If Tier 3 comes back well below 97%, check this field first.

Three further Tier 3 fields are deliberately left **empty** — this target has no Datadog and
no Grafana, so a value there would invent an integration that does not exist:

| Field | Leave blank because |
| --- | --- |
| Provider monitoring API URL | No external observability provider |
| Provider monitoring API key | — |
| Datadog application key | — |

**GitHub read-only token — the one field that separates 97% from 100%.** Left blank, because
no token ships with this sheet. The repository is public, so the collector reads its metadata
unauthenticated and `artifact-change-history` passes; but `GET /branches/main/protection` and
`GET /actions/permissions` are admin-scoped endpoints that answer **401** without a token. Two
procedures — `artifact-access-review` and `artifact-security-tests` — therefore go unresolved,
and the four controls that depend on them report `not_assessed`:

| Pack | Control | Requirement |
| --- | --- | --- |
| ISO/IEC 42001 | A.3.3 | Entitlement review |
| ISO/IEC 42001 | A.6.2.12 | Security test gate |
| SOC 2 Type II | CC6.2 | Entitlement review |
| SOC 2 Type II | CC8.1.3 | Security test gate |

This is the product behaving correctly — it reports what it could not reach rather than
assuming a pass. To demo 100%, paste a fine-grained GitHub token with read access to the
repository's administration and actions scopes into this field. To demo the honest-gap
behaviour instead, leave it blank and open **What deeper access would close**.

---

## 7. What each tier should produce

Verified against the live target on 30 July 2026, with the inputs exactly as listed above —
**including the GitHub token left blank.** Small drifts in health are normal: the service
reports live facts and its own metrics move. Coverage, finding count and playbook count
should match exactly.

| | Tier 1 | Tier 2 | Tier 3 |
| --- | --- | --- | --- |
| Applicable controls | 147 | 147 | 147 |
| Assessed | 17 | 75 | **143** |
| Coverage | 12% | 51% | **97%** |
| Health | 100% | 78% | 80% |
| Exposure index | 0 | 87 | 99 |
| Checks that ran | 5 of 62 | 26 of 62 | 60 of 62 |
| Findings | 0 | 7 | 16 |
| Playbooks | 0 | 7 | 16 |
| Open gaps | 130 | 72 | **4** |
| Directly tested | 17 of 17 | 75 of 75 | 143 of 143 |

The Tier 3 column is the measured floor, not a ceiling. Adding a GitHub read-only token
unblocks the two checks and the four controls named above, which by derivation takes the
column to 100% · 147 of 147 · 62 of 62 checks · 0 open gaps — **derived from the gap, not
measured**, because no token was available when this sheet was verified. Confirm it on the
run screen before quoting it in a demo.

Directly tested is 100% at every tier here because all three finance packs are natively mapped —
no control in them falls back to a pillar proxy. That is a property of the packs, not of the run:
add NYC LL144 (155 controls) and Tier 2 reports **91% · 75 of 82 · 7 judged by a pillar proxy**,
the Checks & rules tab grows a `pillar proxy only · 5` filter, and each of those five rules carries
a stand-in warning above its rule spec. Use that contrast if someone asks how you know the
verdicts mean what they say.

At Tier 3 the **What deeper access would close** panel shows a single group of 4 — the
GitHub-blocked controls above. It is worth opening: it is the clearest demonstration that the
product distinguishes "could not reach" from "failed". Supply the GitHub token and the panel
disappears entirely rather than rendering empty, because there is nothing left to group.

147, not 137: the three packs contribute 56 + 49 + 32, and the OWASP Top 10 for LLM
Applications 2025 is always assessed alongside them. Reading `reports[].controls` from the
API gives 137 for the same reason — it excludes the always-assessed OWASP pack. The number
the overview screen shows comes from `analysis.posture`, which is the one to quote.

Tier 1's 100% health is the honest reading, not a good sign — five checks ran and all five
passed, over 12% of the applicable set. This is exactly why coverage, health and exposure
are three numbers and never one blended score.

Per-pillar at Tier 3: trust 45/45 and health 76%, security **65/69** and health 77%, data
protection 31/31 and health 68%, governance **69/71** and health 88%, compliance 46/46 and
health 77%. Security and governance sit below their rings because the four GitHub-blocked
controls carry both pillars — 4 controls, 6 pillar slots. At Tier 1 the compliance pillar has
nothing assessed, so its health reads **n/a** rather than 0% — an unassessed control is never
a pass and never a failure. Tier 2 pillar coverage: trust 21/45, security 40/69, data
protection 18/31, governance 34/71, compliance 16/46.

### Tier 2 findings — 7

All measured from facts the target reports about itself. Nothing here is seeded.

| Severity | Pillar | Finding |
| --- | --- | --- |
| Critical | trust | Retrieval corpus integrity against approved baseline did not hold |
| Critical | security | Service credential strength and rotation did not hold |
| High | security | Production deployment hardening did not hold |
| High | data protection | Data retention and disposal schedule did not hold |
| Medium | security | Request-rate and cost ceilings is only partially met |
| Medium | compliance | Breach detection reaches a human is only partially met |
| Low | trust | Service levels against declared objectives is only partially met |

What is actually wrong on the target, in order: one corpus document's live sha256 no longer
matches its approved baseline; three service keys are the `change-before-deploy`
placeholders; the environment is labelled `development` with loopback-only CORS on a public
host; no retention schedule with enforced disposal; rate limits exist but are not enforced
across instances; five Prometheus alert rules exist but no receiver routes them anywhere;
conformance against the declared objectives is not yet measurable on the traffic seen.

The alerting finding is a good one to talk through. It reads *partially met*, not *failed*,
because `alerting_posture()` parses the rule file Prometheus actually loads — five rules with
`severity` and `objective` labels are really there. What is missing is the receiver, so a
firing alert stops at the dashboard. Delete a rule from `monitoring/alert_rules.yml` and the
verdict changes, which is the point: the check reads the target, not a fixture.

The two *"only partially met"* entries are worth pointing at in a demo — a partial verdict
becomes a real finding ranked one step below the same check failing outright, because the
control is doing something, just not enough.

### Tier 3 findings — 16

The 7 above, plus 9 from named evidence procedures:

| Severity | Pillar | Finding |
| --- | --- | --- |
| Critical | trust | Retrieval corpus provenance and approval did not hold |
| Critical | trust | Data and Model Poisoning did not hold |
| High | trust | Bias and adverse-impact testing did not hold |
| High | data protection | Records retention evidence did not hold |
| High | security | Improper Output Handling is only partially met |
| Medium | trust | Evaluation methodology and acceptance thresholds is only partially met |
| Medium | security | Audit log content and review is only partially met |
| Medium | security | Unbounded Consumption is only partially met |
| Low | governance | Continuity and recovery capability is only partially met |

None of the 16 comes from the four GitHub-blocked controls. An unreachable control produces a
gap, never a finding — that separation is the point.

The manifest serves 47 procedures — 39 pass, 4 fail, 4 partial — across three evidence
kinds: **measured** (0.95 confidence, recomputed when read), **build** (0.90, from CI) and
**attested** (0.70, decaying once past `review_due`).

---

## 8. What to show, screen by screen

The left rail is three groups: **Posture** (overview, findings, playbooks), **Pillars** (the
five pillars plus **Monitors**), and **Evidence** — one door onto four tabs, because the
record-shaped screens are for the sceptic in the room, not the first pass.

0. **Live test run** — the call being made, and what that call is verifying.

   A strip at the top names the one request in flight — `POST /v1/web-chat · Sensitive-information
   disclosure` — and beside it, what that request closes: `verifying 1 rule spec · 3 controls ·
   data_protection`. When a call is recorded as evidence but no rule at this tier reads it, it says
   so instead of showing a zero; at Tier 2 the CI/CD reachability HEAD is the one such call.

   Under it, **five columns, one per pillar, complete before the first request is sent**. Every
   rule is listed from the start, and each row moves `queued` → `verifying` (highlighted, the
   moment the call it depends on goes out) → its verdict, with the number of controls it closed.
   Rules this depth cannot reach are hatched and read `n/a`, with the reason on hover — never as a
   pass. Watch a pillar's header fill in:

   | Pillar | Rules verified | Controls closed | Health |
   | --- | --- | --- | --- |
   | trust | 5 of 15 | 14 of 36 | 79% |
   | security | 10 of 21 | 26 of 49 | 70% |
   | data_protection | 4 of 7 | 11 of 17 | 67% |
   | governance | 4 of 10 | 12 of 27 | 82% |
   | compliance | 3 of 3 | 8 of 8 | 72% |
   | **total** | **26 of 56** | **71 of 137** | — |

   Below the columns, **every request as it is sent**: method, path, HTTP, latency and verdict. Two
   rows read `guardrail blocked · HTTP 400` in green — those are your own prompt-injection and
   credential-extraction guardrails refusing the probe **before retrieval or generation**, which
   is why they answer in ~260 ms while the one grounded probe takes 10–11 s. The section header
   states plainly that **no verdict on the screen is judged by a model**: every verdict is a rule
   in code, and the only model in the loop is your assistant's.

1. **Overview** — four separate numbers, never blended. Coverage is `assessed ÷ applicable`;
   health averages only what was assessed; exposure weights open findings by severity; and
   **Directly tested** is the fourth — how many assessed controls were judged by a rule written
   for them. With the three finance packs it reads `100% · 75 of 75 · No pillar proxies were used
   in this run.` Add a proxy-heavy pack and the number drops and names the remainder.

   Under the four numbers, **What deeper access would close** groups every `not_assessed` control
   by the single input that would close it — at Tier 2 that is one card, `+72 · Tier 3 ·
   white-box · Supply an Evidence Manifest entry for the named procedures`, with the packs and
   the per-pillar split beneath it. It is priced in controls rather than percentage points,
   because the question a reader is actually asking is *how many controls does that one token
   buy*. The panel states outright that these are not failures.

   Further down, the readiness table carries a **Directly tested** column per pack, and the
   always-on OWASP LLM Top 10 appears as its own row labelled `always on — not a selection`. Its
   action button says **Controls** rather than **Report**, because it has no native report
   structure — it sends you to the rule ledger where its controls live. The `Applicable` column
   sums to exactly the `/147` in the bottom strip; a test asserts this so the two cannot drift.
2. **Findings** — grouped by severity, each naming the controls and standards it closes.
3. **Remediation playbooks** — owner, effort in hours, ordered steps with a `where`, and a
   verification line naming the check that closes the finding.
4. **Pillars** (five in the left nav) — the same run cut by pillar.
5. **Monitors** — arm one and it runs. See section 8a.
6. **Evidence & detail** → **Proof** (the evidence ledger, with the 47 named procedures and
   their kind, confidence and collection time), **Checks & rules** (every check with its
   published rule spec, the request it made and its verdict — where a sceptic goes; a
   `pillar proxy only · N` filter chip appears here **only when the run used one**, and the
   CSV export carries a `rule_provenance` column),
   **Standards** (the framework matrix) and **Scope passport** (declared architecture beside
   what the run observed). With no run yet the door opens on Scope passport, the only tab that
   needs no result, and the other three are locked rather than blank.
7. **Export** — JSON, or the printable report per standard.

---

## 8a. Monitors — the part that runs after the report

Left nav → **Monitors**, under Pillars.

There are **nine** monitors because there are only two operations — re-read the read-only
adapters, re-run the bounded probes — cut by the pillar they report against, which is the unit
the request cost is paid in. The table groups them under those two method headers, so nine rows
read as two operations rather than nine chores. At Tier 2 that is 5 adapter-read groups
(1260 requests/month) and 4 live-probe groups (600), 1860 in total if all nine are armed.

### The five scores at the top

One card per pillar, and nothing else above the controls. Each shows the share of that pillar's
watched checks passing, the movement since the previous cycle, a trend line, and how much of the
pillar is watched:

| Pillar | Tier 2, this target | Watched |
| --- | --- | --- |
| trust | 60% | 5 checks · 2 monitors |
| security | 70% | 10 checks · 2 monitors |
| data_protection | 75% | 4 checks · 2 monitors |
| governance | 100% | 4 checks · 2 monitors |
| compliance | 67% | 3 checks · 1 monitor |

Three things about these numbers:

- **They are populated the moment the run finishes**, before anything is armed — the run already
  measured these checks, so the card reads `from this run` where the delta will go. Arming
  re-measures them; it does not create them.
- **A pillar with nothing read shows `n/a`, never `0%`** — the same rule the posture screens use.
- **The delta is against the previous cycle only**, as `▲ 8 pts` / `▼ 12 pts` / `steady`, and is
  absent until a second cycle exists.

Cycles, armed count, request cost and next due time sit on one line beside the buttons
(`14 cycles · 9/9 armed · 1860 req/mo · next 8:13 PM`) rather than as headline numbers — they
describe the machinery, not your posture. A standing regression appears as a red banner above the
scores, naming the checks.

1. Press **Arm all 9**, or flip individual switches, or arm one whole method with **Arm these**
   on a group header. Arming validates the input the same way a run does, stores that input in
   the server's memory, and runs a cycle immediately. Nothing arms itself after a run: arming
   holds credentials, so it stays a deliberate act with its cost stated next to it.
2. The cadence chip then shows two numbers: the declared cadence (`every 12 hours`) and
   `every 30m here`. A twice-daily monitor cannot be demonstrated in a meeting, so this screen
   arms at 30 minutes and says so rather than quietly redefining the cadence. The `req/mo` figure
   beside the buttons is labelled `declared` for the same reason — arming at 30 minutes spends
   more than the declared cadence would, and one number must never stand for both.
3. **Run a cycle now** forces one. A cycle re-runs the same assessment code path against the
   live system and keeps only the readings for armed monitors — drift is therefore the
   target changing, never a second code path disagreeing with the first.
4. **What changed between cycles** appears from the second cycle on, and is a before/after
   diff rather than a log. Three things make it readable:
   - **One row per check, not per occurrence.** A check whose live numbers move every cycle
     produced one entry per cycle; the panel keeps its newest movement and counts the rest
     (`4 cycles`), so the list cannot grow past the number of watched checks.
   - **Verdicts that moved come first**, as `pass → fail` status pills with *needs attention*
     or *recovered* beside them, and the was/now evidence one click away.
   - **Evidence that moved under a steady verdict is collapsed** behind one line
     (`5 checks moved evidence without changing verdict`) — reported, not hidden, and not
     competing with the rows that matter. Live latency and request counts move on every cycle,
     and labelling that a change of posture would be a lie a dashboard tells easily.

   Every row shows the previous evidence above the current one, so the movement is visible as
   text: `only 8 request(s) have accumulated` → `only 12 request(s) have accumulated`.
5. **Cycle history** lists one row per completed cycle: readings taken, changes seen, duration
   and trigger. The per-pillar trend lines at the top carry the pass rate over time, so there is
   no separate heartbeat chart to reconcile against them.

Two costs are stated on the screen rather than hidden: arming holds the run's read-only tokens
in the server process until you disarm, and cycles advance only while the app is reachable —
history lives in memory, so a restart resets it and the reset is reported as a reset. "While the
app is reachable" is literal and not limited to this screen: the monitor state is read from the
workspace shell, so the status strip reports the next due cycle (`next monitor 7:59:30 PM`,
`due now`, or `nothing armed`) on every screen, and the schedule advances wherever you are.

What a live demo will actually show, against this target: `evidence changed` on
`chk.monitoring.slo-conformance` and `chk.monitoring.trend-visibility` between two cycles,
because the observed latency and the windowed bucket counts really do move. To show a
**regression** and an alert, break something the adapter reads — remove a rule from
`monitoring/alert_rules.yml` and redeploy, and `chk.monitoring.objective-coverage` drops from
pass to partial on the next cycle. An improvement is reported as an improvement and clears
the alert; it never raises one.

---

## 9. Optional — adding a gated pack

Add HIPAA or the EU AI Act in step 2 and step 4 grows a set of applicability questions.
**These are pre-answered too**, so adding a pack mid-demo does not stall on a form. The
answers are the ones a finance assistant that touches no health data would give:

| Question | Answer |
| --- | --- |
| Role under HIPAA | `Not regulated` |
| Handles protected health information | No |
| Is that health information electronic | No |
| Anyone outside your organization touches that data | No |
| Keep a designated record set | No |
| EU AI Act territorial scope | `Out of scope` |
| Role under the EU AI Act | `Provider` |
| Risk classification | `Limited or minimal` |
| Article 27 deployer | No |
| People talk to it directly | **Yes** |

Answering `Not sure yet` is deliberately not free: those controls are neither scored nor
excluded, and they show up as unresolved rather than quietly disappearing. That is worth
demonstrating once — set a gating question back to `Not sure yet` and watch the applicability
result explain what it could not decide.

---

## 10. Alternative — drive it from the API

`POST /api/assessments` takes the same payload the UI sends, so a run is scriptable without
clicking:

```jsonc
{
  "organization": "ACI Infotech",
  "systemName": "ACI Knowledge Assistant",
  "industryId": "finance",                      // healthcare | finance | insurance | hr | education | autonomous_vehicles | legal | manufacturing | media | government
  "standardIds": ["mas_ai", "soc2", "iso42001"],
  "tier": 3,                                    // 1 | 2 | 3
  "applicability": { "hipaaRole": "not_regulated", "handlesPhi": false, "handlesEphi": false,
                     "usesPhiSubprocessors": false, "maintainsDesignatedRecordSet": false,
                     "euTerritorialScope": "out_of_scope", "euRole": "provider",
                     "euRiskClass": "limited_or_minimal", "euArticle27Deployer": false,
                     "directHumanInteraction": true },
  "architecture": { "modelProvider": "OpenAI", "modelName": "gpt-5.6-sol",
                    "vectorDatabase": "MongoDB Atlas Vector Search",
                    "embeddingModel": "text-embedding-3-small" },
  "credentials": { }                            // the fields from section 6
}
```

Two things that return `422` if you get them wrong: the keys are **`tier`** and
**`credentials`**, not `accessTier` or `endpoint`; and `industryId` must be one of the ten
ids listed above. `GET /api/plan` takes the same body and forecasts what a run would reach
without sending a single request to the target.

`/api/assessments` returns `analysis.posture` — the same `applicable`, `assessed`,
`coveragePercent`, `healthPercent` and `exposureIndex` the overview screen renders. Counting
`reports[].controls` instead gives 137 rather than 147, because the OWASP pack is not one of
the selected standards.

`POST /api/monitors` drives the monitor engine with the same payload the Monitors screen
sends: `{"action":"arm","monitorId":…,"input":…,"plan":…,"cadenceSeconds":1800}`, and
`{"action":"cycle"}` forces a cycle. `GET /api/monitors` returns the state and runs any cycle
that has fallen due — that read is what advances the schedule, so nothing runs while nobody is
looking. No response from either ever contains a credential; `credentialsHeld` says whether
tokens are held, never what they are.

---

## 11. If something looks wrong

| Symptom | Cause |
| --- | --- |
| Tier 3 coverage stops near 51% | Evidence manifest URL or its token is missing or wrong |
| Every adapter fact `not_assessed` at Tier 2 | Audit/monitoring key wrong, or the target is cold — curl `/health` first |
| Health reads `n/a` | Nothing was assessed in that scope. Correct, not a bug — it is not zero health |
| A control reports `not_assessed` at Tier 3 in a generator-built pack | Expected: only the three authored packs have a verifiable path for every control |
| `403` from an adapter | Key mismatch between `.env` here and the target's Render environment |
| Dev server will not start | Wrong Node. Re-run the `export PATH` line from section 1 |
| Monitor history empty after a restart | Expected: cycles live in the server process only, and the screen says so |
| An armed monitor shows `due` and never cycles | The schedule advances when the state is read. Open the Monitors screen, or `GET /api/monitors` |

An absent signal is never recorded as a pass. Every `not_assessed` in a run says which fact
was missing and why the verdict was withheld.
