# Seven-pillar evidence review

The existing six setup steps and pass/fail-only standard report remain unchanged.
Deployment Review is now an internal evaluation library, not a selectable or
recommended compliance pack. Its versioned definitions (`2026.10-draft.2`) retain 69 Tier 3 checks:
28 existing deployment checks, 11 additional identity checks, and 30 typed security
measurement rules spanning identity, devices, applications/workloads, data,
networks/environment, automation/orchestration, and visibility/analytics.
These are authored readiness checks, not a complete regulatory assessment or a
claim that banking regulations prescribe exactly seven layers.

The existing Ready step and completed report include an interactive application
layer map: application → seven technical layers → selected standard/control IDs.
Selecting a layer reveals its controls, required tier, existing report pillar and
planned/pass/fail/inconclusive/not-assessed state. Completed rows show the actual
method, recorded evidence/result and explicitly mapped supporting technical checks.
Passed/failed rows link to
the respective report pillar. The report map uses raw selected-control results,
so unobserved objectives are not silently lost through the main report's pass/fail
projection. No new setup step or applicability questionnaire is introduced.
Non-deployment controls use related-objective grouping, explicitly distinguished
from an official regulatory mapping; a control can relate to several layers.

## Collection and evaluation

The durable review worker uses target-scoped encrypted profiles and the read-only
broker. Direct observations and explicitly connected tool exports are normalized
into timestamped, hashed evidence. Deterministic rules feed the existing trusted
assessment bridge; the same finding, control-mapping and remediation pipeline
produces the report. Missing/partial observations remain in raw results and the
expandable evidence section, even though the main report shows only pass/fail.

`review.securityPillars` separately shows passed, failed, inconclusive and missing
expanded checks across all seven pillars. It does not turn a small observed sample
into a whole-environment completeness claim. Historical reports without this field
continue to render.

`review.technicalAssessments` contains the automatically evaluated technical rules
with methods, outcomes and timestamped/hash-linked observation summaries. Only
collector observations can settle these rules. Missing readings name the procedure
that could not be collected. The layer map and existing pillar sheets show these
separately from regulatory verdicts; they do not inflate standard control counts.
`lib/deployment-evaluation.ts` defines explicit supporting relationships by exact
rule ID. These are authored supporting-evidence links, not equivalence mappings:
a header/MFA subcheck cannot establish a broader access-control obligation. The
existing full-measurement banking bridge still applies only when all required
measurements are available. Unmapped technical observations remain standalone.
Old saved reports with a Deployment Review selection remain readable; current
setup drops that implementation pack on restore, and new reviews migrate it out.

## Connections (inside the existing Connect step)

### AWS

Existing scoped account/region/application-tag collection is unchanged. Opt in to
`includeIdentityAudit: true` with `iamUserNames` (1–25 explicit names),
`maximumCredentialAgeDays`, and `maximumCredentialIdleDays`. The collector reads
the existing IAM credential report using `iam:GetCredentialReport`; it never
generates a report. Reports older than 24 hours are inconclusive. Only selected
users' derived observations are retained, not the account-wide CSV. It checks
console MFA configuration, active-key age and known last-use timestamps. MFA
configuration is not proof of per-request enforcement. Missing activity dates
cannot prove a key was unused. Identity Center is not covered by this CSV.

Optionally specify `accessAnalyzerArn` within the configured account and one of
the selected regions. `GetAnalyzer` and `ListFindingsV2` read an existing analyzer
(IAM actions `access-analyzer:GetAnalyzer` and `access-analyzer:ListFindings`); no analyzer is created
and no finding is archived. Active findings are matched only to discovered tagged
application resource ARNs. Reads stop after three pages. Stale/inactive analyzers,
empty discovery, failed reads and truncation cannot yield a clean pass. The check
is specifically about active findings in that analyzer, not all effective access.
Existing analyzer charges and service limitations still apply.

### Microsoft Entra

