/**
 * Layout re-fit end to end (GENERATION_LAYOUT_REFIT on, mock provider):
 * a prose content slide that receives an enumerating continuation is
 * re-fitted to a list layout in place — same slide, migrated content —
 * per GEN-8 "re-fit the layout on update".
 */
import { test, expect } from '@playwright/test'
import { createProject } from './helpers'

const email = `refit-${Date.now()}@example.com`
const password = 'sturdy-passw0rd'

test('an enumerating update refits the slide from content to list', async ({
  page,
}) => {
  // Register, create a project, start a lecture
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
    page.getByText('The cell membrane is a strong protective barrier'),
  ).toBeVisible()

  // An enumerating continuation refits the SAME slide to a list:
  // the body migrates into the bullets, no new slide appears
  await page
    .getByLabel('Spoken phrase')
    .fill('Also it contains cholesterol, embedded proteins, glycolipids')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toHaveAttribute('data-layout', 'list')
  await expect(
    page.getByText('The cell membrane is a strong protective barrier'),
  ).toBeVisible()
  await expect(page.getByText('glycolipids')).toBeVisible()
  await expect(page.getByText('1 / 1')).toBeVisible()
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
