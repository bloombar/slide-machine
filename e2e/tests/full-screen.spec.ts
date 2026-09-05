/**
 * Full-screen slide viewing (PLAY-5): "f" scales the current slide to the
 * actual largest 16:9 box that fits the viewport — nothing subtracted from
 * either axis for SlideNavZones' chevrons, which draw inside the slide's
 * edge in full screen instead (see SlideNavZones' `inset` prop) — centred
 * both ways, with the deck toolbar and the live-session chrome still
 * reachable over it — none of which jsdom can lay out, so this runs against
 * the project's own built app (playwright.config), not a hand-rolled
 * server.
 */
import { test, expect, type Page } from './fixtures'
import { createProject } from './helpers'

/** The stage's expected box for a given viewport: the largest 16:9 area
 * that fits inside it, nothing reserved for the chevrons (they draw inside
 * the slide's edge — see SlideNavZones' `inset` prop and
 * FullScreenStage's own STAGE_WIDTH_RULE). */
const expectedStageBox = (viewport: { width: number; height: number }) => {
  const width = Math.min(viewport.width, (viewport.height * 16) / 9)
  const height = (width * 9) / 16
  return {
    width,
    height,
    left: (viewport.width - width) / 2,
    top: (viewport.height - height) / 2,
  }
}

/** Registers a fresh user, creates a project and a lecture, dictates one
 * slide, then adds a second (deterministic — a mock generation provider can
 * fold a short phrase into the current slide rather than always spawning a
 * new one) and returns to the first, so a `hasNext` chevron always exists.
 * Leaves the live-session bar open. */
const buildTwoSlideDeck = async (page: Page, tag: string) => {
  const project = `FullScreenProj-${tag}-${Date.now()}`
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Full Screen Tester')
  await page
    .getByLabel('Email')
    .fill(`fullscreen-${tag}-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()
  await createProject(page, project)
  await page
    .getByRole('button', { name: `Start a new lecture in ${project}` })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Start lecture' }).click()

  await page
    .getByLabel('Spoken phrase')
    .fill('Watermelons are warm season fruits')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toBeVisible()

  await page.getByRole('button', { name: 'Add slide' }).click()
  await expect(page.getByText('2 / 2')).toBeVisible()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByText('1 / 2')).toBeVisible()
}

test('"f" fills the viewport with the current slide, toolbar still reachable, Escape returns', async ({
  page,
}) => {
  const project = `FullScreenProj-${Date.now()}`
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Full Screen Tester')
  await page.getByLabel('Email').fill(`fullscreen-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()
  await createProject(page, project)
  await page
    .getByRole('button', { name: `Start a new lecture in ${project}` })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Start lecture' }).click()

  await page
    .getByLabel('Spoken phrase')
    .fill('Watermelons are warm season fruits')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toBeVisible()

  // Close the live-session bar so "f" isn't swallowed by the phrase field —
  // the button it closes with keeps focus afterwards, which is not a
  // typing target, so the shortcut reaches the page from here. (The
  // lecture title is a click-to-edit field — EditableText — so clicking it
  // to "move focus away" would land inside a text field instead.)
  await page.getByRole('button', { name: 'Live session' }).click()

  // The maximize icon sits at the top right of the deck's own content,
  // above the first slide (PLAY-5) — the other way in, and the one the eye
  // finds. It enters full screen, and steps aside once it has.
  const enter = page.getByRole('button', { name: 'Full screen' })
  const enterBox = (await enter.boundingBox())!
  const slideBox = (await page.getByTestId('slide').boundingBox())!
  expect(enterBox.y + enterBox.height).toBeLessThanOrEqual(slideBox.y)
  expect(enterBox.x).toBeGreaterThan(slideBox.x + slideBox.width / 2)
  await enter.click()
  await expect(
    page.getByRole('button', { name: 'Exit full screen' }),
  ).toBeVisible()
  // The close control must be clickable, not parked under the slide's own
  // kebab menu — Playwright's actionability check is what proves it.
  await page.getByRole('button', { name: 'Exit full screen' }).click()
  await expect(enter).toBeVisible()

  await page.keyboard.press('f')

  await expect(
    page.getByRole('button', { name: 'Exit full screen' }),
  ).toBeVisible()

  const viewport = page.viewportSize()!
  const box = (await page.getByTestId('slide').boundingBox())!
  const expected = expectedStageBox(viewport)

  expect(Math.abs(box.width - expected.width)).toBeLessThanOrEqual(2)
  expect(Math.abs(box.height - expected.height)).toBeLessThanOrEqual(2)
  // Centred both ways
  expect(Math.abs(box.x - expected.left)).toBeLessThanOrEqual(2)
  expect(Math.abs(box.y - expected.top)).toBeLessThanOrEqual(2)
  // The suite's default viewport is exactly 16:9 (1280x720) — the axis
  // that "fills exactly" (SPEC PLAY-5) here is width, so the stage must
  // equal the full viewport width with nothing subtracted from it. A
  // gutter reserved for the chevrons (round 1 of this slice, reverted in
  // round 2) would have shown up here as a shortfall of its own width.
  if (Math.abs(viewport.width / viewport.height - 16 / 9) < 0.01) {
    expect(Math.abs(box.width - viewport.width)).toBeLessThanOrEqual(2)
  }

  // The deck toolbar sits over the full-screen overlay, not behind it —
  // Playwright's actionability check (visible, not obscured) is the proof:
  // a click that lands on a covered element times out instead of firing.
  // Full screen shows exactly one slide either way (it is still the
  // carousel), so the slide counter chip — not the slide count — is what
  // proves the click actually landed and added one.
  await expect(page.getByText('1 / 1')).toBeVisible()
  await page.getByRole('button', { name: 'Add slide' }).click()
  await expect(page.getByText('2 / 2')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('button', { name: 'Exit full screen' }),
  ).toHaveCount(0)
  // The regular in-flow carousel is back: its own counter line is in
  // document flow again rather than floated over a stage.
  await expect(page.getByTestId('slide')).toBeVisible()
})

