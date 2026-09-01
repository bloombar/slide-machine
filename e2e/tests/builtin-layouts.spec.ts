/**
 * The built-in layouts, measured in a real browser.
 *
 * Every conventional layout used to be a React component; they are data now,
 * and this checks the geometry that conversion had to preserve. A unit test
 * (client/src/components/slide/layouts/migration.test.tsx) pins the CSS each
 * tree emits, but jsdom lays nothing out — only a browser can say where a box
 * actually ended up.
 *
 * The numbers below come from the components that were replaced: `px-[6cqi]`
 * is a 6% side margin, `grid-cols-2` splits the slide in half, `h-3/4` makes
 * the picture three quarters as tall as its row. If a tree drifts, one of
 * these moves.
 */
import { test, expect, type Locator, type Page } from './fixtures'
import { chooseAccountDesign, createProject } from './helpers'

const stamp = Date.now()
const user = { email: `blayout-${stamp}@example.com`, name: 'Layouts' }
const password = 'sturdy-passw0rd'

/**
 * A box's place on the slide, as a fraction — the unit the whole layout model
 * is written in.
 *
 * Measured by tree node id rather than by slot: a slot's wrapper hugs its
 * text, while the node is the box the design actually reserves, and those are
 * different rectangles. The flattener makes the same distinction.
 */
const fractionOf = async (
  slide: Locator,
  node: string,
): Promise<{ x: number; y: number; w: number; h: number }> => {
  const frame = await slide.boundingBox()
  const box = await slide.locator(`[data-node-id="${node}"]`).boundingBox()
  if (!frame || !box) throw new Error(`no box for node "${node}"`)
  return {
    x: (box.x - frame.x) / frame.width,
    y: (box.y - frame.y) / frame.height,
    w: box.width / frame.width,
    h: box.height / frame.height,
  }
}

/** Switches the first slide to a layout and hands back its rendered frame. */
const showLayout = async (
  page: Page,
  layout: string,
  pick: RegExp,
): Promise<Locator> => {
  await page.getByRole('button', { name: 'Options for slide 1' }).click()
  await page.getByRole('menuitem', { name: 'Change layout' }).click()
  const dialog = page.getByRole('dialog', { name: 'Change slide layout' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('radio', { name: pick }).click()
  const slide = page.getByTestId('slide').first()
  await expect(slide).toHaveAttribute('data-layout', layout)
  return slide
}

test('the built-in layouts keep the geometry their components had', async ({
  page,
}) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill(user.name)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)
  // This spec is written against Classic — its box names and its geometry —
  // so it says so rather than riding on whatever the deployment defaults to
  // (TMPL-24).
  await chooseAccountDesign(page, /classic/i)

  await createProject(page, `Layouts${stamp}`)
  await page
    .getByRole('button', { name: `Start a new lecture in Layouts${stamp}` })
    .click()
  await expect(page).toHaveURL(/\/d\/untitled-/)
  await page.getByRole('button', { name: 'Start lecture' }).click()

  // A lecture starts empty, so speak one slide into being: a box has no size
  // until there is something in it.
  await page.getByLabel('Spoken phrase').fill('Photosynthesis basics')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toHaveAttribute(
    'data-layout',
    'title',
  )

  await test.step('content: 6% side margins, stacked down the middle', async () => {
    const frame = await showLayout(page, 'content', /^Content/)
    const title = await fractionOf(frame, 'title')
    // px-[6cqi] — a percent of the slide's WIDTH, so 0.06 either side.
    expect(title.x).toBeCloseTo(0.06, 2)
    expect(title.w).toBeCloseTo(0.88, 2)
    const body = await fractionOf(frame, 'body')
    expect(body.x).toBeCloseTo(0.06, 2)
    // justify-center: the pair sits about the middle, not against the top.
    expect(title.y).toBeGreaterThan(0.1)
  })

  await test.step('two-column: the image takes the right half', async () => {
    const frame = await showLayout(page, 'two-column', /^Two column/)
    const image = await fractionOf(frame, 'image')
    // grid-cols-2 inside px-[6cqi], gap-[4cqi]: the right track starts past
    // the middle of the slide.
    expect(image.x).toBeGreaterThan(0.5)
    expect(image.x + image.w).toBeCloseTo(0.94, 2)
    // h-3/4 of a row that fills the slide's height inside the margins.
    expect(image.h).toBeGreaterThan(0.6)
    expect(image.h).toBeLessThan(0.85)
  })

  await test.step('title: centred on both axes', async () => {
    const frame = await showLayout(page, 'title', /^Title/)
    const title = await fractionOf(frame, 'title')
    const centre = title.x + title.w / 2
    expect(centre).toBeCloseTo(0.5, 1)
    expect(title.y + title.h / 2).toBeCloseTo(0.5, 1)
  })

  await test.step('image-heavy: the picture takes the room the caption does not', async () => {
    const frame = await showLayout(page, 'image-heavy', /^Image/)
    const image = await fractionOf(frame, 'image')
    // The template's own margin now, not the component's tighter `p-[4cqi]`:
    // one margin for every layout beats a picture 2% wider (TMPL-4).
    expect(image.x).toBeCloseTo(0.06, 2)
    expect(image.h).toBeGreaterThan(0.7)
  })

  await test.step('quote: wider margins than a content slide', async () => {
    const frame = await showLayout(page, 'quote', /^Quote/)
    const body = await fractionOf(frame, 'body')
    // px-[8cqi], and the quotation marks are printed around the body.
    expect(body.x).toBeGreaterThanOrEqual(0.08)
    await expect(frame).toContainText('“')
  })

  await test.step('every layout keeps its contents inside the template’s margin', async () => {
    // The reason the margin moved out of the layouts and into the template:
    // one safe area, honoured by all of them. Measured rather than asserted
    // per layout, because the interesting failure is the layout nobody
    // thought to check.
    const MARGIN_X = 0.06
    // A fraction of the height, which is what the editor's dashed guide is
    // drawn from; the renderer converts it through the 16:9 aspect.
    const MARGIN_Y = 0.06
    // A hair of tolerance: text is measured to the pixel, and a glyph's box
    // is not its ink.
    const SLACK = 0.005

    for (const [type, pick] of [
      ['content', /^Content/],
      ['list', /^Bullet list/],
      ['title', /^Title/],
      ['section', /^Section/],
      ['two-column', /^Two column/],
      ['image-heavy', /^Image/],
      ['quote', /^Quote/],
      ['code', /^Code/],
      ['formula', /^Formula/],
    ] as const) {
      const frame = await showLayout(page, type, pick)
      const nodes = await frame.locator('[data-node-id]').all()
      for (const node of nodes) {
        const id = await node.getAttribute('data-node-id')
        if (id === 'root') continue // the root IS the slide; its padding is the margin
        const r = await fractionOf(frame, id!)
        expect(
          r.x,
          `${type}/${id} crosses the left margin`,
        ).toBeGreaterThanOrEqual(MARGIN_X - SLACK)
        expect(
          r.x + r.w,
          `${type}/${id} crosses the right margin`,
        ).toBeLessThanOrEqual(1 - MARGIN_X + SLACK)
        expect(
          r.y,
          `${type}/${id} crosses the top margin`,
        ).toBeGreaterThanOrEqual(MARGIN_Y - SLACK)
        expect(
          r.y + r.h,
          `${type}/${id} crosses the bottom margin`,
        ).toBeLessThanOrEqual(1 - MARGIN_Y + SLACK)
      }
    }
  })
})
