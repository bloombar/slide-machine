/**
 * A measurement, not a test: where a computed box's height comes from.
 *
 * Written to settle one question about `nyu-elegant`. Three of its tolerated
 * faults name a box the gate reports as `486x2px holding 110 chars`. A box two
 * pixels tall holding a hundred and ten characters is either a defect or a
 * misreading, and nothing in the template file answers it — every one of that
 * design's sixteen layouts is TREE-stated, so not one of its boxes is a
 * rectangle anybody typed. Every box is computed by the renderer, and a
 * computed number has to be measured where it is computed.
 *
 * ## The control, which is the whole point of the file
 *
 * "The box is 2px" is not yet a finding: a box can be 2px because it was
 * always going to be 2px, or because something else on the slide took the
 * room. Those have different causes and different fixes, and they are
 * indistinguishable from a single measurement of the finished slide.
 *
 * So each box is measured three times on the way up — empty, holding only its
 * own content, and holding its own content beside a filled sibling — and the
 * three are reported together. If the box is the same height in all three, its
 * size is its own. If it shrinks only once the sibling is filled, the sibling
 * is where the height went, and the box is a remainder rather than a box.
 *
 * That is the question this directory keeps having to ask about its own
 * numbers: what would this read if the thing it measures had never happened.
 * Here it is cheap to ask, because the earlier states are on the way to the
 * later one and cost nothing extra to record.
 *
 * ## It asserts almost nothing, so it does not run by default
 *
 * The output is the point, and a probe that fails is a probe whose output you
 * do not get. A file asserting only "I measured something" left in the default
 * run would be a permanent green among real checks. So it SKIPS unless asked
 * for, and skips loudly rather than passing:
 *
 *     FLEX_PROBE=1 npx playwright test tests/flex-collapse.spec.ts
 *
 * `PROBE_DESIGN` and `PROBE_LAYOUTS` point it elsewhere. `PROBE_FILL` fills a
 * named slot to something other than its stated budget, which is what tells a
 * fault that is the honest cost of a design from one that only exists because
 * a box was asked to hold more than it can.
 *
 * ## What it found, so the numbers below can be checked against something
 *
 * It reproduces independently every figure the gate records for `nyu-elegant`
 * — the 486x2px box, the 10/29/58px hidden, the 0.40/0.75/0.80/0.88 scales,
 * the 14px of escaped ink. That agreement is the reason to keep it: two
 * instruments that were built separately and report the same numbers are
 * evidence in a way that either alone is not.
 *
 * Its result was that nine recorded faults are six boxes and two causes.
 * Seven of the nine are one cause on five boxes across five layouts: the last
 * shrinkable child of a flow layout absorbs every sibling's overflow. Cutting
 * the TITLES to 18 characters, and touching no caption budget at all, clears
 * five faults outright, returns all three captions to full size with nothing
 * hidden, and restores a section divider whose HEIGHT had been squeezed from
 * 1.53px to zero (its width, 35.95px, never changed).
 *
 * ## Two traps this file fell into first, which are easy to fall into again
 *
 * Both were bugs in the MEASUREMENT that produced healthy-looking numbers,
 * which is the only kind worth a warning. They are documented where they were
 * fixed — `clearSlot` and `writeInto` below — and named here so a reader who
 * changes the fill logic knows to go and read them: changing a slide's layout
 * does NOT clear its content, and two `fill()` strings of different lengths
 * share a prefix.
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect, type Page } from './fixtures'
import { settled, descenderFaultsOn } from './slide-boxes'
import { createProject } from './helpers'

const DESIGN = process.env.PROBE_DESIGN ?? 'nyu-elegant'
const LAYOUTS = (process.env.PROBE_LAYOUTS ?? 'closing,title,section').split(
  ',',
)
const OUT = path.resolve(process.env.PROBE_OUT ?? 'artifacts/flex-collapse')

/**
 * Per-slot budget overrides, as `layout.slot=chars`, comma separated.
 *
 * The point is to separate a fault that is the honest cost of a design from
 * one that only appears because the box was asked to hold more than it can.
 * `title-image.title` reports BOTH an over-budget and a clipped descender;
 * filling it instead to what its box supports says which of the two the
 * descender fault was.
 */
