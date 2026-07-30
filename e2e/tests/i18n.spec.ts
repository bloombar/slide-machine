/**
 * E2E interface-language journey (TECH-12) against the built app, in a
 * French browser: the chrome is French on the very first load, before
 * anyone signs in; registering carries that detection onto the new
 * account; switching to English on the profile persists to `User.locale`,
 * so a reload — which re-detects from the same French browser — still
 * comes back in English.
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

test('registering keeps the detected locale, and a switch persists', async ({
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

  // Switch to English from the account settings on the profile page
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('menuitem', { name: 'Profil' }).click()
  await page.getByRole('button', { name: 'Paramètres' }).click()
  await page.getByLabel("Langue de l'interface").first().selectOption('en')

  // The app re-renders in English straight away
  await expect(
    page.getByRole('button', { name: 'Close settings' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Close settings' }).click()

  // …and it stuck to the account, not just this page: a reload re-detects
  // from the same French browser and still comes back English.
  await page.goto('/app')
  await expect(
    page.getByRole('heading', { name: `Welcome, ${displayName}` }),
  ).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
})
