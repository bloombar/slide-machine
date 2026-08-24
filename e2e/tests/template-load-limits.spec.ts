/**
 * Whether a design holds the content it says it holds — at both ends of its
 * own stated range (TMPL-8).
 *
 * `imported-template-fidelity.spec.ts` strains a design with a lecture, but
 * only ever reaches the handful of layouts the generator happens to choose,
 * and only ever with the words the generator happens to write. This walks
 * EVERY layout and fills it deliberately, twice: once to the top of every
 * budget the design declares, and once with everything optional left out.
 *
 * ## Why two loads and not one
 *
 * They fail in opposite directions and neither finds the other's defect.
 *
 * At the LIMIT, a box asked for exactly what it claims to hold either shows
 * it or does not. This is where a budget derived from the wrong arithmetic
 * shows up — `capacityOf` divides a box's height by its font size times its
 * leading, so a wrong leading yields a wrong `maxChars`, and a multi-line
 * title is the shape that exposes it. A single line fits at any leading.
 *
 * Which boxes actually carry the signal is narrower than it first looks, and
 * worth knowing before reading a result here. A leading defect of the kind
 * this design had is a DISPLAY-type defect: a deck's body leading and a
 * plausible wrong default sit close enough together that body budgets move by
 * a fraction of a per cent, while display titles move by half again. So a
 * body block looks identical whether the leading is right or wrong and
 * certifies nothing. The multi-line titles are the diagnostic boxes.
 *
 * At the FLOOR, the question is the reverse: does the design stay put when
 * the content does not arrive. An optional box left empty must take no room —
 * `FlowLayout` returns nothing at all for a slot with nothing to show, so
 * that an absent caption does not reserve a gap. A box that instead keeps its
 * space leaves a hole, and one that collapses wrongly drags its neighbours
 * into places the designer never put them.
 *
 * ## The measurement that matters most here is not the obvious one
 *
 * The obvious reading of "does it fit" is clipping, and clipping is the one
 * thing this cannot rely on. `useFitText` shrinks a box's type until its
 * content fits rather than letting it clip — right for a deck imported from
 * elsewhere, which arrives as full as its author made it, and the reason a
 * badly wrong design can measure clean. The box keeps its geometry, the
 * content ends up fitting, and nothing clips, overlaps or leaves the slide.
 * What is left is smaller type, which no geometry check can see.
 *
 * So `shrunkOn` is the assertion carrying this suite. Every box here is given
 * no more than the design's OWN declared budget for it, so a box that has to
 * shrink to show that much is not holding long content — it is stating a
 * budget its geometry cannot honour. That is the arithmetic being wrong, and
 * it reports as a number rather than as an opinion about a screenshot.
 *
 * ## "No shrink at the declared budget" is a claim about REALISTIC content
 *
 * The criterion is that a box filled to its own stated budget draws at full
 * size. That is a claim this walk can make because it fills with ordinary
 * words; it is NOT a guarantee the design could offer for arbitrary
 * characters, and no budget could. A budget is derived from an average
 * character width, so seven `w`s overflow a box that seven of almost anything
 * else fits — the same box, the same count, a different answer.
 *
 * So a pass here means: at this budget, with content of ordinary letter
 * widths, nothing shrinks. It does not mean no content of that length can
 * ever shrink it. Reading it as the stronger claim would make every
 * character-average budget in the app look like a defect.
 *
 * ## A clean result here does not mean the budget is right
 *
 * Worth being exact about, because the obvious reading is wrong. Every box is
 * filled to the number the design declares, so what a clean run establishes
 * is that the design SURVIVES ITS OWN CLAIM. Whether the claim is the right
 * claim is a different question and this cannot answer it.
 *
 * It matters because the estimate is known to run generous in two ways at
 * once. Google reserves default insets inside a text box — about a tenth of
 * an inch each side, a twentieth top and bottom — which the wrap model does
 * not subtract, so a box is credited with several per cent more width and
 * height than it can actually set text in. And a single line of display caps
 * is charged `fontSize x lineHeight`, which overstates the ink of one line,
 * so tall single-line boxes are over-budgeted further.
 *
 * The consequence for reading a result here: filling to a generous budget
 * fills to less than the box's true limit, so this walk passes comfortably
 * while the declared budget is still too large for real content. It bounds
 * the design against its own arithmetic, and the arithmetic is measured
 * elsewhere. A green is not a certificate that the numbers are correct.
 *
 * ## This walk serialises its fills, and that is a WORKAROUND
 *
 * Said out loud because a silent workaround is indistinguishable from a
 * suite that never had the problem.
 *
 * Every box is filled, blurred, and its write waited for before the next box
 * is touched. Real users do not type that way, and the reason this does is a
 * pre-existing defect: `slideSchema.pre('save')` republishes the entire slot
 * map on every save, so two overlapping `slide.editContent` calls each write
 * back their own copy and the second erases the first. A write still in
 * flight when the layout changes lands under the NEW layout — which is how
 * one layout's text turned up in the next layout's box, and how this suite
 * spent a day reporting shrink faults on boxes holding content from a
 * different layout entirely.
 *
 * Serialising makes this walk measure the design. **It also makes that defect
 * invisible here.** The regression test for it — two boxes filled back to
 * back at human speed, both asserted to survive — lives with the fix on
 * `fix/slide-lost-update`, because a test that must fail today cannot land on
 * a branch that has to go green, and one that lands green without the fix
 * would be worse than none.
 *
 * So: this suite does NOT currently cover the lost update. That is deliberate
 * and it is written down here so nobody later reads its silence as coverage.
 *
 * ## Nothing here pins a budget
 *
 * Every limit is read from the template at run time. The derived numbers move
 * whenever the importer's estimate changes — and they are expected to move —
 * so a number copied into this file would stop being a check and become a
 * second copy of the answer, going green against whatever the importer last
 * produced. The property asserted is that a design honours whatever it
 * declares, not that it declares any particular thing.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { slotLimits, themeTextStyles } from '@slide-machine/shared'
import { test, expect, type Page } from './fixtures'
import {
  descenderFaultsOn,
  faultsOn,
  holesOn,
  settled,
  shrunkOn,
} from './slide-boxes'
import { createProject } from './helpers'
import { KNOWN_FAULTS, unknownFaults } from './known-faults'

const stamp = Date.now()
const password = 'sturdy-passw0rd'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** One slot as a template file declares it. */
interface SlotSpec {
  name: string
  kind: 'text' | 'bullets' | 'image' | 'code' | 'math'
  label: string
  multiline?: boolean
  maxChars?: number
  maxItems?: number
}