Use a separate `entra` profile with tenant/client credentials and `principalIds`
(1–10 explicit object IDs). Authentication requests a fixed Microsoft Graph
audience; resource Reader permissions do not confer Graph access. Typical
read-only application consent includes `User.Read.All`, `Application.Read.All`,
`AuditLog.Read.All`, and `RoleManagement.Read.Directory`, only as required by the
chosen reads. Obtain the customer's administrator approval; never grant the
reviewer write or Global Administrator permissions. Licensing, consent, report
availability and national-cloud endpoints can limit collection. This connector
currently uses the public Microsoft cloud endpoints only.

The connector reads user enablement, MFA registration, service-principal
credential expiry metadata, and direct directory-role assignment edges. It never
retains credential values or user principal names. Registration is not MFA
enforcement; a valid credential expiry is not least privilege.

`requiredConditionalAccessPolicyIds` optionally checks explicitly required policy
states (`Policy.Read.All` consent as appropriate). Enabled policies do not prove
applicability: exclusions, grant combinations, device/client conditions and sign-in
results need separate evidence. `requireTimeBoundRoles: true` with explicit
`privilegedRoleDefinitionIds` checks active assignment expiry using directory role
schedule instances (`RoleAssignmentSchedule.Read.Directory` as required). This
does not attest PIM approval settings, group inheritance, eligibility or emergency
access policy. Do not configure a time-bound requirement for approved permanent
exceptions without first defining the intended policy scope.

### Application authorization matrix

An existing `auth` profile may additionally include:

```json
{
  "url": "https://your-app.example/api/me",
  "identities": [{ "id": "reader", "token": "DEDICATED_TEST_TOKEN" }],
  "tests": [
    { "identityId": "reader", "url": "https://your-app.example/api/me", "expect": "allow" },
    { "identityId": "reader", "url": "https://your-app.example/api/admin/test-fixture", "expect": "deny" }
  ]
}
```

Limits: six identities, twenty cases, same-origin HTTPS GET only, no URL credentials,
queries or fragments. Use approved test identities and safe non-mutating fixtures.
GET is not a guarantee that an application endpoint has no side effects: the owner
must approve the supplied routes. No money movement, account changes, fuzzing,
brute force or arbitrary browser workflows are performed.

Allow baselines run first and must reject anonymous access (401/403) while accepting
the test identity (2xx). Negative cases pass only with that working baseline and
HTTP 403. An unexpected 2xx fails; redirects, 401, 404, transport failures and invalid
baselines are inconclusive. Bodies and tokens are not retained. Status-based tests
are bounded signals, not a complete proof of application authorization semantics.

### Security-tool exports for all seven pillars

Use `security_export` with HTTPS `url` and optional read token. This supports an
integration from IAM/PAM, HR/GRC, EDR/MDM, vulnerability scanning, CI/AI tests,
database/DLP/KMS, network testing, SOAR, SIEM or DR tools. These products are not
all native API connectors: an adapter must export their real measurements.

Download the empty contract from
`/api/reviews/security-template?target=https%3A%2F%2Fyour-app.example` in an
authenticated review session. The template deliberately supplies no healthy
defaults. The 30 rules and exact typed field requirements are defined once in
`lib/security-layer-rules.json` and shared by the Node evaluator and framework pack.

```json
{
  "schemaVersion": "2.0",
  "targetOrigin": "https://your-app.example",
  "generatedAt": "REPLACE_WITH_ACTUAL_EXPORT_TIME",
  "scope": {
    "id": "bank-app-production",
    "complete": false,
    "assetIds": ["REPLACE_WITH_ACTUAL_SCOPE_ASSET"],
    "ruleAssets": { "iam-lifecycle": ["REPLACE_WITH_ACTUAL_SCOPE_ASSET"] }
  },
  "measurements": [
    {
      "ruleId": "iam-lifecycle",
      "assetId": "REPLACE_WITH_ACTUAL_SCOPE_ASSET",
      "sourceRef": "https://your-evidence.example/record-id",
      "collectedAt": "REPLACE_WITH_ACTUAL_MEASUREMENT_TIME",
      "fields": {}
    }
  ]
}
```

The envelope and measurements must be no older than 30 days, with at most five
minutes future clock skew. Source references must be HTTPS without embedded
credentials, query strings or fragments. At most 500 measurements/500 unique scope
assets are accepted. Counts must be nonnegative safe integers; booleans must be
actual JSON booleans. Claimed status fields and arbitrary procedure IDs do not
drive verdicts. No document/model opinion can override these observations.

