/**
 * Whether a design's budgets can all be true at once (TMPL-19).
 *
 * Every other check on a budget asks about one box. This asks about the set:
 * fill EVERY box on a layout to its own stated limit simultaneously, add up
 * what they need, and compare that against the room the layout has. A design
 * whose boxes each fit alone and cannot fit together has stated a set of
 * promises it cannot keep, and until now nothing looked at the set.
 *
 * It is the cheap half of TMPL-19. The browser walk fills the boxes and
 * measures what a reader would see; this is arithmetic over rectangles and
 * runs in milliseconds. Both are wanted, and the difference between them is
 * the whole of the next section.
 *
 * ## THIS IS A NECESSARY CONDITION, NOT A SUFFICIENT ONE
 *
 * Stated first because a green here is easy to over-read, and the failure
 * TMPL-20 records is precisely somebody reading a check as answering more
 * than it asked.
 *
 * A column with room to spare can still be wrong in every way that matters.
 * `useFitText` can put its type on the floor; a descender can be clipped; a
 * line can be hidden. None of that is arithmetic over rectangles — it is
 * glyph metrics and a live measurement of `scrollHeight` against
 * `clientHeight` — and this has neither. It cannot see a single one of the
 * nine faults recorded against `nyu-elegant` in `e2e/tests/known-faults.ts`
 * except through the room those boxes were denied.
 *
 * So: **over-full is a fault; not-over-full is not a pass.** The case names
 * say so, the failure messages say so, and the coverage line printed on every
 * run says so, because a reader who meets this in a green suite six months
 * from now will have none of this context.
 *
 * ## Why the demand is measured with `grow` and `shrink` ignored
 *
 * `resolveTreeBoxes` answers where a box LANDS, which is a different question
 * and the wrong one here. A growing box reports the room it was handed and a
 * shrinking box reports the room it was left, so a column always resolves to
 * exactly its own height and the sum can never exceed it — the check would be
 * arithmetically incapable of failing.
 *
 * `columnDemand` measures each child at its content height instead. `grow`
 * and `shrink` decide who wins a fight over room; this asks whether there is
 * a fight. That distinction is not academic: `content-list` resolves to
 * exactly its available height and its budget set exceeds it, which is one of
 * the recorded faults and is invisible to the resolved reading.
 *
 * ## What is NOT examined, and why it is reported rather than skipped
 *
 * Only a layout whose root is a flex column. A nested column's height is
 * whatever its parent gave it, so its demand cannot be stated without
 * resolving the parent — and a figure derived that way reports the
 * arrangement, not the budgets. A grid root and an absolutely placed layout
 * have no column to be over-full.
 *
 * Those are real holes and the count is asserted, so that a change which
 * quietly stops examining a design fails here rather than going green with
 * nothing left to look at.
 */
import { describe, expect, it } from 'vitest'
import { columnDemand } from '../lib/tree-boxes'
import { listBuiltinTemplates } from './builtin'
import {
  themeTextStyles,
  type Layout,
  type SlotSpec,
} from '@slide-machine/shared'

const templates = listBuiltinTemplates()

/**
 * Ordinary words at ordinary lengths.
 *
 * Not one long run of characters: the line-count estimate breaks at spaces,
 * so unbroken text would wrap differently from anything a person writes and
 * the demand would be a measurement of the filler.
 */
const WORDS =
  'the quick brown fox jumps over a lazy dog and then walks back again to rest'.split(
    ' ',
  )

/** A string of exactly this many characters, made of whole words. */
const fill = (n: number): string => {
  let out = ''
  for (let i = 0; out.length < n; i++)
    out += (out ? ' ' : '') + WORDS[i % WORDS.length]
  return out.slice(0, n).trim()
}

/** The style a layout's tree puts on the node showing this slot, which is
 * where a box names the text role its budget belongs to. */
const nodeStyleFor = (layout: Layout, slot: string) => {
  let found: Record<string, unknown> | undefined
  const walk = (node: {
    slot?: string
    style?: object
    children?: unknown[]
  }) => {
    if (node.slot === slot) found = node.style as Record<string, unknown>
    for (const child of (node.children ?? []) as (typeof node)[]) walk(child)
  }
  if (layout.tree) walk(layout.tree)
  return found ?? {}
}

/**
 * What each box holds when it holds its budget.
 *
 * A budget may sit on the slot or on the text role the box follows, and the
 * slot's own value wins — the same precedence `limitsFor` applies, so this
 * fills to the number that actually governs.
 */