const OVERRIDE = new Map(
  (process.env.PROBE_FILL ?? '')
    .split(',')
    .filter(Boolean)
    .map(pair => {
      const [key, n] = pair.split('=')
      return [key!, Number(n)] as const
    }),
)

interface SlotSpec {
  name: string
  kind: string
  label?: string
  multiline?: boolean
  maxChars?: number
  maxItems?: number
}

const TEMPLATE = JSON.parse(
  readFileSync(
    path.resolve(`../server/config/templates/${DESIGN}.json`),
    'utf8',
  ),
) as {
  name: string
  layouts: { type: string; label: string; slots?: SlotSpec[] }[]
}

const WORDS = ['ridge', 'apply', 'gauge', 'jetty', 'query', 'plumb', 'gravy']

/** Text of exactly `chars` characters, built to wrap. */
const fill = (chars: number, tag = ''): string => {
  let text = tag ? `${tag} ` : ''
  for (let i = 0; text.length < chars; i++)
    text += (text ? ' ' : '') + WORDS[i % WORDS.length]
  return text.slice(0, chars).trimEnd().padEnd(chars, 'y')
}

/**
 * Every node of the slide's tree with the properties that decide its height.
 *
 * Containers are included, not just leaves. A leaf that lost its room lost it
 * to a rule applied by an ancestor, so a dump of leaves alone cannot say where
 * the height went — which is the question.
 */
const measure = (page: Page) =>
  page.evaluate(() => {
    const slide = document.querySelector('[data-testid="slide"]')
    if (!slide) return null
    const frame = slide.getBoundingClientRect()
    return {
      slidePx: { w: frame.width, h: frame.height },
      nodes: [...slide.querySelectorAll('[data-node-id]')].map(node => {
        const cs = getComputedStyle(node)
        const r = node.getBoundingClientRect()
        const leaf = !node.querySelector('[data-node-id]')
        return {
          id: node.getAttribute('data-node-id') ?? '?',
          leaf,
          // Geometry as drawn, and as a fraction of the slide, so it can be
          // compared with a source rectangle in cqi without a conversion
          // done by hand.
          rect: { x: r.x - frame.x, y: r.y - frame.y, w: r.width, h: r.height },
          cqi: {
            x: ((r.x - frame.x) / frame.width) * 100,
            y: ((r.y - frame.y) / frame.height) * 56.25,
            w: (r.width / frame.width) * 100,
            h: (r.height / frame.height) * 56.25,
          },
          clientHeight: node.clientHeight,
          scrollHeight: node.scrollHeight,
          clientWidth: node.clientWidth,
          scrollWidth: node.scrollWidth,
          overflowY: node.scrollHeight - node.clientHeight,
          // The flex properties that decide who gives up room, and the
          // min-height that decides how far. `flex-shrink` defaulting to 1
          // on a text box is the mechanism this probe exists to look for.
          flex: {
            display: cs.display,
            direction: cs.flexDirection,
            grow: cs.flexGrow,
            shrink: cs.flexShrink,
            basis: cs.flexBasis,
            minHeight: cs.minHeight,
            height: cs.height,
            alignItems: cs.alignItems,
            justifyContent: cs.justifyContent,
            gap: cs.gap,
            overflow: cs.overflow,
          },
          type: {
            fontSizePx: Number.parseFloat(cs.fontSize),
            lineHeightPx: Number.parseFloat(cs.lineHeight),
            fitScale: Number.parseFloat(
              cs.getPropertyValue('--fit-scale').trim() || '1',
            ),
            paddingTop: cs.paddingTop,
            paddingBottom: cs.paddingBottom,
          },
          chars: (node.textContent ?? '').trim().length,
        }
      }),
    }
  })

