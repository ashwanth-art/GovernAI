# GovernAI Framework Packs

GovernAI framework packs separate official source requirements from GovernAI-authored assessment objectives and reusable evidence procedures.

## Current pilot inventory

| Pack | Release | Controls | Assurance | Status |
|---|---|---:|---|---|
| HIPAA current rules | `2026.10-draft.2` | 21 | Readiness | Draft |
| NIST AI RMF 1.0 + GenAI Profile | `2026.10-draft.1` | 22 | Readiness | Draft |
| EU AI Act | `2026.10-draft.2` | 11 | Readiness | Draft |
| PCI DSS v4.0.1 | `2026.10-draft.3` | 38 | Readiness | Draft |
| OWASP LLM Top 10 2025 | `2026.07-draft.2` | 10 risk families | Screening | Draft |

The UI exposes each pilot pack's release, status, assurance level, coverage, and source mapping.

No pack asks scope questions. Every control of a selected pack applies to every assessed assistant, so the setup flow has no questions step and a role-, data- or risk-class-specific requirement (a HIPAA covered-entity rule, an EU AI Act high-risk provider obligation) is reported against the system rather than ruled out. The HIPAA and EU AI Act scope controls that only recorded those answers (HIPAA-APP-01, EUAIA-APP-01, EUAIA-APP-02) were removed, since without a question they could only pass by default.

Every standard lists only controls a Tier 3 run can reach a verdict on, so Tier 3 covers 100% of the applicable controls for any sector and any combination of standards (`tests/rendered-html.test.mjs` asserts this across the whole catalogue). Requirements with no evidence path the target publishes are out of scope and not listed:

| Pack | Out of scope |
|---|---|
| HIPAA | HIPAA-PR-01 PHI use policy, PR-04 individual rights, S-07 contingency plan, S-08 periodic evaluation, S-09 sanctions, P-01 physical safeguards, P-02 media controls, BR-01 breach response, DOC-01 policy documentation |
| NIST AI RMF | GOV-02 obligations register, GOV-06 independent challenge, MAP-02 impact assessment, MAP-06 emergent risk, MANAGE-05 risk communication, MANAGE-06 safe shutdown |
| EU AI Act | PR-01 prohibited practices, DEP-01 deployer controls, DEP-02 fundamental-rights impact assessment, TR-01 AI-interaction disclosure, PROV-01 quality management, PROV-03 corrective action, IMP-01 importer, DIST-01 distributor, CONF-01 conformity assessment, CONF-02 EU declaration, CONF-03 registration, GPAI-01/02 GPAI documentation and copyright |
| PCI DSS | 3.3.1, 4.2.2, 6.4.3, 6.5.5, 8.4.2, 8.6.2, 11.6.1, 12.5.2, 12.8.5, 12.10.7, A1.1.4, and Requirement 9 |
| Screening catalog | Every Tier 3 template (supplier assurance, model card, and the document-review forms of corpus integrity, transparency, and incident response) |

The procedure ids those controls named are still accepted in an Evidence Manifest, so a manifest written for an earlier release loads cleanly; nothing consumes them.

## PCI DSS v4.0.1

Suggested first for the Retail / E-commerce sector. Every control cites an exact requirement number, and 35 of the 38 reuse a verification-library check, so a PAN-masking or log-retention fix closes the PCI control and the matching control in every other selected standard. Tier coverage is 3 / 18 / 38.

The pack asks no scope questions: every listed requirement applies to every assessed assistant, so selecting PCI DSS never adds a question or blocks a run. An assistant that is not a multi-tenant service provider still has A1.1.2 reported against it rather than ruled out.

The three PCI-only controls name their own evidence procedures: 1.3.1 inbound traffic to the CDE, 3.5.1 PAN unreadable wherever stored, and 11.4.1 penetration testing. The requirements listed as out of scope above, and Requirement 9 (physical access), have no remote evidence path.

## Mapped standards

