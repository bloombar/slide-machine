/**
 * Whether the geometry an export draws is the geometry a reader saw (TMPL-22).
 *
 * `resolveTreeBoxes` is the only reader of a layout tree that draws without a
 * browser. The PDF and pptx writers go through it, so anywhere its arithmetic
 * departs from CSS the exported slide differs from the one on screen — and
 * nothing else can see it. The screen is correct, the data is correct, and
 * the file the user downloads is not.
 *
 * The defect this pins: the resolver distributed surplus space and ignored
 * deficit. An over-full column kept every child at its content height and ran
 * off the bottom of the slide, while the browser shrank the same boxes and
 * kept them on it. Measured at their own stated budgets, three shipped
 * layouts wrote their bullets to 23.7% of the slide height below the edge.
 *
 * ## THE ASSERTION IS NOT "NOTHING LEAVES THE SLIDE"
 *
 * That version is wrong and would have been the easy one to write.
 *
 * A design can genuinely overflow, and one of ours does: `two-column` on the
 * three faceless built-ins puts its title above the top edge and its body
 * past the bottom IN A BROWSER, at its own budgets, and that is recorded in
 * `e2e/tests/known-faults.ts` — `'two-column at its budget "title" runs off
 * the slide'`, measured at `y -0.035`. The export agrees with the renderer
 * there in direction and differs only in degree.
 *
 * So the property is **no box leaves the slide when the renderer keeps it
 * on**. A blanket rule would fire on `two-column` as though the exporter were
 * at fault, and the fix for it would be an exporter change that could not
 * work — the design is broken and the export is faithfully drawing a broken
 * design. Those two need to stay tellable apart.
 *
 * ## Why `two-column` is unaffected by the shrink fix, which is not an
 * ## oversight
 *
 * Its root is a grid. `flex-shrink` is a flex mechanism, and a CSS grid row
 * sized to its content overflows a fixed-height container rather than
 * compressing — so the resolver and the browser agree, and there is nothing
 * here to correct. That is why it is exempted by measurement rather than by
 * a tolerance.
 */
import { describe, expect, it } from 'vitest'
import { resolveTreeBoxes } from './tree-boxes'
import { listBuiltinTemplates } from '../templates/builtin'
import {
  themeTextStyles,
  type Layout,
  type SlotSpec,
} from '@slide-machine/shared'

const templates = listBuiltinTemplates()

/** Ordinary words, so the line-count estimate wraps the way prose does
 * rather than the way one long token would. */
const WORDS =
  'the quick brown fox jumps over a lazy dog and then walks back again to rest'.split(
    ' ',
  )

const fill = (n: number): string => {
  let out = ''
  for (let i = 0; out.length < n; i++)
    out += (out ? ' ' : '') + WORDS[i % WORDS.length]
  return out.slice(0, n).trim()
}

/** The text role a layout's tree puts on the node showing a slot, which is
 * where a budget stated on the role rather than the slot lives. */
const roleOf = (layout: Layout, slot: string): string | undefined => {
  let found: string | undefined
  const walk = (node: {
    slot?: string
    style?: { textStyle?: string }
    children?: unknown[]
  }) => {
    if (node.slot === slot) found = node.style?.textStyle
    for (const child of (node.children ?? []) as (typeof node)[]) walk(child)
  }
  if (layout.tree) walk(layout.tree)
  return found
}

/** Every box filled to its own stated limit at once, which is what a budget
 * is a promise about (TMPL-19). */
const atBudget =
  (layout: Layout, theme: Record<string, unknown>) =>
  (name: string): string[] => {
    const slot = layout.slots.find((s: SlotSpec) => s.name === name)
    if (!slot || slot.kind === 'image') return []
    const role = roleOf(layout, name)
    const styles = themeTextStyles(theme)
    const fromRole = role ? styles[role] : undefined
    const maxChars = slot.maxChars ?? fromRole?.maxChars
    const maxItems = slot.maxItems ?? fromRole?.maxItems
    if (slot.kind === 'bullets')
      return Array.from({ length: maxItems ?? 5 }, () => fill(maxChars ?? 80))
    return maxChars ? [fill(maxChars)] : []
  }

/**
 * Layouts whose design genuinely runs off the slide, so the export is right
 * to draw it that way.
 *
 * Each entry is justified by a browser measurement in
 * `e2e/tests/known-faults.ts` rather than by this file's own arithmetic — the
 * whole point is that an exemption here must be evidence about the RENDERER,
 * since the renderer is what the export is being compared against.
 */
const RENDERER_ALSO_OVERFLOWS: { template: string; layout: string }[] = [
  ...['classic', 'midnight', 'seminar'].map(template => ({
    template,
    layout: 'two-column',
  })),
]

const exempt = (template: string, layout: string): boolean =>
  RENDERER_ALSO_OVERFLOWS.some(
    e => e.template === template && e.layout === layout,
  )

