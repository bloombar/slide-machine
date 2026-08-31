/**
 * E2E for the public homepage against the built app — the page Google's OAuth
 * reviewers read (docs/GOOGLE_PRODUCTION_MODE.md §3.3).
 *
 * Signed out throughout, and deliberately without opening the nav drawer:
 * the point of these checks is that a visitor who touches nothing still sees
 * what the app is, what it does, what data it asks for, and a link to the
 * privacy policy.
 */
import { test, expect } from './fixtures'

test('the homepage names the app and describes what it does', async ({
  page,
}) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { level: 1, name: 'The Slide Machine' }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'What it does' }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Slides written as you speak' }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Exit-ticket quizzes' }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Translated, and read aloud' }),
  ).toBeVisible()
})

test('the homepage says what user data it asks for, and why', async ({
  page,
}) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'What we ask for, and why' }),
  ).toBeVisible()
  // The Google grants are named individually, and the connect scope by name:
  // "we use Google" is not a purpose statement.
  await expect(page.getByText('Google sign-in')).toBeVisible()
  await expect(page.getByText('Connecting Google Drive')).toBeVisible()
  await expect(page.getByText(/drive\.file/)).toBeVisible()
  await expect(
    page.getByText(/cannot list, search or read the rest of your Drive/),
  ).toBeVisible()
})

test('the privacy policy is one click away, with no menu to open', async ({
  page,
}) => {
  await page.goto('/')
  // The footer copy, not the drawer's — the drawer stays shut for this test
  await page
    .getByRole('navigation', { name: 'Legal and information' })
    .getByRole('link', { name: 'Privacy policy' })
    .click()
  await expect(page).toHaveURL(/\/privacy$/)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Privacy policy' }),
  ).toBeVisible()
})

test('the footer carries the same links on every public page', async ({
  page,
}) => {
  for (const path of ['/', '/login', '/register']) {
    await page.goto(path)
    const footer = page.getByRole('navigation', {
      name: 'Legal and information',
    })
    await expect(
      footer.getByRole('link', { name: 'Privacy policy' }),
    ).toBeVisible()
    await expect(
      footer.getByRole('link', { name: 'Terms & conditions' }),
    ).toBeVisible()
  }
})

test('the register form names the terms and the policy', async ({ page }) => {
  await page.goto('/register')
  const form = page.locator('form')
  await expect(form.getByText(/By creating an account you agree/)).toBeVisible()
  await expect(
    form.getByRole('link', { name: 'Privacy policy' }),
  ).toHaveAttribute('href', '/privacy')
  await expect(
    form.getByRole('link', { name: 'Terms & conditions' }),
  ).toHaveAttribute('href', '/terms')
})