A second group selects its controls from the verification library rather than authoring them, so every control has a real evidence path and coverage is derived from the mapping instead of declared alongside it. See `lib/standard-mappings.ts`.

| Standard | Controls | Tier 1 / 2 / 3 |
|---|---:|---|
| ISO/IEC 42001 | 56 | 5 / 26 / 56 |
| SOC 2 Type II | 49 | 3 / 24 / 49 |
| MAS FEAT | 32 | 5 / 21 / 32 |
| ISO/IEC 27001 | 50 | 3 / 24 / 50 |
| GDPR | 56 | 5 / 26 / 56 |
| NIS2 | 49 | 4 / 25 / 49 |
| NERC CIP | 50 | 4 / 25 / 50 |
| GxP / 21 CFR Part 11 | 56 | 5 / 26 / 56 |
| CMMC 2.0 Level 2 | 50 | 4 / 25 / 50 |
| IEC 62443 | 50 | 4 / 25 / 50 |

Because they share the library, the whole group resolves to 56 distinct checks: one piece of evidence closes the same control wherever it appears, which is what lets a single remediation playbook report how many controls across how many standards it closes.

The remaining selectable standards still use the legacy screening catalog and are generated from twelve repeated control templates, at Tier 1 and Tier 2 only — the templates have no Tier 3 evidence path, so Tier 3 adds nothing to them. Their verdicts come from pillar-level proxy checks, which is why they are labelled as such wherever a verdict is shown.

## Compact control contract

Every pilot control contains:

- `id`: stable identity across releases and reports;
- `objective`: concise statement of what must be true;
- `applicability`: always `all_assessed_ai_systems` (or `llm_or_rag_system`) — no pack carries a scope condition;
- `sourceCitation`: official authority, document, section, and mapping type;
- `evidenceProcedureIds`: reusable collection or review procedures;
- `evaluationRuleId`: deterministic rule that converts evidence into a result;
- `severity`: prioritization and critical-control override input; and
- `remediationId` plus `remediation`: reusable action guidance.

Framework name, framework version, release status, assurance level, source version, and content hash belong in the pack manifest rather than being repeated on every control. Runtime status, confidence, and evidence summaries belong in assessment results rather than authored controls.

## Result boundaries

- Missing evidence produces `not_assessed`, not pass.
- Every control of a selected pack is applicable; nothing is excluded by a scope answer.
- Coverage is assessed controls divided by applicable controls; excluded controls do not depress the score.
- Document-review controls remain `not_assessed` until artifact collectors inspect content.
- Reachability does not count as content review.
- A readiness pack below 90% assessed coverage reports `Insufficient evidence`.
- Official pages are cited but are not fetched during an assessment.
- Draft packs are not regulator-approved questionnaires, certifications, legal opinions, or official audits.

## Source lifecycle notes

- HIPAA scoring uses the currently effective rules; the 2025 Security Rule NPRM is not mixed into current-rule conclusions.
- NIST AI RMF 1.0 is marked under revision.
- EU AI Act obligations are all reported; whether a given article binds the organization (role, classification, assessment date, transition rules) is a legal review outside the run.
- OWASP procedures are bounded; denial-of-service and other invasive tests are excluded from production probing.

## Evidence manifest and provider collectors

Tier 3 accepts an optional GovernAI Evidence Manifest 1.0. Each entry is keyed by the exact `evidenceProcedureId` used by controls and contains an explicit status, summary, confidence, and optional artifact reference. See `examples/evidence-manifest.json`.

The runtime validates the manifest before use. Unknown IDs, missing summaries, and invalid statuses are rejected. A control with only some required procedures receives `partial`, not `pass`.

Direct read-only provider collectors currently support:

- GitHub repository metadata, default-branch protection, and Actions permissions;
- Datadog monitor definitions; and
- Grafana health and provisioned alert rules.

Provider results are converted into the same named procedure evidence used by uploaded manifests. Credentials are used only for the active request and are not included in reports or logs.