interface LayoutSpec {
  type: string
  label: string
  slots?: SlotSpec[]
}

interface TemplateFile {
  id: string
  name: string
  theme?: Record<string, unknown>
  layouts: LayoutSpec[]
}

/**
 * The budget a box actually has, resolved the way the APP resolves it.
 *
 * A design states its limits in one of three places and the renderer reads
 * all three: on the slot, on the text style the box follows, or in the
 * layout's `constraints`. Reading only the slot is what this spec did, and it
 * reported `classic` and `midnight` as declaring no budget for their titles —
 * they declare 50 via `constraints.maxTitleChars` and 60 via the `title`
 * style. The walk then failed two designs this branch never touched, for a
 * property they have.
 *
 * Resolved through `slotLimits`, the same function the editor and the
 * generation prompt use, so this cannot drift from what the app enforces.
 */
const budgetsFor = (
  template: TemplateFile,
  layout: LayoutSpec,
): Record<string, { maxChars?: number; maxItems?: number }> =>
  slotLimits(layout as never, themeTextStyles((template.theme ?? {}) as never))

/**
 * Every design the app ships, read from what it loads rather than listed.
 *
 * All of them, not only the newest. A hand-written design can state a budget
 * its box cannot honour just as easily as a derived one can; the derived ones
 * are simply likelier to, because nobody looked at the number.
 */
const TEMPLATES: TemplateFile[] = readdirSync(
  path.resolve('../server/config/templates'),
)
  .filter(file => file.endsWith('.json'))
  .map(
    file =>
      JSON.parse(
        readFileSync(path.resolve('../server/config/templates', file), 'utf8'),
      ) as TemplateFile,
  )

/**
 * Words chosen so that filling a box to its budget tests the box rather than
 * the word list.
 *
 * Every one carries a descender (g, j, p, q, y). A caps display face sets
 * them above the baseline, but the line box is still sized for them, so a
 * design whose leading is too tight cuts them off — which is the fault
 * `descenderFaultsOn` exists to name, and it cannot be seen with text that
 * has no tails. They are also short and varied in length, so text built from
 * them wraps at many different points rather than at one.
 */