/**
 * Puts text into one slot and waits for the server to take it.
 *
 * Two things here were learned by getting them wrong in this file's first
 * run. The write is AWAITED, because a commit still in flight when the next
 * box is touched is silently dropped — the first run asked for 48 characters
 * in `section.title` and measured 44, the previous layout's text, and the
 * box looked perfectly healthy holding it.
 *
 * And the text is prefixed with the slot's own name, because `fill(44)` and
 * `fill(48)` share their first twenty characters — so the "did it land"
 * check passed against the text already there. A landing check that a stale
 * value satisfies is not a check.
 */
const writeInto = async (page: Page, slot: SlotSpec, text: string) => {
  const label = slot.label ?? slot.name
  const box = page.getByTitle(`Click to edit ${label}`).first()
  if (!(await box.count())) return false
  const written = page
    .waitForResponse(
      r =>
        /\/api\/actions\/slide\.editContent/.test(r.url()) &&
        r.status() === 200,
      { timeout: 10_000 },
    )
    .catch(() => undefined)
  await box.click({ timeout: 5_000 }).catch(async () => {
    console.log(`CLICK FALLBACK  ${label}: an ancestor took the pointer event`)
    await box.evaluate(el => (el as HTMLElement).click())
  })
  const field = page.getByRole('textbox', { name: label })
  await field.fill(text)
  await page.keyboard.press(
    slot.multiline || slot.kind === 'bullets' ? 'ControlOrMeta+Enter' : 'Enter',
  )
  await page.keyboard.press('Escape')
  await written
  return true
}

/** Empties a slot, so a layout is measured holding its own content rather
 * than whatever the previous layout left on the slide. */
const clearSlot = async (page: Page, slot: SlotSpec) => {
  const label = slot.label ?? slot.name
  const box = page.getByTitle(`Click to edit ${label}`).first()
  if (!(await box.count())) return
  const written = page
    .waitForResponse(
      r =>
        /\/api\/actions\/slide\.editContent/.test(r.url()) &&
        r.status() === 200,
      { timeout: 10_000 },
    )
    .catch(() => undefined)
  await box.click({ timeout: 5_000 }).catch(async () => {
    await box.evaluate(el => (el as HTMLElement).click())
  })
  const field = page.getByRole('textbox', { name: label })
  await field.fill('')
  await page.keyboard.press(slot.multiline ? 'ControlOrMeta+Enter' : 'Enter')
  await page.keyboard.press('Escape')
  await written
}