Each rule defaults to all declared scope assets, or its explicit `ruleAssets`
subset. Every asset in that rule scope needs a measurement before a pass is
possible. Source-declared `complete: false`, missing fields, stale records or
missing assets cannot pass. A fresh, valid positive violation can fail even in an
incomplete scope. Contradictory observations retain the worst outcome.
Zero reviewed/scanned/tested population is inconclusive, not a successful empty
audit and not by itself evidence of a security violation.

`complete` is a source assertion, not independently verified inventory completeness.
The app does not fetch each source reference or authenticate the original EDR/PAM
record. The configured HTTPS exporter and its source owner are the trust boundary;
record IDs, scope, timestamps and the stored evidence hash make that boundary
visible. Regulated assurance still needs owner/assessor validation of exporters.

## Identity graph and bank mappings

An optional `identityGraph` carries typed `principals` (user/group/role/workload),
`assignments` (`member_of`, `assigned_role`, `granted_on`, `can_assume`),
`sourceRef`, `collectedAt`, and `inventoryComplete`. Limits are 500 principals and
1000 edges. Targets must belong to that graph or the declared asset inventory.

For user/workload lifecycle evaluation supply boolean `enabled`, `terminated`,
and `ownerAssigned`. Active terminated/unowned identities fail. Missing facts or
incomplete/stale snapshots cannot pass. An optional `conflictPolicy` has
`approved`, `sourceRef`, `collectedAt`, and `rolePairs` of declared role IDs.
Cycle-safe traversal finds incompatible assigned roles through nested groups and
retains both paths. It does not claim that a business transaction is executable or
solve all cloud deny/condition/trust-policy semantics.

The four exact bank privileged-access fields can bridge from fresh, complete,
comparable full-scope IAM measurements: `privilegedMfaEnforced` (iam-mfa),
`overdueAccessReviews` (iam-reviews), `segregationConflicts` (iam-sod), and
`orphanedPrivilegedAccounts` (iam-pam). Existing banking rules re-evaluate these
typed values, allowing a shared issue to map to selected RBI/NIST/SWIFT packs.
MFA registration or one endpoint rejection cannot manufacture those fields.
Other bank-wide obligations still use the existing structured banking export;
none are inferred from a URL scan.

## Deliberate boundaries

This release provides rules for all seven pillars, not universal autonomous
collection from every bank system. Native Okta/Keycloak/AD, EDR/PAM/SIEM-specific
APIs, full AWS Organizations/Identity Center policy evaluation, an Azure effective
permissions engine, complete Conditional Access simulation, verified HR source
reconciliation, cryptographic CloudTrail digest-chain validation and safe
end-to-end payment tests remain separate connector/test projects. Use actual
validated tool exports for those checks meanwhile; unconnected checks stay gaps.

The existing small/complex-model documentary review remains opt-in, cited and
unable to create configuration or banking measurements. The review agent receives
scoped read capabilities, not a shared administrator credential. The Node worker
still runs alongside the web server; this change does not claim isolated worker
deployment or enterprise sign-off workflows.

## API references

- [NSA Zero Trust pillar guidance](https://www.nsa.gov/Cybersecurity/ZIG/CSIs/)
- [AWS credential report](https://docs.aws.amazon.com/IAM/latest/APIReference/API_GetCredentialReport.html)
- [AWS Access Analyzer findings](https://docs.aws.amazon.com/IAM/latest/UserGuide/access-analyzer-findings.html)
- [Graph user registration report](https://learn.microsoft.com/en-us/graph/api/authenticationmethodsroot-list-userregistrationdetails?view=graph-rest-1.0)
- [Graph directory role assignments](https://learn.microsoft.com/en-us/graph/api/rbacapplication-list-roleassignments?view=graph-rest-1.0)
- [Graph active role assignment schedules](https://learn.microsoft.com/en-us/graph/api/rbacapplication-list-roleassignmentscheduleinstances?view=graph-rest-1.0)
- [Azure versus Entra roles](https://learn.microsoft.com/en-us/azure/role-based-access-control/rbac-and-directory-admin-roles)