const WORDS = [
  'ridge',
  'apply',
  'gauge',
  'jetty',
  'query',
  'plumb',
  'gravy',
  'edgy',
  'sponge',
  'yield',
]

/**
 * Text of exactly `chars` characters, built to wrap.
 *
 * Exactly, not approximately: the budget is a claim about a character count,
 * and testing it with a different count tests something else. The last word
 * is trimmed or padded to land on the number.
 */
const fill = (chars: number, tag = ''): string => {
  if (chars <= 0) return ''
  // Seeded per box, so no two boxes on a slide hold the same words.
  //
  // They used to. Every box was filled from the same word list, so a check
  // of the form "the slide contains what I typed" passed the moment ANY box
  // held it — and a box whose fill never landed was certified by its
  // neighbour's content. Measured: three boxes filled, all three reported
  // written, one of them empty. A verification that cannot fail is worse
  // than none, because it is counted as coverage.
  let text = tag ? `${tag} ` : ''
  for (let i = 0; text.length < chars; i++) {
    text += (text ? ' ' : '') + WORDS[i % WORDS.length]
  }
  return text.slice(0, chars).trimEnd().padEnd(chars, 'y')
}

/**
 * What the editor calls a slot, which is not always what the template does.
 *
 * A label a template author wrote is shown as written; a conventional slot
 * the server filled in with the English default is shown from the locale
 * bundle instead (`slots.tsx`). Those two strings are identical in English,
 * and the whole suite is pinned to `en-US` by the Playwright config, so the
 * template's own label is the right answer for both — but the rule is worth
 * stating, because it is not the rule in any other language.
 */
const editableLabel = (slot: SlotSpec): string => slot.label ?? slot.name

/** Puts text into one slot through the editor, the way a user would. */
const writeInto = async (page: Page, slot: SlotSpec, text: string) => {
  const label = editableLabel(slot)
  const box = page.getByTitle(`Click to edit ${label}`).first()
  if (!(await box.count())) return false
  /*
   * The listener goes on BEFORE the interaction.
   *
   * Registering it afterwards is a race that is lost intermittently on a fast
   * local server — the worst kind, because it fails rarely enough to look
   * like flake.
   *
   * Tolerated rather than asserted: a no-op edit fires no request at all
   * (`EditableText` early-returns when the value is unchanged), so waiting
   * for one would hang and read as the defect. The wait is a cadence, not a
   * check — what the box actually DRAWS is checked separately, because a 200
   * says the server accepted a patch, not that the box holds it. That is the
   * same "it did not throw" reasoning this suite has already retracted once.
   */
  const written = page
    .waitForResponse(
      r =>
        /\/api\/actions\/slide\.editContent/.test(r.url()) &&
        r.status() === 200,
      { timeout: 10_000 },
    )
    .catch(() => undefined)
  await box.click()
  const field = page.getByRole('textbox', { name: label })
  await field.fill(text)
  // A multi-line field takes Enter as a newline, so it is committed with the
  // modifier instead; a single-line one commits on Enter.
  await page.keyboard.press(slot.multiline ? 'ControlOrMeta+Enter' : 'Enter')
  /*
   * Leave the box and let its write finish before the next one is touched.
   *
   * Two overlapping saves each republish the whole slot map from their own
   * copy of the slide, so the second erases the first — and a write still in
   * flight when the layout changes lands under the NEW layout, which is how
   * one layout's text turned up in the next layout's box.
   *
   * Serializing is what makes this walk measure the design rather than that
   * race. It is deliberately NOT a fix: the product defect is still there,
   * and a suite that tiptoes around it would stop seeing it. Whether each box
   * actually DREW what it was given is checked separately, after the walk.
   */
  await blurEditor(page)
  await written
  return true
}

/**
 * Uploads a picture into the nth empty image slot.
 *
 * The click is dispatched rather than performed. A real click is hit-tested,
 * and the slide carries its own chrome — the per-slide options kebab sits at
 * `top-3 end-3` over the slide, and the header sits above that — so on a
 * layout whose picture box reaches the top corner the button is covered by
 * editor furniture and a click retries until it times out. That is a fact
 * about where the editor draws its own controls, not about the design being
 * photographed, and it is not what this spec is measuring.
 *
 * Dispatching still runs the app's own handler, so the picture really is
 * added by the app; what is skipped is only the actionability check. Nothing
 * here asserts that the button is reachable by pointer — if that needs
 * testing it needs a spec of its own, and this one would be the wrong place
 * to learn it from.
 */