/**
 * Regression: the maximize icon sits in the deck toolbar pill's own header
 * band (DeckPageHeader's `trailing` slot), not in its own flow row below
 * it — the vertical centres of the icon and the pill must line up.
 * Neither `sticky` nor an absolutely-positioned sibling lays out in jsdom,
 * so this is a real-box measurement (boundingBox), same as the rest of the
 * suite.
 */
test('the maximize icon aligns with the deck toolbar pill (PLAY-5)', async ({
  page,
}) => {
  const project = `FullScreenProj-align-${Date.now()}`
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Full Screen Tester')
  await page
    .getByLabel('Email')
    .fill(`fullscreen-align-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()
  await createProject(page, project)
  await page
    .getByRole('button', { name: `Start a new lecture in ${project}` })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Start lecture' }).click()

  await page
    .getByLabel('Spoken phrase')
    .fill('Watermelons are warm season fruits')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toBeVisible()

  const pillBox = (await page.getByTestId('deck-toolbar').boundingBox())!
  const enterBox = (await page
    .getByRole('button', { name: 'Full screen' })
    .boundingBox())!

  // Same horizontal band as the pill: vertical centres within a couple of
  // px, not the pill's height-plus-margin below it, where the in-flow row
  // this replaces used to put it.
  const pillCenter = pillBox.y + pillBox.height / 2
  const enterCenter = enterBox.y + enterBox.height / 2
  expect(Math.abs(pillCenter - enterCenter)).toBeLessThanOrEqual(2)
  // To the right of the pill, not overlapping or to its left.
  expect(enterBox.x).toBeGreaterThan(pillBox.x + pillBox.width)
})

/**
 * Regression: the close control is anchored to the overlay (the full
 * viewport), not the stage, so on any viewport wider than 16:9 it lands in
 * the letterbox surround rather than over the slide's own content — a
 * discreet corner control, not a white square superimposed on the design.
 * The suite's default viewport (1280x720) is exactly 16:9, where the stage
 * fills the viewport and this can't be told apart from "anchored to the
 * stage" — a wider viewport is required to tell the two apart.
 */
test('the close control sits in the letterbox, off the slide, on a wider-than-16:9 viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 720 })
  const project = `FullScreenProj-wide-${Date.now()}`
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Full Screen Tester')
  await page
    .getByLabel('Email')
    .fill(`fullscreen-wide-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()
  await createProject(page, project)
  await page
    .getByRole('button', { name: `Start a new lecture in ${project}` })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Start lecture' }).click()

  await page
    .getByLabel('Spoken phrase')
    .fill('Watermelons are warm season fruits')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toBeVisible()
  await page.getByRole('button', { name: 'Live session' }).click()

  await page.keyboard.press('f')
  const exit = page.getByRole('button', { name: 'Exit full screen' })
  await expect(exit).toBeVisible()

  const exitBox = (await exit.boundingBox())!
  const slideBox = (await page.getByTestId('slide').boundingBox())!
  // No overlap on either axis: the control's box is entirely to the right
  // of, or entirely above, the slide's box.
  const noOverlap =
    exitBox.x >= slideBox.x + slideBox.width ||
    exitBox.y + exitBox.height <= slideBox.y
  expect(noOverlap).toBe(true)
  // Still clickable — same proof the default-viewport test uses. Guarded
  // with toHaveCount(0) first: `getByRole('button', { name: 'Full screen' })`
  // matches "Exit full screen" too (Playwright's accessible-name match is a
  // substring one), so without the count check this passed whether or not
  // the overlay actually closed.
  await exit.click()
  await expect(
    page.getByRole('button', { name: 'Exit full screen' }),
  ).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Full screen' })).toBeVisible()
})

/**
 * Regression (PLAY-5 round 5): the corner/parked step used to be keyed to
 * aspect ratio (a `min-aspect-ratio: 2/1` media query), not to the actual
 * pixel width of the letterbox bar the control has to fit in — and those
 * two disagree at ordinary window sizes. 1400x720 has ratio 1.94, below
 * any 2/1-ish threshold, but a 60px side bar — comfortably more than the
 * 44px (0.75rem inset + 2rem button) the control needs — so a ratio rule
 * left it parked ON the slide here even though the screen plainly was
 * "large enough" (the user's own phrasing for this feature). This test
 * fails against the ratio-keyed version (round 4, `6d1399b3`) and passes
 * once the corner/parked step reads the bar width itself.
 */
test('the close control sits in the letterbox, off the slide, at 1400x720 — an ordinary window a ratio threshold would still call "parked"', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 720 })
  const project = `FullScreenProj-roomy-${Date.now()}`
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Full Screen Tester')
  await page
    .getByLabel('Email')
    .fill(`fullscreen-roomy-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()
  await createProject(page, project)
  await page
    .getByRole('button', { name: `Start a new lecture in ${project}` })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Start lecture' }).click()

  await page
    .getByLabel('Spoken phrase')
    .fill('Watermelons are warm season fruits')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toBeVisible()
  await page.getByRole('button', { name: 'Live session' }).click()

  await page.keyboard.press('f')
  const exit = page.getByRole('button', { name: 'Exit full screen' })
  await expect(exit).toBeVisible()

  const exitBox = (await exit.boundingBox())!
  const slideBox = (await page.getByTestId('slide').boundingBox())!
  // No overlap on either axis: the control's box is entirely to the right
  // of, or entirely above, the slide's box.
  const noOverlap =
    exitBox.x >= slideBox.x + slideBox.width ||
    exitBox.y + exitBox.height <= slideBox.y
  expect(noOverlap).toBe(true)
  // Still clickable — same proof the other placement tests use. Guarded
  // with toHaveCount(0) first: `getByRole('button', { name: 'Full screen' })`
  // matches "Exit full screen" too (a substring match), so without the
  // count check this passed whether or not the overlay actually closed.
  await exit.click()
  await expect(
    page.getByRole('button', { name: 'Exit full screen' }),
  ).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Full screen' })).toBeVisible()
})

/**
 * Regression (PLAY-5 round 4): the close control's inset used to be a
 * single formula that shrank as the side letterbox grew while the kebab's
 * own inset grew with it — the two are on opposite sides of each other, so
 * a viewport in between put them at the SAME x and had the close control,
 * painted above the kebab at z-40, swallow its clicks. ~1316x720 is where
 * the two used to land pixel-identical; this is the band the two-endpoint
 * suite (1280x720, 1600x720) never sampled. Actionability is the proof: a
 * click that lands on a covered element times out instead of opening the
 * menu.
 */
test('the slide kebab menu still opens in full screen at a width in the former collision band (PLAY-5)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1316, height: 720 })
  const project = `FullScreenProj-collision-${Date.now()}`
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Full Screen Tester')
  await page
    .getByLabel('Email')
    .fill(`fullscreen-collision-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()
  await createProject(page, project)
  await page
    .getByRole('button', { name: `Start a new lecture in ${project}` })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Start lecture' }).click()

  await page
    .getByLabel('Spoken phrase')
    .fill('Watermelons are warm season fruits')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toBeVisible()
  await page.getByRole('button', { name: 'Live session' }).click()

  await page.keyboard.press('f')
  await expect(
    page.getByRole('button', { name: 'Exit full screen' }),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Options for slide 1' }).click()
  await expect(
    page.getByRole('menuitem', { name: 'Duplicate slide' }),
  ).toBeVisible()
})

