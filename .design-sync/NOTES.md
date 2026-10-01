# design-sync notes

Working state for syncing this repo's design system to claude.ai/design.
Project: `GovernAI` — https://claude.ai/design/p/0995eae7-8250-49d9-b741-531e412871d4

## The build command

This repo is a Next.js app, not a published package, so the converter needs the
entry pointed at the kit explicitly:

```bash
node .ds-sync/package-build.mjs --config .design-sync/config.json \
  --node-modules "$PWD/node_modules" \
  --entry ./components/kit.tsx --out ./ds-bundle
node .ds-sync/package-validate.mjs ./ds-bundle
node .ds-sync/package-capture.mjs --out ./ds-bundle
```

`--entry` is **required**. Without it the converter resolves `PKG_DIR` to
`node_modules/govern-ai-assessment`, which doesn't exist, and the build dies on a
missing `package.json`.

## Why the config looks the way it does

There is no `dist/` and no emitted `.d.ts` tree, and those two absences drive most
of the config:

- **`componentSrcMap` pins all eight components.** Discovery reads PascalCase
  exports from the `.d.ts` tree; with no tree it finds zero, and the synth-entry
  fallback that would normally cover this is disabled *because* `--entry` was
  passed. The map's non-null entries are what add the components. (`Report`,
  `Step`, `LiveRun` are mapped to `null` deliberately — they're page-level
  compositions, not design-system parts.)
- **`dtsPropsFor` is hand-written** for the same reason: auto-extraction produced
  `[key: string]: unknown` stubs. Each body is transcribed from the real signature
  in `components/kit.tsx` and the unions in `lib/types.ts`. **If a component's props
  change, this file must be updated by hand — nothing will catch the drift.**
- **`cssEntry` is a built artifact, not a source file.** `cssEntry` is copied into
  the bundle *verbatim*, so `app/globals.css`'s bare specifiers
  (`@import "tailwindcss/theme.css"`) would dangle. `.design-sync/ds-entry.css`
  imports globals and gets flattened by `buildCmd` into
  `.design-sync/styles.built.css`. **Re-run `buildCmd` whenever `app/globals.css`
  changes** — the build does not do it for you.
- **`readmeHeader` resolves from the repo root**, not from `.design-sync/`. Hence
  the value `.design-sync/conventions.md` rather than `conventions.md`.

## Fonts

`app/layout.tsx` uses `next/font/google`, which injects `--font-geist-sans` and
`--font-geist-mono` at runtime. Nothing injects them into a rendered design, so:

- 11 Geist / Geist Mono woff2 files are vendored in `.design-sync/fonts/`,
- `.design-sync/ds-fonts.css` declares the `@font-face` rules (generated from
  `.vinext/fonts/*/style.css`, with `url()` rewritten to `./fonts/<name>.woff2`),
- `.design-sync/ds-entry.css` binds the two CSS variables to those families.

If the font configuration in `app/layout.tsx` changes, all three need regenerating.

`runtimeFontPrefixes: ["Inter", "Cambria"]` is an **accepted substitution**, not an
oversight. Neither is a brand font: `Inter` appears only inside a fallback stack,
and `Cambria` comes from Tailwind's default `--font-serif`. Shipping either would
add weight for a face the product never intends to use.

## Preview convention (important)

`lib/docs.mjs` slices each `## Examples` block from `export const X =` up to the
*next* `export const`. A `/** … */` block sitting between two exports therefore
lands inside the **previous** example's code fence, and the first export's doc is
dropped entirely.

**So: never put a doc comment between two exports in `.design-sync/previews/*.tsx`.**
Put the note as a `//` comment *inside* the arrow body, where it stays attached to
its own example. All eight preview files follow this.

## Re-sync risks

- **Props change in `kit.tsx` → `dtsPropsFor` silently goes stale.** The build will
  not warn. Diff `components/kit.tsx` against the config whenever the kit changes.
- **`app/globals.css` changes → `styles.built.css` goes stale.** Run `buildCmd`
  first; the token count (currently 472 defined / 43 referenced) is a quick check
  that the flatten worked.
- **Editing a preview clears that component's grade** ("contract changed"), even
  when the change is only a comment and the render is pixel-identical. Expected —
  re-read the sheet and re-grade.
- **A new export in `kit.tsx` will not appear** until it's added to
  `componentSrcMap` *and* `dtsPropsFor`.

## Known render warns

None. Latest validate: `✓ bundle is complete`, zero warnings — 8/8 components
render cleanly, 0 bad / 0 thin / 0 blank / 0 identical-variants, 19 preview cells
all graded `good`.

## Repo finding, noted in passing

The pillar palette exists **twice and has drifted**: `lib/pillars.ts` carries hex
values on each registry entry (`trust: #0e8b86`) while `app/globals.css` defines
`--p-*` tokens with different values (`--p-trust: #0b807b`). The app renders the TS
values, because `Meter` receives `hue={pillarHue(pillar)}`. The previews use the
CSS tokens, since a rendered design can reach a token but cannot call
`pillarHue()`. Worth reconciling to one source in the repo itself — not a sync
problem, but the two will keep diverging.
