/**
 * A real hand-built deck, imported (TMPL-8).
 *
 * Five slides, each a different colour, each carrying shapes and placeholders
 * nobody typed into — captured from the presentation that exposed the bug
 * below with `scripts/capture-google-presentation.mjs`.
 *
 * ## What it caught
 *
 * Consolidation returned two layouts, both white. Google hands every deck a
 * stack of default layout pages — this one has eleven — and the slides sit on
 * two of them while looking nothing alike. Grouping by the page took the
 * page's own design, which is blank, and threw four colours away.
 *
 * A hand-written fixture would not have found it: the deck it describes is
 * the deck whoever wrote it already had in mind, and nobody writes eleven
 * unused layout pages by hand.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { toSourcePresentation } from './read-slides'
import { importSourcePresentation } from './import-presentation'

const source = () =>
  toSourcePresentation(
    JSON.parse(
      readFileSync(path.join(__dirname, 'fixtures/coloured-deck.json'), 'utf8'),
    ) as Record<string, unknown>,
  )

/** The colour behind each layout, which arrives as a full-bleed decoration. */
const fills = (layouts: { decoration?: { fill?: string }[] }[]): string[] =>
  layouts
    .map(l => (l.decoration ?? []).find(d => d.fill)?.fill)
    .filter((f): f is string => Boolean(f))

describe('a deck of five colours', () => {
  it('reads a colour for every slide', () => {
    expect(source().slides.map(s => s.background)).toEqual([
      '#ff0000',
      '#4a86e8',
      '#0097a7',
      '#ff9900',
      '#ffffff',
    ])
  })

  it('keeps all five when consolidating, which is what the deck is', async () => {
    // Five slides that share no design consolidate to five: merging is for
    // the same design rebuilt by hand, not for slides that merely sit on the
    // same Google layout page
    const { template } = await importSourcePresentation(source())
    expect(new Set(fills(template.layouts)).size).toBe(5)
  })

  it('paints each layout the colour its slide was', async () => {
    const { template } = await importSourcePresentation(source())
    expect(fills(template.layouts)).toEqual(
      expect.arrayContaining(['#ff0000', '#4a86e8', '#0097a7', '#ff9900']),
    )
  })

  it('does not turn the deck white, whatever the layout pages say', async () => {
    // The bug exactly: two layouts, both the layout page's blank white
    const { template } = await importSourcePresentation(source())
    expect(fills(template.layouts).every(f => f === '#ffffff')).toBe(false)
  })

  it('agrees with keeping every slide, this deck being all one-offs', async () => {
    const consolidated = await importSourcePresentation(source())
    const verbatim = await importSourcePresentation(source(), {
      keepEverySlide: true,
    })
    expect(consolidated.report.layoutsCreated).toBe(
      verbatim.report.layoutsCreated,
    )
  })

  it('reports no lost material for slides nobody typed into', async () => {
    // Every placeholder here is empty; an empty box is not a loss (EXP-5)
    const { report } = await importSourcePresentation(source())
    expect(report.contentDropped).toBeUndefined()
  })
})
