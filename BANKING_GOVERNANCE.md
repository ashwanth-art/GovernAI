# Banking governance readiness

The existing six-step setup, credentials, execution screen and assessment endpoints remain unchanged. Finance / Banking now recommends RBI IT Governance, RBI IT Outsourcing, RBI FREE-AI, RBI KYC / AML, RBI Digital Payments, ISO 27001, ISO 42001 and DPDP. Other banking packs are selectable in the existing standard picker.

## Versioned packs

All releases are `2026.10-draft.1`, readiness assessments with a content hash and official source links. Authored objectives cite source topics; an ordinal control ID is not an official regulatory clause number. Each objective has a dedicated Tier 3 measurement rule. Selecting a pack asks no applicability questions.

Added packs: RBI IT Governance 2023; RBI IT Outsourcing 2023; RBI Digital Payment Security 2021; RBI Commercial Banks KYC / AML (December 2025 baseline, later amendments under review); FATF institutional AML / CFT; RBI FREE-AI August 2025; BCBS 239; Basel Operational Resilience 2021; Basel Core Governance 2024; SWIFT CSCF v2026 topic mapping; NIST CSF 2.0; ISO 22301:2019 / Amd 1:2024. SR 26-2 replaces the SR 11-7 display name while keeping its saved-input ID.

These are selected control objectives, not exhaustive transcriptions of regulations. SWIFT uses public objectives; architecture-specific controls and attestation require the detailed CSCF and an independent assessor. ISO certification requires the licensed standard and an auditor. FREE-AI is committee guidance. FATF mapping covers institutions rather than national legislation. BCBS 239 lists bank responsibilities under principles 1–11, not supervisors' responsibilities under principles 12–14.

The KYC source baseline is explicitly recorded on the pack and marked under revision. Bank-specific consolidated RBI directions and later amendments must be checked before regulatory reliance. The Basel Core Governance pack provides evidence checks for capital/liquidity review and credit decisions; this release does not calculate regulatory ratios or transaction risks itself.

## Existing manifest integration

`GET /api/banking/evidence-template` returns all named procedures and their field contracts. Merge populated procedures into the existing `schemaVersion: "1.0"` evidence manifest, then provide its URL through the existing Tier 3 connection. The template itself contains no passing evidence. An ordinary AI chatbot does not supply bank-wide evidence automatically.

Each banking entry needs a summary and structured `measurements`. Boolean fields must actually be booleans. Counts must be finite, nonnegative numbers. `true`, `zero` and `positive` describe the expected conditions. A measured violation yields `fail`, including when the publisher declares `pass`. Missing/invalid measurements yield `not_assessed`; the engine does not pass them based on endpoint reachability. Failed checks stay failed even if other fields are missing. Bank-approved thresholds determine which source records count as overdue or material; these thresholds are not invented by this app.

Include `collectedAt` and `artifactRef` so the report identifies observation time and source record. As with all current manifests, source observations are supplied by the target, not independently signed or audited. A matching export cannot establish that the source omitted no assets, transactions or models.

Example procedure:

```json
{
  "artifact-bank-patch-vulnerability": {
    "status": "not_assessed",
    "summary": "Read-only vulnerability and patch export",
    "collectedAt": "2026-10-09T10:00:00Z",
    "artifactRef": "https://bank.example/security/reports/current",
    "measurements": {
      "scanCompleted": true,
      "overdueCriticalVulnerabilities": 2,
      "overdueCriticalPatches": 0
    }
  }
}
```

This yields a failure and identifies the two overdue critical vulnerabilities. It maps to each selected standard requiring the same check and uses the existing finding/remediation system.

## Read-only source exporter

`node scripts/export-banking-evidence.mjs /absolute/path/sources.json` reads bank-owned JSON export endpoints and emits an evidence manifest to stdout. It sends GET requests only, rejects redirects and URL credentials, uses bounded request timeouts, and retains no credential values in output. It can bridge IAM/PAM, SIEM/SOC, vulnerability/patch platforms, CMDB, vendor registries, GRC, DR tests, payment/fraud platforms, AML/KYC, model registries, data-quality systems and SWIFT assessment records when those systems expose the necessary exports. Native vendor APIs requiring custom joins/calculations must be normalized by the bank's integration owner first; no provider is connected without a source URL and authorized credential.

```json
{
  "sources": [{
    "procedureId": "artifact-bank-patch-vulnerability",
    "provider": "Bank security reporting",
    "url": "https://bank.example/security/export",
    "tokenEnv": "BANK_SECURITY_EXPORT_TOKEN",
    "collectedAtPath": "generatedAt",
    "fieldPaths": {
      "scanCompleted": "scan.completed",
      "overdueCriticalVulnerabilities": "findings.overdueCritical",
      "overdueCriticalPatches": "patches.overdueCritical"
    }
  }]
}
```

## Reports

Finance and banking-pack assessments append Banking Governance within the existing final report. It shows ten practice domains, outcomes per selected standard/control, severity, evidence, timestamps/source references when provided, remediation and required procedure names. Unselected domains show `Not included`; missing connected-system evidence shows `Not assessed`. The printable HTML carries the same information. Coverage is the fraction of listed controls evaluated, never a claim that all banking obligations have been satisfied.