const addImage = async (
  page: Page,
  nth: number,
  name: string,
): Promise<boolean> => {
  /*
   * Retried once, because the dialog reaches the open internet.
   *
   * Opening it starts an Openverse image search, and the upload input is not
   * usable until that has settled. Under load — three uploads in a row on one
   * layout, or a CI runner — the first attempt times out where the same call
   * succeeds moments later. Measured: on `image-list`, two of three pictures
   * uploaded and the third timed out; on a rerun, a different one.
   *
   * One retry, not a longer timeout: a longer timeout hides how long this
   * actually takes and gets tuned upward every time it fails. If both
   * attempts fail the box is reported unfilled with the reason, which is the
   * honest outcome for a picture nobody managed to put in.
   */
  for (let attempt = 0; attempt < 2; attempt++) {
    if (await tryAddImage(page, nth, name)) return true
  }
  return false
}

const tryAddImage = async (page: Page, nth: number, name: string) => {
  const add = page.getByRole('button', { name: 'Add image' })
  // Waited for rather than counted: a picture box that is its layout's first
  // slot is reached before the empty-slot affordance has rendered and reports
  // zero, while the same box later in declaration order reports one. The
  // affordance was never missing; the question was asked too early.
  await add
    .nth(nth)
    .waitFor({ state: 'attached', timeout: 10_000 })
    .catch(() => {})
  if ((await add.count()) <= nth) return false
  // Dispatched, not clicked: the slide carries its own chrome — the options
  // kebab sits over the top-right corner — so on a layout whose picture box
  // reaches that corner a real click is intercepted by editor furniture.
  // Dispatching still runs the app's handler; only hit-testing is skipped,
  // and nothing here asserts the button is reachable by pointer.
  // A real click, not a dispatch. The button sits in an `opacity-0
  // group-hover` container, which Playwright treats as visible and clicks
  // fine; dispatching skipped the app's own pointer handling and left the
  // dialog unopened on `image-full` — the button was present, enabled and
  // visible, and no dialog appeared.
  await add.nth(nth).click({ force: true })
  const dialog = page.getByRole('dialog', { name: 'Add image' })
  // Bounded, and false rather than hanging. An upload that never opens its
  // dialog used to consume the whole 5-minute test budget and report a
  // timeout, which says nothing about the design; reporting the box as
  // unfilled says exactly what happened and lets the walk finish.
  try {
    await dialog.waitFor({ state: 'visible', timeout: 15_000 })
    /*
     * The file input by TYPE, not by label.
     *
     * `getByLabel('Upload image file')` matched nothing — the dialog carries
     * no `<label>` elements at all, so the locator waited out its timeout and
     * the box was reported untested. Two picture boxes sat as "upload never
     * completes" on that, which read as a possible product defect; the upload
     * path works, and targeting the input directly completes it (201 from
     * `/api/slides/:id/image`, picture on the slide).
     */
    const input = dialog.locator('input[type=file]')
    await input.waitFor({ state: 'attached', timeout: 10_000 })
    await input.setInputFiles(
      { name, mimeType: 'image/png', buffer: PNG },
      { timeout: 20_000 },
    )
    // Choosing the file IS the submit — the dialog has no confirm button.
    await dialog.waitFor({ state: 'hidden', timeout: 20_000 })
    return true
  } catch (error) {
    // Named rather than swallowed: "never filled" says nothing about why,
    // and the difference between a dialog that does not open and an upload
    // that does not complete is the difference between a harness fault and a
    // product one.
    imageFailures.push(
      `${name}: ${((error as Error).message.split('\n')[0] ?? '').slice(0, 120)}`,
    )
    return false
  } finally {
    /*
     * The dialog is closed whatever happened, and this is not tidiness.
     *
     * It runs a web image search, so it stays open on a slow or failed
     * upload — and it is a full-screen overlay. Left open it intercepts every
     * later click on the slide, so the NEXT layout's edit hangs for the whole
     * five-minute test budget and the walk dies somewhere unrelated to the
     * box that actually failed. One unclosed dialog reads as a fault in a
     * different layout.
     */
    // ANY dialog, not the one we opened by name. The image dialog runs a web
    // search and its accessible name changes once results arrive, so a
    // name-scoped locator stopped seeing the very dialog it had opened — and
    // the overlay then intercepted every later click, hanging the next
    // layout's edit for the whole test budget. Closed by role and waited on
    // by count, so neither the name nor the state matters.
    for (let attempt = 0; attempt < 3; attempt++) {
      if ((await page.locator('[role="dialog"]').count()) === 0) break
      await page.keyboard.press('Escape')
      await page
        .locator('[role="dialog"]')
        .waitFor({ state: 'detached', timeout: 5_000 })
        .catch(() => {})
    }
  }
}