/**
 * Regression: the same "corner" placement as the wide-viewport test above,
 * for the OTHER letterbox axis — a viewport well short of 4:3, where the
 * top bar (not the side bars) is what clears the close control of the
 * slide. Same no-overlap proof, plus clickability.
 */
test('the close control sits in the letterbox, off the slide, on a taller-than-4:3 viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 900 })
  const project = `FullScreenProj-tall-${Date.now()}`
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Full Screen Tester')
  await page
    .getByLabel('Email')
    .fill(`fullscreen-tall-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()
  await createProject(page, project)
  await page
    .getByRole('button', { name: `Start a new lecture in ${project}` })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Start lecture' }).click()

  await page
    .getByLabel('Spoken phrase')
    .fill('Watermelons are warm season fruits')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toBeVisible()
  await page.getByRole('button', { name: 'Live session' }).click()

  await page.keyboard.press('f')
  const exit = page.getByRole('button', { name: 'Exit full screen' })
  await expect(exit).toBeVisible()

  const exitBox = (await exit.boundingBox())!
  const slideBox = (await page.getByTestId('slide').boundingBox())!
  const noOverlap =
    exitBox.x >= slideBox.x + slideBox.width ||
    exitBox.y + exitBox.height <= slideBox.y
  expect(noOverlap).toBe(true)
  // Still clickable. Guarded with toHaveCount(0) first:
  // `getByRole('button', { name: 'Full screen' })` matches "Exit full
  // screen" too (a substring match), so without the count check this
  // passed whether or not the overlay actually closed.
  await exit.click()
  await expect(
    page.getByRole('button', { name: 'Exit full screen' }),
  ).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Full screen' })).toBeVisible()
})

/**
 * Regression (PLAY-5 round 3): "f" and Cmd/Ctrl-Enter toggle full screen
 * from `window`, with no drag guard of their own — the deck pill's drag
 * threshold is what makes dragging vs. clicking safe, not anything in
 * `useFullScreenKeys`. Pressing "f" mid-drag used to flip `fullScreen`
 * underneath the gesture: the pill is rendered at `fullScreen ? fsPos :
 * pos`, so the moment the prop flips the pill jumps to the OTHER mode's
 * spot without releasing the pointer, while the still-running drag keeps
 * writing to the mode it actually started in — landing a position
 * measured against now-stale geometry there. `dragGuard.ts` blocks the
 * shortcuts for a drag's duration; this proves both halves: full screen
 * does not toggle mid-drag, and the toolbar still lands sensibly (at the
 * spot released to) rather than skipping the shortcut but leaving the
 * pill's own tracking broken.
 */
test('pressing "f" mid-drag does not toggle full screen or corrupt the drop spot (PLAY-5)', async ({
  page,
}) => {
  const project = `FullScreenProj-middrag-${Date.now()}`
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Full Screen Tester')
  await page
    .getByLabel('Email')
    .fill(`fullscreen-middrag-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()
  await createProject(page, project)
  await page
    .getByRole('button', { name: `Start a new lecture in ${project}` })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Start lecture' }).click()
  await page
    .getByLabel('Spoken phrase')
    .fill('Watermelons are warm season fruits')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toBeVisible()
  // Closes the live-session bar so "f" isn't swallowed by the phrase field.
  await page.getByRole('button', { name: 'Live session' }).click()

  const grip = page.getByRole('button', { name: 'Drag to move the toolbar' })
  const start = (await grip.boundingBox())!

  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  // Past the drag threshold — a real drag is now in progress.
  await page.mouse.move(300, 300, { steps: 10 })
  await page.keyboard.press('f')
  await page.mouse.move(500, 500, { steps: 10 })
  await page.mouse.up()

  // Full screen never toggled — the shortcut was ignored for the drag's
  // duration, not merely delayed.
  await expect(
    page.getByRole('button', { name: 'Exit full screen' }),
  ).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Full screen' })).toBeVisible()

  // The pill tracked the pointer the whole time and landed near where it
  // was released, not at the full-screen default (fixed top-16 start-2,
  // i.e. pinned to the window's top-left) that a mid-drag jump would have
  // produced.
  const dropped = (await page.getByTestId('deck-toolbar').boundingBox())!
  expect(dropped.y).toBeGreaterThan(200)

  // The shortcut works normally again once the drag is over.
  await page.keyboard.press('f')
  await expect(
    page.getByRole('button', { name: 'Exit full screen' }),
  ).toBeVisible()
})

