/**
 * E2E interface-language journey (TECH-12) against the built app, in a
 * French browser: the chrome is French on the very first load, before
 * anyone signs in; registering stores no language at all, so the account
 * keeps following the browser; switching to English on the profile
 * persists to `User.locale`, so a reload — which re-detects from the same
 * French browser — still comes back in English; and choosing the default
 * again clears it, handing the interface back to the browser.
 *
 * The rest of the suite pins `locale: 'en-US'` (playwright.config.ts) so
 * its English selectors are deterministic; this spec is the one that opts
 * out, which is also what proves the detection is real.
 */
import { test, expect } from '@playwright/test'

test.use({ locale: 'fr-FR' })

test.describe.configure({ mode: 'serial' })

const email = `e2e-i18n-${Date.now()}@example.com`
const password = 'sturdy-passw0rd'
const displayName = 'Testeur i18n'

test('an anonymous French browser gets French chrome', async ({ page }) => {
  await page.goto('/login')

  await expect(
    page.getByRole('heading', { name: 'Se connecter' }),
  ).toBeVisible()
  await expect(page.getByLabel('Mot de passe')).toBeVisible()
  // The document itself follows, which is what assistive tech reads
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
})

test('registering stores no language, and a switch persists', async ({
  page,
}) => {
  await page.goto('/register')
  await page.getByLabel("Nom d'affichage").fill(displayName)
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Mot de passe').fill(password)
  await page.getByRole('button', { name: 'Créer un compte' }).click()

  await expect(page).toHaveURL(/\/app$/)
  await expect(
    page.getByRole('heading', { name: `Bienvenue, ${displayName}` }),
  ).toBeVisible()

  // Switch to English from the account settings page, reached from the
  // profile. Nothing was stored at sign-up, so the picker is still on
  // its default — the browser's language — even though French is showing.
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('menuitem', { name: 'Profil' }).click()
  await page.getByRole('link', { name: 'Paramètres' }).click()
  const picker = page.getByLabel("Langue de l'interface").first()
  await expect(picker).toHaveValue('')
  await picker.selectOption('en')

  // The app re-renders in English straight away — the page's own heading is
  // the proof, since it is translated from the same bundle.
  await expect(
    page.getByRole('heading', { name: 'Account Settings' }),
  ).toBeVisible()

  // …and it stuck to the account, not just this page: a reload re-detects
  // from the same French browser and still comes back English.
  await page.goto('/app')
  await expect(
    page.getByRole('heading', { name: `Welcome, ${displayName}` }),
  ).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
})

test('choosing the default again hands the interface back to the browser', async ({
  page,
}) => {
  await page.goto('/login')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Mot de passe').fill(password)
  await page.getByRole('button', { name: 'Se connecter' }).click()

  // The account chose English in the previous test, so that is what it
  // signs in to, French browser or not
  await expect(
    page.getByRole('heading', { name: `Welcome, ${displayName}` }),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('menuitem', { name: 'Profile' }).click()
  // Exact: the Discover feed lists other people's lectures, and one titled
  // "Settings Lecture ..." matches a substring search for "Settings". Waiting
  // for the profile URL is not enough on its own — the URL changes before the
  // route's markup does, so the home page can still be in the DOM.
  await expect(page).toHaveURL(/\/u\//)
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await page
    .getByLabel('Interface language')
    .first()
    .selectOption({ value: '' })

  // Back to French straight away, and it stuck: a reload finds nothing
  // stored on the account and detects the French browser again.
  await expect(
    page.getByRole('heading', { name: 'Paramètres du compte' }),
  ).toBeVisible()
  await page.goto('/app')
  await expect(
    page.getByRole('heading', { name: `Bienvenue, ${displayName}` }),
  ).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
})