/** Why an image fill failed, collected so the walk can report causes. */
const imageFailures: string[] = []

/**
 * Leaves whatever field is being edited, deterministically.
 *
 * Not cosmetic — it is the difference between measuring the design and
 * measuring the editor. A box still being edited holds an open `<textarea>`
 * AND the slot's hint ("Why the figure matters… · up to 141"), and neither is
 * content, neither scales with `--fit-scale`, and both sit inside the node.
 * Measured that way `big-number.body` reported 210 characters, scale 0.40 and
 * 44px hidden; blurred, the same box on the same commit reports 141
 * characters, scale 1.00 and nothing hidden. Every shrink fault this suite
 * once reported was that.
 *
 * It must NOT press Escape. Escape CANCELS the edit — this helper pressed it
 * for three runs and discarded every value the walk had just typed. Measured
 * directly: a box holding 250 characters while editing read 0 the instant
 * this ran. What the gate then measured was whatever the layout switch had
 * auto-filled, which is the same source text on every layout — which is why
 * two boxes of different sizes with different budgets both reported exactly
 * 246 characters. That constant was the fingerprint of the content being
 * thrown away, not of a measurement fault. `blur()` alone commits, because
 * `EditableText` saves on blur. So the field is asked to leave rather than
 * persuaded to, and the wait is on the editor actually being gone.
 */
const blurEditor = async (page: Page) => {
  await page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur(),
  )
  /*
   * A POSITIVE check that the editor is gone, and a failure if it is not.
   *
   * Waiting-and-shrugging is what let four runs measure the author's view
   * while reading as measurements of the design. An assertion here cannot be
   * satisfied by the editor merely being slow, and a mid-edit measurement can
   * no longer be produced silently.
   */
  await expect(
    page.locator('[data-testid="slide"] textarea, [data-testid="slide"] input'),
    'the editor is still open, so anything measured now describes the ' +
      "author's view rather than the design",
  ).toHaveCount(0, { timeout: 10_000 })
}

/**
 * What each box actually DRAWS, checked against what was typed into it.
 *
 * The check that replaces "the fill call returned without throwing". That was
 * never evidence: it reported a box as filled whenever the helper completed,
 * and a box that silently kept its old value looked identical to one that had
 * taken the new. It certified `formula.eq` as filled while the box drew "Add
 * a formula", and it certified boxes that were holding the PREVIOUS layout's
 * text.
 *
 * Read after the editor has gone, not immediately after typing. An assertion
 * made straight after the fill matches a transient — measured: a scoped
 * `toContainText` on a box's own node passed while that node held zero
 * characters, because the value reverted a moment later.
 */
const drawnMismatches = async (
  page: Page,
  where: string,
  expected: Map<string, string>,
): Promise<string[]> => {
  const drawn = await page.evaluate(() => {
    const slide = document.querySelector('[data-testid="slide"]')
    const out: Record<string, string> = {}
    for (const node of slide?.querySelectorAll('[data-node-id]') ?? []) {
      if (node.querySelector('[data-node-id]')) continue
      const clone = node.cloneNode(true) as HTMLElement
      clone
        .querySelectorAll('[aria-hidden="true"], .slot-blank')
        .forEach(f => f.remove())
      out[node.getAttribute('data-node-id')!] = (clone.textContent ?? '').trim()
    }
    return out
  })
  const faults: string[] = []
  for (const [slot, typed] of expected) {
    const shown = drawn[slot] ?? ''
    // Compared on a distinctive head rather than the whole string: the
    // renderer may transform (caps) or wrap, but it does not change the words.
    const head = typed.slice(0, 24).trim()
    if (!shown.includes(head))
      faults.push(
        `${where} "${slot}" does not draw what was typed into it — ` +
          `expected to contain ${JSON.stringify(head)}, box draws ` +
          `${JSON.stringify(shown.slice(0, 60))} (${shown.length} chars). ` +
          `Nothing measured about this box means anything.`,
      )
  }
  return faults
}

