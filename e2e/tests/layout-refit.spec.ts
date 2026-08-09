/**
 * Layout re-fit end to end (GENERATION_LAYOUT_REFIT on, mock provider):
 * a prose content slide that receives an enumerating continuation is
 * re-fitted to a list layout in place — same slide, migrated content —
 * per GEN-8 "re-fit the layout on update". The re-fit runs through the
 * animated layout transition (GEN-9); both the animated path and the
 * reduced-motion instant fallback must land on the same content-stable
 * result.
 */
import { test, expect, type Page } from './fixtures'
import { createProject } from './helpers'

const password = 'sturdy-passw0rd'

/**
 * Registers a fresh user, starts a lecture, and drives the two phrases
 * that grow a `content` slide into a `list` — asserting the re-fit happens
 * on the SAME slide with its content preserved across the transition.
 */
const refitContentToList = async (page: Page, email: string) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Refit Tester')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)
  await createProject(page, 'Biology 201')
  await page
    .getByRole('button', { name: 'Start a new lecture in Biology 201' })
    .click()
  await expect(page).toHaveURL(/\/d\/untitled-/)
  await page.getByRole('button', { name: 'Start lecture' }).click()

  // A prose phrase becomes a content slide
  await page
    .getByLabel('Spoken phrase')
    .fill('The cell membrane is a strong protective barrier')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toHaveAttribute(
    'data-layout',
    'content',
  )
  await expect(
    page
      .getByTestId('slide')
      .getByText('The cell membrane is a strong protective barrier'),
  ).toBeVisible()

  // An enumerating continuation refits the SAME slide to a list:
  // the body migrates into the bullets, no new slide appears
  await page
    .getByLabel('Spoken phrase')
    .fill('Also it contains cholesterol, embedded proteins, glycolipids')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toHaveAttribute('data-layout', 'list')
  // Assert the migration itself, not merely that the words are somewhere on
  // screen: the prose must now BE a bullet, alongside the new material. The
  // old assertion matched any element holding the text, which both missed a
  // body left standing next to the bullets and collided with the GEN-9
  // transition's fade-out clone (a copy of the departing body slot, parked in
  // document.body for the length of the animation).
  const bullets = page.getByTestId('slide').getByRole('listitem')
  await expect(
    bullets.filter({
      hasText: 'The cell membrane is a strong protective barrier',
    }),
  ).toHaveCount(1)
  await expect(bullets.filter({ hasText: 'glycolipids' })).toHaveCount(1)
  // The body slot is gone from the slide — the content moved rather than
  // being duplicated. Slot wrappers are tagged by the slot system, so this
  // names the slot directly instead of guessing at its rendered text.
  await expect(
    page.getByTestId('slide').locator('[data-flip-slot="body"]'),
  ).toHaveCount(0)
  // ...and the transition's fade-out clone, which is parked directly on
  // document.body, is cleaned up rather than left behind.
  await expect(page.locator('body > [data-flip-slot]')).toHaveCount(0)
  await expect(page.getByText('1 / 1')).toBeVisible()
}

test('an enumerating update refits the slide from content to list', async ({
  page,
}) => {
  // Default media: the browser supports view transitions, so the re-fit
  // animates (GEN-9). The end state is still the migrated list slide.
  await refitContentToList(page, `refit-${Date.now()}@example.com`)
})

test('the refit still applies content-stably under reduced motion', async ({
  page,
}) => {
  // Reduced motion takes the instant fallback in runLayoutFlip (no
  // animation), which must reach the exact same content-stable result.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await refitContentToList(page, `refit-rm-${Date.now()}@example.com`)
})

test('a refit never re-lays-out a header (title) slide; it spills to a new one', async ({
  page,
}) => {
  const email2 = `refit-header-${Date.now()}@example.com`
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Header Refit')
  await page.getByLabel('Email').fill(email2)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await createProject(page, 'Arithmetic')
  await page
    .getByRole('button', { name: 'Start a new lecture in Arithmetic' })
    .click()
  await expect(page).toHaveURL(/\/d\/untitled-/)
  await page.getByRole('button', { name: 'Start lecture' }).click()

  // A short opening phrase makes a title (header) slide.
  await page.getByLabel('Spoken phrase').fill('Fractions')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toHaveAttribute(
    'data-layout',
    'title',
  )

  // An enumerating continuation would refit an ordinary slide to a list. A
  // heading slide's layout is pinned, so the material opens a SECOND slide and
  // the title card the lecture opened with is left standing.
  await page
    .getByLabel('Spoken phrase')
    .fill('Also halves, quarters, and thirds')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByText('2 / 2')).toBeVisible()
  await expect(page.getByTestId('slide')).toHaveAttribute('data-layout', 'list')
  await expect(page.getByTestId('slide').getByText('halves')).toBeVisible()

  // Back on slide 1: still a title slide, title intact. Scoped to the slide
  // since the auto lecture-title in the header echoes the same words. The
  // chevron is pointer-events-none until the cursor is over its half of the
  // slide, so reveal it with a real mouse move first (see core-loop.spec).
  const box = (await page.getByTestId('slide').boundingBox())!
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2)
  await page.getByRole('button', { name: 'Previous slide' }).click()
  await expect(page.getByText('1 / 2')).toBeVisible()
  await expect(page.getByTestId('slide')).toHaveAttribute(
    'data-layout',
    'title',
  )
  await expect(page.getByTestId('slide').getByText('Fractions')).toBeVisible()
})