const atBudget =
  (layout: Layout, theme: Record<string, unknown>) =>
  (name: string): string[] => {
    const slot = layout.slots.find((s: SlotSpec) => s.name === name)
    if (!slot || slot.kind === 'image') return []
    const role = nodeStyleFor(layout, name)['textStyle'] as string | undefined
    const styles = themeTextStyles(theme)
    const fromRole = role ? styles[role] : undefined
    const maxChars = slot.maxChars ?? fromRole?.maxChars
    const maxItems = slot.maxItems ?? fromRole?.maxItems
    if (slot.kind === 'bullets')
      return Array.from({ length: maxItems ?? 5 }, () => fill(maxChars ?? 80))
    // A box with no stated budget contributes its minimum — one line. It is
    // not being checked; it is being kept in the column so its siblings are
    // measured against a realistic amount of room.
    return maxChars ? [fill(maxChars)] : []
  }

/**
 * Designs whose budget sets do not fit, recorded rather than fixed (TMPL-18).
 *
 * All six are the same fault in the same box: `classic`, `midnight` and
 * `seminar` state their bullet budget once, on the `bullet` text role, and
 * every layout showing a list inherits it. Six points of ninety characters at
 * 2.75cqi is two lines each, and twelve lines of that leading need more than
 * the column has.
 *
 * Not fixed here for two reasons. The number is a text ROLE's, so changing it
 * changes every list in three designs at once and that is a design decision
 * about those designs, not a repair to this one. And all three name no
 * typeface (TMPL-17), so what a reader actually sees depends on the face
 * their platform resolved — the arithmetic below is against the estimate, and
 * the browser walk is where their real behaviour is settled.
 *
 * Recorded WITH the measurement, and asserted to still reproduce: an entry
 * that stops matching fails, so a design that gets fixed cannot leave a stale
 * excuse behind it.
 */
interface RecordedFault {
  template: string
  layout: string
  /** What it was over by when recorded, `cqi`. */
  over: number
  why: string
}

const RECORDED: RecordedFault[] = [
  ...['classic', 'midnight', 'seminar'].flatMap(template => [
    {
      template,
      layout: 'list',
      over: 16.72,
      why: 'bullet role: 6 points of 90 chars at 2.75cqi is 53.63cqi of a 49.50cqi column',
    },
    {
      template,
      layout: 'content-list',
      over: 41.07,
      why: 'the same bullet role, beneath a body of its own',
    },
  ]),
]

const isRecorded = (r: { template: string; layout: string }): boolean =>
  RECORDED.some(f => f.template === r.template && f.layout === r.layout)

interface Reading {
  template: string
  layout: string
  needed: number
  available: number
  worst: string
}

const examined: Reading[] = []
const unexamined: { template: string; layout: string; why: string }[] = []

for (const template of templates)
  for (const layout of template.layouts) {
    const result = columnDemand(
      layout,
      template.theme ?? {},
      atBudget(layout, template.theme ?? {}),
    )
    if (!result.demand) {
      unexamined.push({
        template: template.id,
        layout: layout.type,
        why: result.why,
      })
      continue
    }
    const { needed, available, children, gaps } = result.demand
    const biggest = [...children].sort((a, b) => b.needs - a.needs)[0]
    examined.push({
      template: template.id,
      layout: layout.type,
      needed,
      available,
      worst:
        `${children
          .map(c => `${c.slot ?? c.id} ${c.needs.toFixed(2)}`)
          .join(' + ')} + ${gaps.toFixed(2)} of gaps` +
        (biggest ? `; largest is ${biggest.slot ?? biggest.id}` : ''),
    })
  }

