/**
 * The stand-in slide a template preview is drawn with.
 *
 * A layout is easier to judge full than empty, so every slot the layout
 * declares gets something — sample sentences for text, a few points for a
 * bullet list, and a real picture for an image slot, fetched once and shared
 * (usePreviewImages).
 *
 * The text is translated rather than lorem ipsum: a preview should read as a
 * slide in the reader's own language. A slot the author named gets its own
 * label, so a layout of their own previews as itself rather than as a blank.
 *
 * Given `budgets`, each box is filled to the most it is ever allowed to hold
 * instead (`slotLimits`, shared with the server so the preview shows the
 * capacity generation actually writes to) — the case a design has to survive
 * and the one a comfortable sample never shows. A box no limit reaches
 * previews at its sample length however the checkbox is set: there is no "too
 * much" to show for a box nothing bounds.
 */
import type { Layout, Slide, SlotLimits } from '@slide-machine/shared'

export interface SampleText {
  title: string
  body: string
  caption: string
  bullets: string[]
}

/**
 * `text` repeated up to `chars` long.
 *
 * Cut to the character rather than to the nearest word: the point is the
 * fullest a box can ever be, and stopping at the last whole word would show
 * something short of it. A cut that lands on a space loses it — a trailing
 * space is neither drawn nor worth a character of the budget.
 */
const grown = (text: string, chars: number): string => {
  const seed = text.trim() || '…'
  let out = seed
  while (out.length < chars) out = `${out} ${seed}`
  return out.slice(0, chars).trimEnd()
}

/** The language a code box declares, when it declares one. */
const languageOf = (spec: { options?: Record<string, unknown> }) =>
  typeof spec.options?.language === 'string' ? spec.options.language : undefined

/** Short, real listings so a preview shows what the box will look like at the
 * size it will be. Keyed by language, with one that reads as code in any. */
const SAMPLE_CODE: Record<string, string> = {
  python: 'def collected(area, rain):\n    return area * rain * 0.8',
  javascript: 'const collected = (area, rain) => area * rain * 0.8',
  typescript:
    'const collected = (area: number, rain: number) => area * rain * 0.8',
  sql: 'SELECT year, SUM(rainfall)\n  FROM readings\n GROUP BY year;',
  default: 'collected = area * rain * 0.8',
}

/** A formula an audience reads at a glance, rather than one that fills the box. */
const SAMPLE_TEX = 'V = A \\times r \\times C'

const SAMPLE_PREFORMATTED =
  'roof  ->  gutter  ->  filter\n            |\n          tank'

/**
 * Builds the slide. `images` are cycled across the layout's picture boxes, so
 * a layout with four of them shows four different pictures rather than the
 * same one four times; with none, image slots stay empty and the renderer
 * shows the quiet block it always did.
 *
 * With `budgets`, every bounded box is filled to its limit instead of to the
 * sample's own length.
 */
export const sampleSlide = (
  layout: Layout,
  text: SampleText,
  images: string[] = [],
  id = 'preview',
  budgets?: Record<string, SlotLimits>,
): Slide => {
  const named: Record<string, string> = {
    title: text.title,
    body: text.body,
    caption: text.caption,
  }
  const slots: Slide['slots'] = {}
  let picture = 0
  for (const spec of layout.slots) {
    const budget = budgets?.[spec.name]
    if (spec.kind === 'bullets') {
      const count = budget?.maxItems ?? text.bullets.length
      const items = Array.from(
        { length: Math.max(1, count) },
        (_, i) =>
          text.bullets[i % text.bullets.length] ?? text.bullets[0] ?? '',
      )
      slots[spec.name] = {
        kind: 'bullets',
        items: budget?.maxChars
          ? items.map(item => grown(item, budget.maxChars!))
          : items,
      }
    } else if (spec.kind === 'image') {
      const ref = images[picture++ % Math.max(1, images.length)]
      slots[spec.name] = { kind: 'image', ref }
    } else if (spec.kind === 'code') {
      // A box that will hold a listing has to preview as one, or an author
      // choosing the kind sees a line of prose and cannot tell it took.
      slots[spec.name] = {
        kind: 'code',
        source: SAMPLE_CODE[languageOf(spec) ?? ''] ?? SAMPLE_CODE.default!,
        ...(languageOf(spec) ? { language: languageOf(spec)! } : {}),
      }
    } else if (spec.kind === 'math') {
      slots[spec.name] = { kind: 'math', tex: SAMPLE_TEX }
    } else if (spec.kind === 'table') {
      slots[spec.name] = {
        kind: 'table',
        header: ['Year', 'Rainfall'],
        rows: [
          ['2023', '742 mm'],
          ['2024', '812 mm'],
        ],
      }
    } else if (spec.kind === 'preformatted') {
      slots[spec.name] = { kind: 'preformatted', value: SAMPLE_PREFORMATTED }
    } else {
      const value = named[spec.name] ?? spec.label
      slots[spec.name] = {
        kind: 'text',
        value: budget?.maxChars ? grown(value, budget.maxChars) : value,
      }
    }
  }
  return {
    id: `preview-${id}`,
    deckId: 'preview',
    index: 0,
    layoutType: layout.type,
    slots,
  }
}