/**
 * Regression: SlideNavZones normally draws its chevrons OUTSIDE the slide's
 * own edge (`right-full`/`left-full`, each `w-14` — 56px), which document
 * flow has room for beside the in-flow carousel but this overlay (a
 * non-scrolling `fixed inset-0`) does not on a 16:9-or-narrower viewport,
 * where a full-width stage would push them past x=0 / x=100vw entirely.
 * Full screen passes SlideNavZones' `inset` prop instead, drawing them just
 * inside the slide's edge there; prove it holds at the suite's default
 * (exactly 16:9) viewport and at one deliberately narrower than 16:9 — both
 * leave no room outside the stage at all, which is exactly the case an
 * earlier version of this fix (widening the stage's own letterbox instead)
 * got wrong (docs/DECISIONS.md).
 */
for (const viewport of [null, { width: 900, height: 900 }] as const) {
  const label = viewport
    ? `a ${viewport.width}x${viewport.height} viewport`
    : 'the default viewport'
  test(`prev/next chevrons stay on screen and clickable in full screen, on ${label}`, async ({
    page,
  }) => {
    if (viewport) await page.setViewportSize(viewport)
    await buildTwoSlideDeck(page, `chevron-${viewport ? 'narrow' : 'default'}`)

    await page.getByRole('button', { name: 'Live session' }).click()
    await page.keyboard.press('f')
    await expect(
      page.getByRole('button', { name: 'Exit full screen' }),
    ).toBeVisible()

    const actualViewport = page.viewportSize()!
    // Reveal the "Next slide" chevron the way a cursor would (it is
    // pointer-events-none until the cursor sits over that half of the
    // slide — see core-loop.spec.ts's own revealAndClick).
    const slideBox = (await page.getByTestId('slide').boundingBox())!
    await page.mouse.move(
      slideBox.x + slideBox.width * 0.8,
      slideBox.y + slideBox.height / 2,
    )
    const next = page.getByRole('button', { name: 'Next slide' })
    const nextBox = (await next.boundingBox())!
    expect(nextBox.x).toBeGreaterThanOrEqual(0)
    expect(nextBox.x + nextBox.width).toBeLessThanOrEqual(actualViewport.width)

    // Reachable is the real proof — a click on an off-screen element (or one
    // "scrolled" into place by an ineffective scrollIntoView, since this
    // overlay never scrolls) times out instead of firing.
    await next.click()
    await expect(page.getByText('2 / 2')).toBeVisible()

    // "Previous slide" the same way, back on the other side
    await page.mouse.move(
      slideBox.x + slideBox.width * 0.2,
      slideBox.y + slideBox.height / 2,
    )
    const prev = page.getByRole('button', { name: 'Previous slide' })
    const prevBox = (await prev.boundingBox())!
    expect(prevBox.x).toBeGreaterThanOrEqual(0)
    expect(prevBox.x + prevBox.width).toBeLessThanOrEqual(actualViewport.width)
    await prev.click()
    await expect(page.getByText('1 / 2')).toBeVisible()
  })
}

