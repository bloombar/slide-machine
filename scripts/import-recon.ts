#!/usr/bin/env npx tsx
/**
 * What a deck is, before importing it (docs/TEMPLATES.md §9, step 2).
 *
 * Every question below cost a debugging cycle to learn the hard way on some
 * deck: a theme colour taken from the one slide least like the rest, layout
 * pages read as though they were slides, a whole session spent analysing a
 * template produced by the code path the product never sends. All of them are
 * answerable from a captured deck in about a second, before anything is
 * imported and while the answers can still change what you do.
 *
 * Read through the app's OWN reader rather than by picking at the JSON, so
 * what it reports is what the importer will see — including the places the
 * reader resolves inheritance, which is most of what makes a real deck hard.
 *
 * Usage:
 *   npx tsx scripts/import-recon.ts <captured.json> [keepEverySlide] [provider] [assetPrefix]
 *
 * The three options are echoed rather than detected. This script reads a
 * DECK; it cannot see a run. Stating them makes the output describe the
 * import you are about to do rather than a deck in the abstract — and an
 * unstated option is printed as unstated, because "keepEverySlide: unknown"
 * is information and a silently omitted line is not.
 */
import { readFileSync, statSync } from 'node:fs'
import { toSourcePresentation } from '../server/src/import/read-slides'
import { candidateOf } from '../server/src/import/candidate'
import type { SourceElement } from '../server/src/import/source-presentation'

const [file, keep, provider, assetPrefix] = process.argv.slice(2)
if (!file) {
  console.error(
    'Usage: npx tsx scripts/import-recon.ts <captured.json> [keepEverySlide] [provider] [assetPrefix]',
  )
  process.exit(1)
}

const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
const deck = toSourcePresentation(raw)
const stated = (v: string | undefined) => v ?? 'NOT STATED — record it'

const rule = (title: string) =>
  console.log(`\n${title}\n${'─'.repeat(title.length)}`)

console.log(`IMPORT RECONNAISSANCE — ${file}`)
console.log(`  ${statSync(file).size.toLocaleString()} bytes · "${deck.title}"`)

rule('WHICH PATH — supplied, not detected')
console.log(`  keepEverySlide : ${stated(keep)}`)
console.log(`  provider       : ${stated(provider)}`)
console.log(`  assetPrefix    : ${stated(assetPrefix)}`)
console.log(
  '  Each of these silently changed what somebody was looking at, at least once.',
)

/* --- Pages the author marked not-for-presentation ------------------------ */
// Worth its own section because this script exists to say what a deck is
// before anything is imported, and a page that is in the file but not in the
// presentation is exactly the kind of thing nobody notices until a layout
// appears in the template that the design never had. A template deck marks
// its own instructions page this way.
const skippedPages = deck.slides
  .map((slide, index) => ({ slide, number: index + 1 }))
  .filter(({ slide }) => slide.skipped)
