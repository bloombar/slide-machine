/**
 * E2E auth journey (AUTH-1/AUTH-2 + PROJ-1 via the action layer) against
 * the built app: register → authenticated home → session survives reload →
 * create project → logout → login → data still there.
 */
import { test, expect, type Page } from '@playwright/test'

const email = `e2e-${Date.now()}@example.com`
const password = 'sturdy-passw0rd'
const displayName = 'E2E Tester'

const login = async (page: Page) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test.describe.configure({ mode: 'serial' })

test('register lands authenticated and the session survives a reload', async ({
  page,
}) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill(displayName)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page).toHaveURL(/\/app$/)
  await expect(
    page.getByRole('heading', { name: `Welcome, ${displayName}` }),
  ).toBeVisible()

  await page.reload()
  await expect(
    page.getByRole('heading', { name: `Welcome, ${displayName}` }),
  ).toBeVisible()
})

test('projects persist across logout and login', async ({ page }) => {
  await login(page)
  await expect(page).toHaveURL(/\/app$/)

  await page.getByLabel('New project title').fill('Biology 101')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('Biology 101')).toBeVisible()

  // Sign out lives at the bottom of the profile page
  await page.getByRole('link', { name: 'Profile' }).click()
  await expect(page).toHaveURL(/\/app\/profile$/)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)

  // Signed out for real: a reload must not restore the session
  await page.goto('/app')
  await expect(page).toHaveURL(/\/login$/)

  await login(page)
  await expect(page.getByText('Biology 101')).toBeVisible()
})

test('wrong password shows an error and stays on the login page', async ({
  page,
}) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('wrong-password')
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByRole('alert')).toHaveText(
    'Incorrect email or password',
  )
  await expect(page).toHaveURL(/\/login$/)
})