describe("a design's budgets, all held at once", () => {
  /**
   * The premise. Everything below is a statement about columns that were
   * actually measured, and a run that measured none of them would report no
   * faults — which is what a pass looks like.
   */
  it('examined a column on most of the shipped layouts', () => {
    const total = examined.length + unexamined.length
    expect(
      examined.length,
      `no layout's budget set was examined at all, out of ${total}. ` +
        `Every one was skipped:\n` +
        unexamined.map(u => `  ${u.template}/${u.layout}: ${u.why}`).join('\n'),
    ).toBeGreaterThan(0)

    // Reported as a proportion rather than a bare count so the number moves
    // when a design is added, and so a run that quietly stops reaching
    // layouts is visible as a drop rather than as continued silence.
    const covered = examined.length / total
    expect(
      covered,
      `only ${examined.length} of ${total} shipped layouts have a root ` +
        `column to measure, which is too few for this check to mean much. ` +
        `Not examined:\n` +
        unexamined.map(u => `  ${u.template}/${u.layout}: ${u.why}`).join('\n'),
    ).toBeGreaterThan(0.5)
  })

  /**
   * The check itself.
   *
   * Named for what over-full MEANS rather than for the arithmetic, because
   * the arithmetic is the easy part to read off the failure message and the
   * consequence is not: a column asked for more room than it has hands the
   * shortfall to whichever box yields, and TMPL-19's worked example is a
   * caption that went to two pixels while every box involved stayed inside
   * its own stated limit.
   */
  it('no layout asks for more room than its column has', () => {
    const over = examined
      .filter(r => r.needed > r.available + 0.01)
      .filter(r => !isRecorded(r))
      .map(
        r =>
          `${r.template}/${r.layout}: needs ${r.needed.toFixed(2)}cqi of ` +
          `${r.available.toFixed(2)}cqi — over by ` +
          `${(r.needed - r.available).toFixed(2)}. ${r.worst}`,
      )
    expect(
      over,
      `These layouts state budgets that cannot all be true at once. Every ` +
        `box is inside its own limit and the column still cannot hold them, ` +
        `so at their stated budgets the shortfall goes to whichever box the ` +
        `design nominated to yield — and that box is drawn at whatever is ` +
        `left, which may be nothing.\n\n` +
        `Fix the budgets, not this threshold: the arithmetic is the ` +
        `renderer's own (server/src/lib/tree-boxes.ts).\n\n${over.join('\n')}`,
    ).toEqual([])
  })

  /**
   * Every recorded fault still reproduces, at the size it was recorded at
   * (TMPL-18).
   *
   * A tolerated fault that has quietly been fixed is an excuse nobody needs,
   * and one that has quietly got worse is a regression wearing an exemption.
   * Both read as a pass while the list sits there unread, so the list is
   * checked rather than trusted.
   */
  it('every recorded fault is still the fault that was recorded', () => {
    const wrong: string[] = []
    for (const fault of RECORDED) {
      const seen = examined.find(
        r => r.template === fault.template && r.layout === fault.layout,
      )
      if (!seen) {
        wrong.push(
          `${fault.template}/${fault.layout} is recorded as over-full and is ` +
            `no longer examined at all. Either it was fixed — delete the ` +
            `entry — or this check stopped reaching it, which is worse.`,
        )
        continue
      }
      const over = seen.needed - seen.available
      if (over <= 0.01) {
        wrong.push(
          `${fault.template}/${fault.layout} now fits (${seen.needed.toFixed(2)} ` +
            `of ${seen.available.toFixed(2)}). It was fixed; delete the entry.`,
        )
        continue
      }
      if (Math.abs(over - fault.over) > 0.05)
        wrong.push(
          `${fault.template}/${fault.layout} was recorded over by ` +
            `${fault.over.toFixed(2)}cqi and is now over by ${over.toFixed(2)}. ` +
            `A tolerated fault that moved is a change nobody described.`,
        )
    }
    expect(wrong, wrong.join('\n')).toEqual([])
  })

  /**
   * Said in the result, not only in the prose above (TMPL-20).
   *
   * A check that reaches nothing and a check that reaches everything must not
   * print the same word, and neither must a check that answers a narrow
   * question and one that answers a broad one. This case exists to put both
   * figures somewhere a reader of a green run will see them.
   */
  it('reports what it covered and what it cannot answer', () => {
    const byTemplate = new Map<string, number>()
    for (const r of examined)
      byTemplate.set(r.template, (byTemplate.get(r.template) ?? 0) + 1)
    const summary =
      `${examined.length} of ${examined.length + unexamined.length} ` +
      `shipped layouts measured (` +
      [...byTemplate].map(([id, n]) => `${id} ${n}`).join(', ') +
      `). NECESSARY CONDITION ONLY: room enough is not a promise the layout ` +
      `draws correctly — type on the floor, a clipped descender and a hidden ` +
      `line are all invisible here and belong to the browser walk (TMPL-20).`

    // Asserted so the string is built and cannot rot into a stale comment,
    // and so the numbers in it come from the same arrays the cases above use.
    expect(summary).toContain('NECESSARY CONDITION ONLY')
    expect(examined.length + unexamined.length).toBe(
      templates.reduce((n, t) => n + t.layouts.length, 0),
    )
  })
})