describe('the geometry an export draws', () => {
  it('keeps every box on the slide, except where the renderer does not', () => {
    const off: string[] = []
    for (const template of templates)
      for (const layout of template.layouts) {
        if (exempt(template.id, layout.type)) continue
        const boxes = resolveTreeBoxes(
          layout,
          template.theme ?? {},
          atBudget(layout, template.theme ?? {}),
        )
        for (const box of boxes) {
          if (box.y >= -0.0005 && box.y + box.h <= 1.0005) continue
          off.push(
            `${template.id}/${layout.type} "${box.slot ?? '(decoration)'}" ` +
              `spans ${box.y.toFixed(3)}..${(box.y + box.h).toFixed(3)} — ` +
              `${(Math.max(0, box.y + box.h - 1) * 100).toFixed(1)}% of the ` +
              `slide's height below its bottom edge`,
          )
        }
      }
    expect(
      off,
      `These boxes are written past the edge of the slide by the exporters, ` +
        `at the design's own stated budgets. On screen the renderer shrinks ` +
        `them to fit, so the PDF and the pptx show something the reader ` +
        `never saw and no other check can see it.\n\n${off.join('\n')}`,
    ).toEqual([])
  })

  /**
   * The exemptions are still earned.
   *
   * An entry that stopped overflowing would be a design somebody fixed, and
   * leaving it listed would exempt the next regression on that layout. This
   * fails when that happens rather than going quietly green — the same
   * obligation `known-faults.ts` carries and the reason the list is short.
   */
  it('every exempted layout is still one that overflows', () => {
    const stale: string[] = []
    for (const { template: id, layout: type } of RENDERER_ALSO_OVERFLOWS) {
      const template = templates.find(t => t.id === id)
      const layout = template?.layouts.find(l => l.type === type)
      if (!template || !layout) {
        stale.push(`${id}/${type} is exempted and no longer exists`)
        continue
      }
      const boxes = resolveTreeBoxes(
        layout,
        template.theme ?? {},
        atBudget(layout, template.theme ?? {}),
      )
      const overflows = boxes.some(b => b.y < -0.0005 || b.y + b.h > 1.0005)
      if (!overflows)
        stale.push(
          `${id}/${type} is exempted as a design that overflows and it now ` +
            `fits. Delete the entry — while it stands it exempts anything ` +
            `that overflows on that layout in future.`,
        )
    }
    expect(stale, stale.join('\n')).toEqual([])
  })

  /**
   * The mechanism, on a shape with no design attached.
   *
   * The case above is about the shipped built-ins and would go green if they
   * all happened to fit. This asks the arithmetic directly: an over-full
   * column compresses the child that can give way, and leaves alone the one
   * that cannot.
   */
  it('takes the overflow out of the box that yields', () => {
    const layout = {
      type: 'probe',
      slots: [
        { name: 'title', kind: 'text' as const, label: 'Title' },
        { name: 'body', kind: 'text' as const, label: 'Body' },
      ],
      tree: {
        id: 'root',
        container: { mode: 'flex' as const, direction: 'column' as const },
        style: { padding: 0 },
        children: [
          { id: 'title', slot: 'title', shrink: 0, style: { fontSize: 10 } },
          { id: 'body', slot: 'body', style: { fontSize: 10 } },
        ],
      },
    }
    // A short headline and far more body than the slide is tall, so the
    // column is over-full and only one child can answer for it.
    const boxes = resolveTreeBoxes(layout, {}, name =>
      name === 'title' ? ['Heading'] : [fill(2000)],
    )
    const title = boxes.find(b => b.slot === 'title')!
    const body = boxes.find(b => b.slot === 'body')!

    expect(
      title.y + title.h + body.h,
      'an over-full column still ran past the bottom of the slide',
    ).toBeLessThanOrEqual(1.0005)
    expect(
      body.h,
      'the box that yields was not compressed at all',
    ).toBeLessThan(1)
    expect(
      title.h,
      'a box marked `shrink: 0` gave up height it had said it would not',
    ).toBeGreaterThan(0)
  })

  /**
   * And the case CSS answers by overflowing, which this must not "fix".
   *
   * A line whose children all refuse to yield has nothing to take the deficit
   * from. Compressing one anyway would be inventing a rule the browser does
   * not have, and the export would once again draw something nobody saw.
   */
  it('still overflows when nothing is allowed to yield', () => {
    const layout = {
      type: 'probe',
      slots: [
        { name: 'a', kind: 'text' as const, label: 'A' },
        { name: 'b', kind: 'text' as const, label: 'B' },
      ],
      tree: {
        id: 'root',
        container: { mode: 'flex' as const, direction: 'column' as const },
        style: { padding: 0 },
        children: [
          { id: 'a', slot: 'a', shrink: 0, style: { fontSize: 10 } },
          { id: 'b', slot: 'b', shrink: 0, style: { fontSize: 10 } },
        ],
      },
    }
    const boxes = resolveTreeBoxes(layout, {}, name =>
      name === 'a' ? ['Heading'] : [fill(2000)],
    )
    const total = boxes.reduce((most, b) => Math.max(most, b.y + b.h), 0)
    expect(
      total,
      'a column of boxes that all refuse to shrink was compressed anyway, ' +
        'which is not what CSS does with it',
    ).toBeGreaterThan(1)
  })
})