/** Signs a fresh account in and opens one lecture on the given design. */
const openOn = async (page: Page, template: TemplateFile, tag: string) => {
  const email = `limits-${template.id}-${tag}-${stamp}@example.com`
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Limits')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()

  await createProject(page, 'Limits')
  await page
    .getByRole('button', { name: 'Start a new lecture in Limits' })
    .click()
  await page.getByRole('button', { name: 'Start lecture' }).click()
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  await page.getByRole('tab', { name: 'Design' }).click()
  const pick = new RegExp(
    `^${template.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
    'i',
  )
  await page.getByRole('radio', { name: pick }).click()
  await expect(page.getByRole('radio', { name: pick })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await page.getByRole('button', { name: 'Close settings' }).click()

  // One slide to work on. Its content is replaced per layout below; this
  // only has to bring a slide into existence.
  await page.getByLabel('Spoken phrase').fill('Opening')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByText('1 / 1')).toBeVisible({ timeout: 15_000 })
}

/** Switches the single slide to a named layout and waits for it to settle. */
const switchTo = async (page: Page, layout: LayoutSpec) => {
  // Dismiss anything still open before reaching for the menu. Safe here and
  // only here: the walk commits its edits with `blurEditor` before switching,
  // so there is no edit in progress for Escape to cancel — which is exactly
  // the mistake that discarded three runs' worth of content when this was
  // done at measurement time instead.
  await page.keyboard.press('Escape')
  await page
    .getByRole('button', { name: 'Options for slide 1' })
    .click({ timeout: 20_000 })
  await page.getByRole('menuitem', { name: 'Change layout' }).click()
  const dialog = page.getByRole('dialog', { name: 'Change slide layout' })
  await expect(dialog).toBeVisible()
  const radios = dialog.getByRole('radio')
  const labels = (await radios.allInnerTexts()).map(t =>
    (t.split('\n')[0] ?? '').trim(),
  )
  const which = labels.indexOf(layout.label)
  expect(which, `no layout offered called "${layout.label}"`).toBeGreaterThan(
    -1,
  )
  await radios.nth(which).click()
  const slide = page.getByTestId('slide').first()
  await expect(slide).toHaveAttribute('data-layout', layout.type)
  // The toast offering to undo the boxes the switch filled sits over the
  // slide; let it go before measuring anything under it.
  await page
    .getByText(/Filled the boxes this layout added/)
    .waitFor({ state: 'hidden', timeout: 15_000 })
    .catch(() => {})
  await settled(page)
  return slide
}

/** Layouts worth loading — the whiteboard holds no slots to fill. */
const loadable = (template: TemplateFile) =>
  template.layouts.filter(
    layout => layout.type !== 'whiteboard' && (layout.slots ?? []).length > 0,
  )

/**
 * How long one design's walk is allowed.
 *
 * A budget, not a threshold: each test switches layout sixteen-odd times,
 * fills every box on each, and uploads a picture per picture slot, so it does
 * two orders of magnitude more work than the specs the 30-second default was
 * chosen for. Left at the default it died mid-walk and reported the page as
 * closed, which reads like a crash and is only a clock.
 */
const WALK_TIMEOUT = 300_000

for (const template of TEMPLATES) {
  test(`${template.id} holds every layout filled to its stated budget`, async ({
    page,
  }) => {
    test.setTimeout(WALK_TIMEOUT)
    const layouts = loadable(template)
    // The suite is generated from the template files, so a design that
    // failed to load contributes no test at all. This one at least fails
    // rather than passing over an empty walk.
    expect(
      layouts.length,
      `${template.id} declares no fillable layouts`,
    ).toBeGreaterThan(0)

    await openOn(page, template, 'max')
    const faults: string[] = []
    /** Boxes no content reached, collected across the whole walk. */
    const unfilled: string[] = []

    for (const layout of layouts) {
      const slide = await switchTo(page, layout)
      const slots = layout.slots ?? []

      let pictures = 0
      /*
       * Which boxes were actually given something, checked below.
       *
       * The hole this closes is the one that would make this whole suite
       * worthless as a gate. `writeInto` returns false when it cannot find
       * the box — a renamed label, a slot the editor does not offer — and an
       * UNFILLED box cannot shrink and cannot clip. So a spec that quietly
       * failed to fill anything would report a clean walk, and a clean walk
       * is exactly what this is being read as evidence of.
       *
       * Ask what this value would look like if the filling had never
       * happened: identical. So it is counted and asserted rather than
       * assumed.
       */
      const filled: string[] = []
      const skipped: string[] = []
      /** What each box was given, checked against what it draws. */
      const typedInto = new Map<string, string>()
      const budgets = budgetsFor(template, layout)
      for (const slot of slots) {
        if (slot.kind === 'image') {
          const ok = await addImage(page, 0, `pic-${pictures++}.png`)
          ;(ok ? filled : skipped).push(`${slot.name}[image]`)
        } else if (slot.kind === 'bullets') {
          // Every point at its own character limit, and as many points as
          // the design says the box takes.
          const items = Array.from(
            { length: budgets[slot.name]?.maxItems ?? slot.maxItems ?? 3 },
            (_, i) =>
              fill(
                budgets[slot.name]?.maxChars ?? slot.maxChars ?? 40,
                `${layout.type}-${slot.name}-${i}`,
              ),
          )
          const text = items.join('\n')
          typedInto.set(slot.name, text)
          const ok = await writeInto(page, slot, text)
          ;(ok ? filled : skipped).push(`${slot.name}[bullets]`)
        } else if (slot.kind === 'code') {
          const text = 'def gauge(q):\n    return q * 2\n'
          typedInto.set(slot.name, text)
          const ok = await writeInto(page, slot, text)
          ;(ok ? filled : skipped).push(`${slot.name}[code]`)
        } else if (slot.kind === 'math') {
          typedInto.set(slot.name, 'E = mc^2')
          const ok = await writeInto(page, slot, 'E = mc^2')
          ;(ok ? filled : skipped).push(`${slot.name}[math]`)
        } else if (budgets[slot.name]?.maxChars ?? slot.maxChars) {
          const text = fill(
            budgets[slot.name]?.maxChars ?? slot.maxChars ?? 40,
            `${layout.type}-${slot.name}`,
          )
          typedInto.set(slot.name, text)
          const ok = await writeInto(page, slot, text)
          ;(ok ? filled : skipped).push(`${slot.name}[text]`)
        } else {
          // A text box the design states no budget for cannot be filled "to
          // its budget", so it is named rather than silently passed over.
          skipped.push(`${slot.name}[${slot.kind}: no declared budget]`)
        }
      }

      /*
       * Recorded, not asserted here.
       *
       * Asserting inside the loop throws on the first layout with an
       * unfillable box and abandons every layout after it — which on one run
       * stopped the walk at `image-full` and reported zero shrink faults for
       * a design whose remaining layouts had never been looked at. A
       * truncated walk reporting no faults is the same false clean this whole
       * suite exists to prevent, produced by the check meant to prevent it.
       *
       * So it accumulates and is asserted once, after every layout has been
       * measured, alongside the geometry faults.
       */
      unfilled.push(
        ...imageFailures
          .splice(0)
          .map(
            f => `${template.id} ${layout.type}: image upload failed — ${f}`,
          ),
        ...skipped.map(
          box =>
            `${template.id} ${layout.type}: "${box}" was never filled, so ` +
            `nothing about it was tested — an empty box neither clips nor ` +
            `shrinks. Filled here: ${filled.join(', ') || '(none)'}`,
        ),
      )

      /*
       * Leave the editor before measuring anything.
       *
       * This is not tidiness — it is the difference between measuring the
       * design and measuring the editor. A box still being edited holds an
       * open `<textarea>` AND the slot's hint ("Why the figure matters… · up
       * to 141"), and neither is content, neither scales with `--fit-scale`,
       * and both are inside the node. Measured that way `big-number.body`
       * reported 210 characters, scale 0.40 and 44px hidden; blurred, the
       * same box on the same commit reports 141 characters, scale 1.00 and
       * nothing hidden.
       *
       * Every shrink fault this suite reported was that. The design was
       * fine; the instrument was photographing its own editor.
       */
      await blurEditor(page)
      await settled(page)
      const where = `${template.id} ${layout.type} at its budget`
      // Before any geometry is read: does each box DRAW what it was given? A
      // measurement of a box holding another layout's content is not a
      // measurement of this design.
      unfilled.push(...(await drawnMismatches(page, where, typedInto)))
      // Geometry first — the faults a reader would see as broken.
      faults.push(...(await faultsOn(slide, where)))
      // Then the fault a reader sees as merely small, which no geometry
      // check can reach. This is the one that catches a wrong leading.
      faults.push(...(await shrunkOn(slide, where)))
      // Then the few pixels at the bottom of a line that the generic clip
      // check deliberately ignores as noise.
      faults.push(...(await descenderFaultsOn(slide, where)))
    }

    /*
     * ONE assertion carrying both, and that is not tidiness.
     *
     * Written as two `expect`s the first one to fail throws and the second
     * never runs — so a single unfilled box suppressed the entire fault list
     * for the whole design, and the run reported "no shrink faults" while a
     * box sat at the 0.4 floor with 44px hidden. Two checks where the first
     * hides the second is the same truncation as a loop that aborts early,
     * one level up.
     *
     * Coverage is listed first WITHIN the message, because a fault list means
     * nothing until it is known every box was actually given content — but
     * both are always shown.
     */
    /*
     * Hard on the design under change; baselined on every other.
     *
     * The walk covers all five built-ins on purpose — a design that clips
     * clips whoever wrote it — but a branch adding one design cannot be held
     * to faults the other four already had. Those are listed in
     * `known-faults.ts`, each measured against the base rather than assumed,
     * and anything NOT on that list fails here.
     *
     * The list may shrink and may never silently grow. A design with no
     * entries is held to zero faults, which is the case for the design any
     * given branch is actually about.
     */
    const newFaults = unknownFaults(template.id, faults)
    const tolerated = faults.length - newFaults.length
    const problems = [
      ...unfilled.map(line => `NOT FILLED  ${line}`),
      ...newFaults.map(line => `FAULT       ${line}`),
    ]
    expect(
      problems,
      `${problems.join('\n')}\n\n(${tolerated} pre-existing fault(s) ` +
        `tolerated for ${template.id} — see known-faults.ts; ` +
        `${KNOWN_FAULTS.filter(k => k.design === template.id).length} listed)`,
    ).toEqual([])
  })

  test(`${template.id} holds every layout with its optional boxes empty`, async ({
    page,
  }) => {
    test.setTimeout(WALK_TIMEOUT)
    const layouts = loadable(template)
    expect(
      layouts.length,
      `${template.id} declares no fillable layouts`,
    ).toBeGreaterThan(0)

    await openOn(page, template, 'min')
    const faults: string[] = []

    for (const layout of layouts) {
      const slide = await switchTo(page, layout)
      const slots = layout.slots ?? []
      // Only the title, and only three short words of it — a box sized for
      // two lines given less than one. Everything else is left as the layout
      // switch left it, which for a box the previous layout had nothing to
      // put in is empty.
      const title = slots.find(slot => slot.name === 'title')
      // Trimmed to the box's own budget. Three words is the intent — a box
      // sized for two lines given less than one — but "three words" is not a
      // length, and a display box budgeted for eight characters given
      // seventeen is over its limit, which is the OTHER test. Sending it here
      // reported a clip on the floor load that was really the floor load
      // overfilling.
      if (title)
        await writeInto(
          page,
          title,
          'Gravy jetty ridge'.slice(
            0,
            budgetsFor(template, layout)[title.name]?.maxChars ??
              title.maxChars ??
              17,
          ),
        )

      // Same reason as the limit walk above: measure the design, not the
      // editor that was just used to fill it.
      await blurEditor(page)
      await settled(page)
      const where = `${template.id} ${layout.type} with optional boxes empty`
      faults.push(...(await faultsOn(slide, where)))
      // The floor's own fault: a box that kept its space and shows nothing
      // in it. An empty slot is supposed to take no room at all.
      faults.push(...(await holesOn(slide, where)))
    }

    expect(faults, faults.join('\n')).toEqual([])
  })
}