test('where a computed box gets its height', async ({ page }) => {
  test.skip(
    !process.env.FLEX_PROBE,
    'a probe, not a check — run with FLEX_PROBE=1',
  )
  test.setTimeout(600_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const email = `flex-${Date.now()}@example.com`
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Flex')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()

  await createProject(page, 'Flex')
  await page
    .getByRole('button', { name: 'Start a new lecture in Flex' })
    .click()
  await page.getByRole('button', { name: 'Start lecture' }).click()
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  await page.getByRole('tab', { name: 'Design' }).click()
  await page
    .getByRole('radio', { name: new RegExp(TEMPLATE.name, 'i') })
    .click()
  await page.getByRole('button', { name: 'Close settings' }).click()

  await page.getByLabel('Spoken phrase').fill('Opening')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByText('1 / 1')).toBeVisible({ timeout: 15_000 })

  const slide = page.getByTestId('slide').first()
  const report: Record<string, unknown> = {}

  for (const type of LAYOUTS) {
    const layout = TEMPLATE.layouts.find(l => l.type === type)
    if (!layout) continue
    await page.getByRole('button', { name: 'Options for slide 1' }).click()
    await page.getByRole('menuitem', { name: 'Change layout' }).click()
    const dialog = page.getByRole('dialog', { name: 'Change slide layout' })
    await expect(dialog).toBeVisible()
    const radios = dialog.getByRole('radio')
    const labels = (await radios.allInnerTexts()).map(t =>
      (t.split('\n')[0] ?? '').trim(),
    )
    await radios.nth(labels.indexOf(layout.label)).click()
    await expect(slide).toHaveAttribute('data-layout', type)
    await page
      .getByText(/Filled the boxes this layout added/)
      .waitFor({ state: 'hidden', timeout: 15_000 })
      .catch(() => {})

    // Bullets included: `content-list.bullets` is one of the boxes this is
    // pointed at, and a bullets slot's budget is maxItems lines of maxChars.
    const texts = (layout.slots ?? []).filter(
      s => s.kind === 'text' || s.kind === 'bullets',
    )
    /** The text that fills a slot to exactly its stated budget, or to an
     * override where one was given. */
    const chars = (slot: SlotSpec): number =>
      OVERRIDE.get(`${type}.${slot.name}`) ?? slot.maxChars ?? 40
    const budgetText = (slot: SlotSpec): string =>
      slot.kind === 'bullets'
        ? Array.from({ length: slot.maxItems ?? 3 }, (_, i) =>
            fill(chars(slot), `${slot.name}${i}`),
          ).join('\n')
        : fill(chars(slot), slot.name)
    /** What that text amounts to once the browser has it, newlines dropped. */
    const budgetChars = (slot: SlotSpec): number =>
      slot.kind === 'bullets' ? chars(slot) * (slot.maxItems ?? 3) : chars(slot)
    // The caption first, ALONE, then its sibling — so the caption's own
    // height is on record before anything else can take room from it.
    const caption = texts.find(s => s.name === 'caption')
    const others = texts.filter(s => s.name !== 'caption')
    const states: Record<string, unknown> = {}

    /*
     * Emptied before anything is measured, because changing a slide's layout
     * does NOT clear its content. The first run of this probe measured
     * `title` in its "empty" state holding a hundred and ten characters left
     * behind by `closing`, and reported it as the box's own baseline. A
     * contaminated baseline is worse than no baseline: it reads exactly like
     * a real one, and it is the control the whole file rests on.
     */
    for (const slot of texts) await clearSlot(page, slot)
    await settled(page)
    states.empty = await measure(page)

    /** What each box holds, against what it was asked to hold. A box that
     * quietly kept an older value is the failure mode above, so the counts
     * are checked rather than assumed. */
    const held = (s: unknown, id: string) =>
      (
        (s as { nodes: { id: string; chars: number }[] } | null)?.nodes ?? []
      ).find(n => n.id === id)?.chars

    if (caption) {
      const want = budgetChars(caption)
      await writeInto(page, caption, budgetText(caption))
      await settled(page)
      states.captionOnly = await measure(page)
      const got = held(states.captionOnly, 'caption')
      if (got !== want)
        console.log(
          `MISMATCH  ${type}.caption asked for ${want} chars and holds ` +
            `${String(got)} — this state is NOT a measurement of that budget`,
        )
    }
    for (const slot of others) await writeInto(page, slot, budgetText(slot))
    await settled(page)
    states.both = await measure(page)
    for (const slot of texts) {
      const want = budgetChars(slot)
      const got = held(states.both, slot.name)
      if (got !== want)
        console.log(
          `MISMATCH  ${type}.${slot.name} asked for ${want} chars and holds ` +
            `${String(got)} — this state is NOT a measurement of that budget`,
        )
    }

    // The ink-vs-box rule, run on the same state the gate runs it on, so a
    // descender fault can be attributed to the leading or to the budget.
    const descenders = await descenderFaultsOn(slide, `${DESIGN} ${type}`)
    for (const fault of descenders) console.log(`DESCENDER  ${fault}`)
    if (!descenders.length) console.log(`DESCENDER  ${type}: none`)
    report[type] = { declared: layout.slots, states, descenders }
    const cap = (s: unknown) =>
      (
        (
          s as {
            nodes: { id: string; rect: { w: number; h: number } }[]
          } | null
        )?.nodes ?? []
      ).find(n => n.id === 'caption')?.rect
    console.log(
      `HEIGHT  ${type}.caption  empty=${JSON.stringify(cap(states.empty))} ` +
        `captionOnly=${JSON.stringify(cap(states.captionOnly))} ` +
        `both=${JSON.stringify(cap(states.both))}`,
    )
  }

  mkdirSync(OUT, { recursive: true })
  writeFileSync(
    path.join(OUT, `${DESIGN}.json`),
    JSON.stringify(report, null, 2),
    'utf8',
  )
  expect(Object.keys(report).length, 'no layout was measured').toBeGreaterThan(
    0,
  )
})
