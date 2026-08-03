/**
 * A brand-new user's first lecture. With no project yet, the home screen
 * offers a dashed "New lecture" zone that spins up a titleless default
 * project on the fly and drops the user straight into the lecture. The
 * default project keeps an empty title in the data but shows everywhere
 * under its placeholder name ("Default project").
 */
import { test, expect } from '@playwright/test'

const email = `first-lecture-${Date.now()}@example.com`

test('a new user starts a lecture with no project; a default project is created', async ({
  page,
}) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Newcomer')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()

  // No projects yet: the empty-state New lecture zone is the only affordance
  const startZone = page.getByRole('button', {
    name: 'Start a new lecture',
    exact: true,
  })
  await expect(startZone).toBeVisible()

  // One click makes a default project and the lecture inside it
  await startZone.click()
  await expect(page).toHaveURL(/\/d\/untitled-/)
  await expect(
    page.getByRole('heading', { name: 'Untitled lecture' }),
  ).toBeVisible()
  // Dismiss the pre-lecture seed dialog before navigating away
  await page.getByRole('button', { name: 'Start lecture' }).click()

  // Home now shows the default project under its placeholder name, with the
  // lecture beneath it
  await page.getByRole('link', { name: 'The Slide Machine' }).click()
  await expect(
    page.getByRole('heading', { name: 'Default project' }),
  ).toBeVisible()
  // Scoped to "Your work": the Discover sidebar beside it lists other
  // people's untitled lectures.
  await expect(
    page
      .getByRole('region', { name: 'Your work' })
      .getByRole('link', { name: /Untitled lecture/ }),
  ).toBeVisible()

  // The project's own page shows the placeholder name too; its data title is
  // blank, so editing starts from empty
  await page
    .getByRole('heading', { name: 'Default project' })
    .getByRole('link')
    .click()
  await expect(page).toHaveURL(/\/app\/projects\//)
  await expect(page.getByText('Default project')).toBeVisible()
})