// The same rule the importer applies, including its refusal to import
// nothing: a deck that is skipped end to end is imported whole.
const presented = deck.slides.filter(slide => !slide.skipped)
const importing = presented.length ? presented : deck.slides
rule('NOT FOR PRESENTATION')
console.log(
  skippedPages.length
    ? `  ${skippedPages.length} of ${deck.slides.length} pages marked "skip slide": ${skippedPages
        .map(({ number }) => `#${number}`)
        .join(', ')}`
    : '  none — every page here is part of the presentation',
)
console.log(
  importing.length === deck.slides.length && skippedPages.length
    ? '  Every page is skipped, so the import keeps them all: importing nothing is worse.'
    : `  An import leaves them out of the design AND of the lecture: ${importing.length} pages are imported.`,
)

/* --- Which import path the deck itself selects --------------------------- */
const usedLayouts = new Set(importing.map(s => s.layoutId).filter(Boolean))
rule('AUTHORED OR CLUSTERED')
console.log(
  `  slides ${importing.length} · layout pages ${deck.layouts.length} · used by slides ${usedLayouts.size}`,
)
console.log(
  usedLayouts.size > 1
    ? '  Defines its own layouts — so the AUTHORED path is AVAILABLE to it.'
    : '  Slides sit on one layout or none — the authored path is not available.',
)
// Which is not the same as it being taken, and the difference cost a wrong
// prediction: `keepEverySlide` SUPPRESSES the authored path outright
// (`import-presentation.ts`), deliberately, because keeping every slide means
// one layout per slide and an authored grouping is a grouping. Since keeping
// every slide is the shipped default, a default import gives one layout per
// slide whatever the deck's own layout pages say — the authored path runs
// only when an author asks for tidying.
console.log(
  keep === 'false'
    ? `  Tidying was asked for, so expect roughly ${usedLayouts.size} layouts plus the whiteboard.`
    : `  But keepEverySlide SUPPRESSES it: expect ${importing.length} layouts plus the whiteboard, one per slide.`,
)

/* --- Backgrounds --------------------------------------------------------- */
const backgrounds = new Map<string, number>()
for (const s of deck.slides)
  if (s.background)
    backgrounds.set(s.background, (backgrounds.get(s.background) ?? 0) + 1)
const ranked = [...backgrounds].sort((a, b) => b[1] - a[1])
rule('GROUND')
console.log(`  first slide: ${deck.slides[0]?.background ?? '—'}`)
console.log(
  `  dominant   : ${ranked[0]?.[0] ?? '—'} (${ranked[0]?.[1] ?? 0} of ${deck.slides.length})`,
)
if (ranked.length > 1)
  console.log(`  ALL: ${ranked.map(([c, n]) => `${c}×${n}`).join(' · ')}`)
if (ranked[0] && deck.slides[0]?.background !== ranked[0][0])
  console.log(
    "  ⚠ the first slide is NOT the deck's usual ground — the palette is chosen against the dominant one.",
  )

/* --- Pictures: the design-or-content question ---------------------------- */
const pics = (els: SourceElement[]) => els.filter(e => e.imageUrl)
const slidePics = deck.slides.flatMap(s => pics(s.elements))
const layoutPics = deck.layouts.flatMap(l => pics(l.elements))
const placeholders = [...slidePics, ...layoutPics].filter(
  e => e.placeholder,
).length
rule('PICTURES — where the design lives')
console.log(
  `  on slides ${slidePics.length} · on layout pages ${layoutPics.length} · PICTURE placeholders ${placeholders}`,
)
console.log(
  layoutPics.length > slidePics.length
    ? '  Design lives on the LAYOUT PAGES — the case the classification rule was fitted to.'
    : '  Design lives on the SLIDES — the inverted case. Slide pictures stay content boxes.',
)

/* --- Type ---------------------------------------------------------------- */
const sizes = new Map<string, number>()
let stating = 0
let runs = 0
for (const s of deck.slides)
  for (const e of s.elements)
    for (const r of e.runs ?? []) {
      runs++
      if (r.fontSize) {
        stating++
        sizes.set(
          r.fontSize.toFixed(2),
          (sizes.get(r.fontSize.toFixed(2)) ?? 0) + 1,
        )
      }
    }
rule('TYPE')
console.log(
  `  runs ${runs} · stating their own size ${stating} · inheriting ${runs - stating}`,
)
console.log(
  `  distinct sizes (cqi): ${
    [...sizes]
      .sort((a, b) => +b[0] - +a[0])
      .map(([s, n]) => `${s}×${n}`)
      .join(' · ') || '—'
  }`,
)
console.log(
  '  A scale is recovered from these. Fewer distinct sizes than you expect means something upstream collapsed them.',
)

/* --- Two things our own rules will act on -------------------------------- */
let caps = 0
let slivers = 0
for (const s of deck.slides) {
  const c = candidateOf(s)
  for (const slot of c.slots) {
    if (slot.caps) caps++
    if (slot.fontSize && (slot.kind === 'text' || slot.kind === 'bullets')) {
      const per = Math.max(
        1,
        Math.floor((slot.box.w * 100) / (slot.fontSize * 0.5)),
      )
      const lines = Math.max(
        1,
        Math.floor((slot.box.h * 56.25) / (slot.fontSize * 1.5)),
      )
      if (per * lines < 4) slivers++
    }
  }
}
rule('WHAT OUR OWN RULES WILL DO TO IT')
console.log(`  boxes our caps rule calls capitals : ${caps}`)
console.log(
  `  boxes too small to hold a word     : ${slivers}  (dropped as ornament)`,
)

/* --- Assets -------------------------------------------------------------- */
const urls = [...slidePics, ...layoutPics].map(e => e.imageUrl!).filter(Boolean)
const stabilised = urls.filter(u => u.includes('fixture.invalid')).length
rule('ASSETS')
console.log(
  `  image URLs ${urls.length} · stabilised ${stabilised} · live ${urls.length - stabilised}`,
)
if (stabilised)
  console.log(
    '  ⚠ stabilised URLs cannot be fetched. `assetsFailed` will be ABSENT, not zero, and no picture will be stored.',
  )

/* --- The half that matters most ------------------------------------------ */
rule('WHAT THIS CANNOT TELL YOU')
for (const line of [
  'Whether a picture is design or content. It reports which SURFACE each sits on,',
  '  which is a proxy — and one that has already failed in both directions.',
  'What the layouts will be CALLED. Names are assigned per import and move between runs;',
  '  never pair before/after by layout name.',
  'Whether the type scale is right. It reports the sizes present, not what they mean.',
  'Anything about rendering: clipping, overlap, contrast, wrapping. Only a browser sees those.',
  'Whether the deck is representative. One deck answers for one deck.',
  'Whether a picture will actually be FETCHED. Signed URLs expire within the hour,',
  '  and an expired one is a real failure rather than a classification result —',
  '  decoration pictures come back as zero either way.',
])
  console.log(`  ${line}`)
