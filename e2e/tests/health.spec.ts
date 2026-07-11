/**
 * Walking-skeleton e2e: the landing page renders with a sign-in call to
 * action, and the sticky footer's health bar transitively proves SPA
 * serving, the API, and MongoDB together.
 */
import { test, expect } from '@playwright/test'

test('landing page shows the hero and a healthy API footer', async ({
  page,
}) => {
  await page.goto('/')

  await expect(page).toHaveTitle('The Slide Machine')
  await expect(
    page.getByRole('heading', { name: 'The Slide Machine V2' }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: /sign in to get started/i }),
  ).toBeVisible()

  const bar = page.getByTestId('health-bar')
  await expect(bar).toContainText('API ok')
  await expect(bar).toContainText('mongo connected')
})
