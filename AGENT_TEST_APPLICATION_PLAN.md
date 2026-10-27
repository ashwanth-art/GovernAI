# ARQ Agent Security Lab — build and deployment plan

Status: planned, not built or deployed by this change. Synthetic data only.

## Purpose

Provide a reproducible application on which ARQ can detect actual agent and MCP
failures, demonstrate the fixes, and compare fresh evidence across runs. Expected
outcomes belong in test assertions, never in the measurements sent to ARQ.

## Application

A small banking-support / retail-orders portal with two tenants, a read-only
support agent, a supervisor, a workload identity and an independent approver.
Use generated customers, order IDs, fake balances and canary secrets that have no
real privileges. The same lab can be assessed under ISO 27001, PCI DSS, DPDP and
the relevant RBI packs, without claiming that the demo supplies bank-wide evidence.

Components:

* React frontend: login, customer/order lookup, agent conversation, approval
  queue and an operator-only scenario dashboard.
* Node API + PostgreSQL: tenant-scoped records, RBAC, approvals, revocations,
  immutable action correlation IDs and durable execution budgets.
* Test IdP: asymmetric JWT/JWKS, explicit audience/scopes, short-lived test tokens
  and invalid-token fixtures. Do not mint or use production identities.
* MCP services: synthetic order reads; simulated refund/export tools; knowledge
  retrieval containing controlled indirect-injection canaries.
* Target-side ARQ gateway: pinned tool definitions, exact grants, tenant/object
  checks, independent approvals and durable state. Backends reject bypass calls.
* Independent scenario runner: exercises the agent/MCP/gateway and derives
  measurement counts from observed responses, traces and database invariants.
  Exposes read-only exports plus the explicitly isolated arq_security_fixture.

Use deterministic scripted agents for reproducible authorization tests, then an
optional model-driven agent for adversarial injection/tool-selection tests. Record
the model, prompt fixture and version; do not treat one successful prompt as proof
of general injection resistance.

## Scenario matrix

| Area | Secure behavior | Seeded failure fixture |
|---|---|---|
| Agent identity | Each agent has owner and distinct workload identity | Unowned agent/shared privileged identity |
| Delegation | User/agent/tenant/scope and expiry remain bounded | Agent gains authority beyond delegated grant |
| Tool authorization | Reader can read approved order, not export/refund | Missing tool scope check |
| Tenant/object access | Tenant A cannot read Tenant B's synthetic order | Missing backend object ownership check |
| JWT | Reject wrong audience/issuer/expiry/signature/scope | Isolated defective verifier fixture |
| Token passthrough | Downstream gets its own scoped credential | Inbound test token appears at fake downstream |
| MCP consent | Client-specific consent, exact redirects and OAuth state | Consent reused for another client / invalid state |
| Tool integrity | Reject changed definition/description/schema | Pinned tool changes after initial discovery |
| Approvals | Independent, expiring, exact and single-use | Self-approval, replay, changed arguments, expired approval |
| Sessions | Request authorization independent of session ID | Cross-user session reuse accepted by defective fixture |
| Prompt/tool injection | Malicious text cannot grant tool authority | Fake document/tool output causes prohibited action |
| Data protection | Canary disclosure and unapproved egress blocked | Canary leaks into output, logs or fake external sink |
| Isolation | Only designated filesystem and destinations accessible | Attempted sandbox/egress escape fixture |
| Audit | Every action attributed to user/agent/tenant/decision | Deliberately dropped identity/approval trace fields |
| Revocation/budgets | Revoked access/kill switch/budget blocks next call | Stale authority cache or process-local quota fixture |
| Local MCP | Pinned executable and minimal environment | Unapproved binary / injected fake environment secret |

The defective implementations must be isolated test doubles behind an authenticated
scenario harness. Never expose a publicly vulnerable general-purpose MCP server,
shell or payment endpoint. No real refund, money movement, bulk export or deletion
is required. A simulated consequential operation updates only a disposable fixture.

## Build sequence

1. **Foundation:** synthetic schema, users/tenants, test issuer and strict backend
   RBAC; deploy secure-only API/frontend; prove isolation and reproducible reset.
2. **Agent + MCP:** implement initialized HTTP MCP tools, public-key validation,
   definitions/pins, actual trace collection and the target-side gateway.
3. **Approval and safety:** authenticate the approver separately, bind approvals,
   add durable consumption, revocation, budgets and correlated audit records.
4. **Failure harness:** add isolated per-scenario test doubles. Test normal/negative
   baselines before any adversarial case. Derive measurements from actual runs.
5. **ARQ integration:** export agent/security evidence with targetOrigin, timestamps,
   explicit asset scope and source references; configure encrypted connections
   in the existing Connect step and run Tier 3.
6. **Regression:** repeat with only one defect enabled, confirm its failure and
   pillar/standard supporting links, fix it, rerun, and confirm the observed change.

## Deployment isolation

Create a separate Azure resource group/environment (suggested name
`rg-arq-agent-lab`), separate database/schema, registry image and managed secrets.
Do not reuse production governance credentials, customer data or permissions.
Expose the secure frontend/API over HTTPS. Restrict the scenario harness and
test exports to dedicated test credentials and approved network sources; keep
defective services internal. ARQ currently cannot access private-IP endpoints,
so expose only the authenticated safe harness/export interface, not weak backends.
Disable unrestricted outbound access; a fake sink receives synthetic canaries only.
Destroy/reset fixtures through an authenticated test operator, not the reviewer.

No cloud resource creation or budget commitment is made by this plan. Before
building, confirm the lab's Azure subscription, budget, identity provider and
whether optional model-driven tests may incur model usage charges.

## Acceptance criteria

* Secure fixtures meet their measured predicates; every seeded defect is caught.
* Wrong/expired credentials cannot create passing denial tests without a valid
  baseline. Missing evidence remains unresolved, not pass/fail by assumption.
* Approval replay/concurrency and budget limits hold across at least two replicas.
* Direct backend calls cannot bypass gateway/object authorization.
* Every result carries source, timestamp, rule, fixture/run ID and evidence hash;
  no real tokens, sensitive bodies or canary secret values enter reports.
* All 16 agent/MCP checks are verified using actual evidence in their appropriate
  layers/pillars. Standard verdicts change only where their complete predicates
  are actually established; no broad regulatory pass from a narrow tool test.
* The existing six-step ARQ flow and unrelated standard counts remain unchanged.