/**
 * Regression: the live-session caption (TranscriptSubtitle, CAP-3), a
 * generation error, and the simulated-speech form used to type phrases in
 * place of speaking are all normal in-flow content with no z-index — the
 * full-screen overlay (z-50) painted straight over them. A lecture stays
 * live full screen (SPEC PLAY-5), so all three have to stay usable.
 */
test('the live session stays usable in full screen: typing a phrase, the caption, and an error all stay reachable', async ({
  page,
}) => {
  const project = `FullScreenProj-live-${Date.now()}`
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Full Screen Tester')
  await page
    .getByLabel('Email')
    .fill(`fullscreen-live-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()
  await createProject(page, project)
  await page
    .getByRole('button', { name: `Start a new lecture in ${project}` })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Start lecture' }).click()

  // A first slide so the overlay actually has something to show (full
  // screen has no effect on the empty-deck placeholder) — the live-session
  // bar stays open throughout, exactly the state under test.
  await page
    .getByLabel('Spoken phrase')
    .fill('Watermelons are warm season fruits')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toBeVisible()

  // Speaking refocuses the phrase field for the next phrase, so "f" would
  // land there instead of toggling full screen — move focus to the plain
  // (non-editable) slide counter first, the way a reader actually would
  // after glancing back at the slide.
  await page.getByText('1 / 1').click()
  await page.keyboard.press('f')
  await expect(
    page.getByRole('button', { name: 'Exit full screen' }),
  ).toBeVisible()

  // The typed-phrase field and its Speak button must be visible and
  // clickable over the overlay — Playwright's actionability check is the
  // proof, same as the deck toolbar's own. A folded phrase (GEN-8) may
  // update slide 1 rather than add a slide, so the deck's own title
  // (server-picked from the transcript) is the assertion, not a count.
  const phraseField = page.getByRole('textbox', { name: 'Spoken phrase' })
  await expect(phraseField).toBeVisible()
  await phraseField.fill('a second phrase spoken full screen')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(
    page.getByTestId('slide').getByRole('heading', { name: /second phrase/i }),
  ).toBeVisible()

  // The CAP-3 caption line renders even with nothing to show (it reserves
  // its height, and is always mounted while speaking) — over the overlay,
  // not under it.
  await expect(page.getByTestId('live-transcript')).toBeVisible()

  // A generation failure's error line must be visible too — trigger one
  // by having the next call fail, rather than relying on network flake.
  await page.route('**/api/actions/session.phrase', route =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'generation failed' }),
    }),
  )
  await phraseField.fill('one more phrase that will fail')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
})
