# GovernAI Framework Packs

GovernAI framework packs separate official source requirements from GovernAI-authored assessment objectives and reusable evidence procedures.

## Current pilot inventory

| Pack | Release | Controls | Assurance | Status |
|---|---|---:|---|---|
| HIPAA current rules | `2026.07-draft.2` | 31 | Readiness | Draft |
| NIST AI RMF 1.0 + GenAI Profile | `2026.07-draft.2` | 28 | Readiness | Draft |
| EU AI Act | `2026.07-draft.2` | 26 | Readiness | Draft |
| PCI DSS v4.0.1 | `2026.10-draft.2` | 49 | Readiness | Draft |
| OWASP LLM Top 10 2025 | `2026.07-draft.2` | 10 risk families | Screening | Draft |

The UI exposes each pilot pack's release, status, assurance level, coverage, and source mapping.

## PCI DSS v4.0.1

Suggested first for the Retail / E-commerce sector. Every control cites an exact requirement number, and 35 of the 49 reuse a verification-library check, so a PAN-masking or log-retention fix closes the PCI control and the matching control in every other selected standard. Tier coverage is 3 / 18 / 49.

The pack asks no scope questions: every requirement applies to every assessed assistant, so selecting PCI DSS never adds a question or blocks a run. The trade-off is deliberate — an assistant that never touches card data, has no widget on a payment page (6.4.3, 11.6.1), or is not a multi-tenant service provider (Appendix A1) still has those requirements reported against it rather than ruled out.

The PCI-only controls name their own evidence procedures — for example `artifact-pan-discovery-scan` (card numbers in transcripts, logs, or the retrieval index), `document-pan-messaging-policy` (4.2.2, chat as end-user messaging), and `document-tpsp-responsibility-matrix` (12.8.5, model, vector-store, and hosting providers). Requirement 9 (physical access) has no remote evidence path and is excluded.

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

The remaining selectable standards still use the legacy screening catalog and are generated from twelve repeated control templates. Their verdicts come from pillar-level proxy checks, which is why they are labelled as such wherever a verdict is shown.

## Compact control contract

Every pilot control contains:

- `id`: stable identity across releases and reports;
- `objective`: concise statement of what must be true;
- `applicability`: conditions that determine whether the control applies;
- `sourceCitation`: official authority, document, section, and mapping type;
- `evidenceProcedureIds`: reusable collection or review procedures;
- `evaluationRuleId`: deterministic rule that converts evidence into a result;
- `severity`: prioritization and critical-control override input; and
- `remediationId` plus `remediation`: reusable action guidance.

Framework name, framework version, release status, assurance level, source version, and content hash belong in the pack manifest rather than being repeated on every control. Runtime status, confidence, and evidence summaries belong in assessment results rather than authored controls.

## Result boundaries

- Missing evidence produces `not_assessed`, not pass.
- Applicability answers produce `applicable`, `not_applicable`, or `unknown` before scoring.
- Coverage is assessed controls divided by applicable controls; excluded controls do not depress the score.
- Document-review controls remain `not_assessed` until artifact collectors inspect content.
- Reachability does not count as content review.
- A readiness pack below 90% assessed coverage reports `Insufficient evidence`.
- Official pages are cited but are not fetched during an assessment.
- Draft packs are not regulator-approved questionnaires, certifications, legal opinions, or official audits.

## Source lifecycle notes

- HIPAA scoring uses the currently effective rules; the 2025 Security Rule NPRM is not mixed into current-rule conclusions.
- NIST AI RMF 1.0 is marked under revision.
- EU AI Act applicability must be determined using the organization's role, system classification, assessment date, and applicable transition rules.
- OWASP procedures are bounded; denial-of-service and other invasive tests are excluded from production probing.

## Evidence manifest and provider collectors

Tier 3 accepts an optional GovernAI Evidence Manifest 1.0. Each entry is keyed by the exact `evidenceProcedureId` used by controls and contains an explicit status, summary, confidence, and optional artifact reference. See `examples/evidence-manifest.json`.

The runtime validates the manifest before use. Unknown IDs, missing summaries, and invalid statuses are rejected. A control with only some required procedures receives `partial`, not `pass`.

Direct read-only provider collectors currently support:

- GitHub repository metadata, default-branch protection, and Actions permissions;
- Datadog monitor definitions; and
- Grafana health and provisioned alert rules.

Provider results are converted into the same named procedure evidence used by uploaded manifests. Credentials are used only for the active request and are not included in reports or logs.
