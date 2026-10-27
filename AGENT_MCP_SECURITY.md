# Agent and MCP security (2026-10-27)

## Shipped assessment capabilities

The six setup steps and selected standard control counts are unchanged. The
internal technical library now contains 85 checks: the existing 69 plus 16 agent
and MCP evaluations. No new selectable compliance pack is introduced.

Add an `agent_mcp` connection inside Connect. Its required `url` is a read-only
agent test-evidence export. Optional `mcpUrl` supports bounded Streamable HTTP
initialization and tools/list (2025-11-25; JSON or bounded SSE response bodies).
`exportToken` authenticates export reads; `token` authenticates MCP discovery.
Both are encrypted by the existing connection store and excluded from reports.

Download `/api/reviews/agent-template?target=https://your-app.example` for the
13-rule measurement contract. It covers identity ownership, delegation,
tool/resource access, approval replay/binding, sandbox/egress, injection,
data/exfiltration, action attribution, revocation/budgets, token validation,
per-client consent, sessions and local MCP executable/secret isolation.

These are measurements exported by a connected test tool, not native proof of all
those mechanisms. Unknown rules, stale/cross-target records and malformed counts
are rejected. Tested populations must be positive; incomplete coverage cannot
pass. A valid positive violation can fail within an incomplete source scope.
The export cannot supply arbitrary procedure IDs or override a native failure.
Full measurements and native observations remain supporting checks, never an
automatic pass for a larger banking or privacy obligation.

### Native observations

* **Definition integrity:** compare full canonical JSON tool definitions against
  operator-reviewed SHA-256 pins, including descriptions, schemas and annotations.
  Up to 100 tools / 3 pages. Truncation or absent pins cannot pass. Definitions
  are data, never executed or sent to models. An annotation is not authorization.
* **Resource metadata:** `metadataUrl` must be on the explicitly configured MCP
  origin. Compare resource and issuer to `expectedAudience` and `expectedIssuer`.
  Discovered authorization/token URLs are never automatically followed. This
  checks metadata binding, not whether an implementation validates tokens.
* **Sandbox authorization matrix:** off by default. Enable only with approved
  `sandbox: {approved:true,id:"lab-id",fixtureTool:"arq_security_fixture"}`,
  at most four dedicated identities and twelve tests. Each identity needs an
  allow baseline. The MCP initialization must confirm the same `arqSandboxId`
  and `syntheticOnly:true`. Only that fixture tool can be invoked. Arguments
  are restricted to fixtureId/action/tenantId/resourceId identifiers. A negative
  case passes only after a baseline and HTTP 403; 401, 404, tool errors and
  redirects are inconclusive. No real payment, deletion or ordinary tool call
  is performed by this assessment connector. The sandbox declaration itself
  is a source/operator trust assertion, not proof of host isolation.

Profiles are pinned to the assessed application origin. Explicitly configured
remote MCP/export origins are bounded by the existing public-DNS broker,
no-redirect policy and shared request/time/body budgets. Local stdio servers are
assessed through exported inventory/test evidence; ARQ does not launch arbitrary
packages or executables.

## Optional target-side enforcement component

`server/agent-security/gateway.mjs` provides an opt-in, stateless JSON MCP handler
for initialize, tools/list and tools/call. **It is not mounted in the ARQ
assessment server and has not been integrated into any customer's application.**
It must run in the target application's trusted execution path, with no bypass
to tools/backends. It is not a full general-purpose MCP proxy/OAuth server.

Required integration:

1. Configure a fixed HTTPS resource/issuer and asymmetric public JWKS keys.
   `createJwtIdentityVerifier` requires signed, short-lived user/agent/tenant,
   token-ID and scope claims. Tokens are never forwarded to tool adapters.
2. Supply exact grants: subjects, agent IDs, one tenant, scopes, pinned definition,
   typed JSON input schema (no remote references or regex patterns), tenant-qualified resource prefixes, effect and budget.
   No wildcard grants; one grant per tool/tenant. Do not derive grants from prompts
   or tool annotations. Adapters must also check actual object ownership.
3. Provide trusted loadTool/invokeTool adapters with independent downstream
   credentials and endpoint allowlists. The invocation interface never receives
   inbound authorization headers. Backend object authorization, DLP, sandboxing,
   network restrictions and idempotency remain essential adapter/host controls.
4. Provision `agentStateSchema` in `postgres-state.mjs` through a DBA migration.
   Use its atomic budget and approval consumption plus revocation and audit
   adapters across replicas. Do not replace this with an in-memory store in
   production. Give the gateway SELECT + UPDATE(consumed_at) on approvals,
   SELECT-only revocations, bounded budget INSERT/UPDATE/SELECT, and audit INSERT
   (plus sequence usage). It must not insert approvals, modify approvers or delete
   revocations/audit rows. Retain budget/audit rows under an explicit retention policy.
5. Connect a separately authenticated human approval workflow. Only that workflow
   may insert approvals; the gateway exposes no approval-creation endpoint.
   Each approval stores a SHA-256 binding of user, agent, tenant, tool, exact
   arguments, policy version and tool definition, an independent approver and
   expiry. A model cannot self-approve. Consumption is single-use and atomic.
6. Enable the policy only after allow/deny tests. A global revocation row
   (`global`,`*`) is the runtime kill switch. Check revocation before dispatch.
   Missing state/audit/approval or changed definitions fail closed. A failed
   response after dispatch does not prove the action did not happen: target
   adapters must implement durable idempotency and operator reconciliation.

The handler serves protected-resource metadata and verifies authorization on
every request; it has no session ID that can substitute for identity. Browser
origins must be explicitly allowed. Local stdio execution and sandbox policy
enforcement are outside this HTTP handler.

## References

* MCP authorization: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
* MCP tools and untrusted annotations: https://modelcontextprotocol.io/specification/2025-11-25/server/tools
* MCP security guidance: https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices

These versioned references guide authored checks. No blanket MCP/regulatory
certification or whole-environment assurance is claimed.
