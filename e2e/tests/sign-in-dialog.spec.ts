/**
 * The sign-in dialog end to end (AUTH-8): a signed-out visitor reaching for
 * playback gets the dialog instead of the action, signs in through it
 * without leaving the page, and lands back on the same lecture signed in —
 * with playback not auto-fired, so a second press is what starts it.
 */
import { test, expect, type Page } from './fixtures'
import { createProject, verifyEmail } from './helpers'

const stamp = Date.now()
const reader = { email: `gate-${stamp}@example.com`, name: 'Reader' }
const password = 'sturdy-passw0rd'

const register = async (page: Page, user: { email: string; name: string }) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill(user.name)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)
  // A public lecture needs a confirmed owner (AUTH-3) — otherwise the
  // anonymous visit below would 404 before ever reaching the play button.
  await verifyEmail(page, user.email)
}

test('signed-out playback raises the sign-in dialog and returns to the same lecture', async ({
  page,
}) => {
  await register(page, reader)

  // A one-slide public lecture, owned by the account signing back in later
  await createProject(page, 'GateProj')
  await page
    .getByRole('button', { name: 'Start a new lecture in GateProj' })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Start lecture' }).click()
  await page.getByLabel('Spoken phrase').fill('Wave basics')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toBeVisible()
  const deckUrl = page.url()

  // Signed out for real, not merely a fresh tab: the same account reads its
  // own lecture with no session at all.
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('menuitem', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/\/$/)

  await page.goto(deckUrl)
  await expect(page.getByTestId('slide')).toBeVisible()

  // Reaching for the play button signed out raises the dialog instead of
  // playing — it never gets as far as "Pause playback".
  await page.getByRole('button', { name: 'Play deck' }).click()
  const dialog = page.getByRole('dialog', {
    name: 'Log in to play back the lecture',
  })
  await expect(dialog).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Pause playback' }),
  ).toHaveCount(0)

  // Signs in on the spot — the same form /login renders, without leaving
  // the lecture.
  await dialog.getByLabel('Email').fill(reader.email)
  await dialog.getByLabel('Password').fill(password)
  await dialog.getByRole('button', { name: 'Sign in' }).click()

  // The dialog closes, the visitor is still on the same lecture signed in,
  // and playback did not start itself.
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(deckUrl)
  await expect(page.getByTestId('slide')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Pause playback' }),
  ).toHaveCount(0)

  // The control is live now — pressing it is what starts playback.
  await page.getByRole('button', { name: 'Play deck' }).click()
  await expect(
    page.getByRole('button', { name: 'Pause playback' }),
  ).toBeVisible()
})
