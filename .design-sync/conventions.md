# GovernAI — how this design system is meant to be used

These are the parts of the AI-governance assessment product: the UI that runs an
assessment and reports what it found. Compositions built from them should read like
an audit document — quiet, dense, and legible in print — not like a dashboard.

## The one rule that shapes everything

**The product's credibility is the design.** Every number on screen is a claim a
customer may have to defend to a regulator, so the UI never decorates a claim and
never implies more precision than the assessment produced. Practically:

- Never invent a status, severity, or score to fill a layout. `not_assessed` is a
  real, common, legitimate value — show it rather than rounding it to `pass`.
- Absent data stays absent. `SevRow` omits severities with no findings instead of
  drawing zeros; follow that instinct everywhere.
- Keep the raw API spelling where the component uses it (`not_applicable`, not
  "N/A"). Operators cross-reference these against exports.

## Vocabulary

A **run** assesses a system against one or more **framework packs** (NIST AI RMF,
GDPR, HIPAA, DPDPA, ISO 42001). Each pack contains **controls** with an id
(`GOVERN-1.1`, `Art. 35`). A control gets a **status**; a **finding** is a problem
with a **severity**, an owner, and a blast radius. Controls roll up into five
**pillars**:

| Pillar key | Label | Hue token |
|---|---|---|
| `governance` | Accountability | `--p-governance` |
| `trust` | Trust & transparency | `--p-trust` |
| `data_protection` | Privacy & data | `--p-data` |
| `security` | Security | `--p-security` |
| `compliance` | Audit readiness | `--p-compliance` |

Use these labels verbatim. Don't coin new pillars, and don't relabel a pillar to
something that reads better in a narrow column — `pillarShort` exists for that.

## Colour

Colour is **semantic only**. There is no decorative palette.

- Status: `--pass` / `--partial` / `--fail` / `--na` / `--none`, each with a
  matching `-wash` (fill) and `-line` (border).
- Severity: `--sev-critical` / `--sev-high` / `--sev-medium` / `--sev-low`.
- Pillar: the `--p-*` tokens above.
- Everything else is the neutral ramp — `--paper` / `--paper-2` / `--paper-3`
  behind, `--ink` / `--ink-2` / `--muted` / `--faint` on top, `--line` /
  `--line-soft` / `--line-strong` between.

Never hardcode a hex. If a composition needs a colour with no token, it almost
certainly needs a different composition.

## Type

Two families, both shipped: **Geist** for prose and **Geist Mono** for anything an
operator reads as data — control ids, run ids, durations, percentages, counts. The
`.mono` class is the shorthand. The contrast between the two is what lets someone
skim a report for the identifiers, so don't set body copy in mono for texture.

Sizes run small (12–14px body). Resist scaling up for emphasis; use weight, the
`.faint` / `.muted` classes, and whitespace instead.

## Surfaces and shape

`--r-s` / `--r-m` / `--r-l` / `--r-xl` are the radii; `--lift-1` … `--lift-3` the
elevations. Cards sit on `--paper` with a `--line` border and at most `--lift-1`.
Deep shadows read as marketing UI and undercut the audit tone.

## Composing

- **`Disc` is the workhorse for findings.** It is a real `<details>`: the summary
  row must stand alone, because that's the state a reader scans. Put the severity
  glyph in `glyph`, the one-line consequence in `sub`, and the blast radius in
  `right`. Detail and a `Kv` block go in the children.
- **`Kv` is for metadata, not for prose.** Two-column label-over-value. Set
  `mono: true` on anything copied into a ticket or a query.
- **`Ring` is for one run.** Pass `tone` explicitly — a failed run at 60% must never
  look like a run that is 60% done.
- **`Meter` is for a rollup**, one bar per pillar, hued to that pillar.
- **`SevRow` is glanceable, not readable.** The counts are a tooltip; if the number
  has to be read, put it in text next to the strip.
- **`Tag` is a citation.** Pack name plus control id, always both — a bare id is
  ambiguous across packs.

## What isn't here

`Report`, `Step`, and `LiveRun` are page-level compositions in the app, deliberately
not exported as design-system parts. Build screens by composing the eight primitives
above rather than reaching for a page component.
