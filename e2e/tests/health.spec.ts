/**
 * Walking-skeleton e2e: loading the landing page and seeing a healthy
 * status transitively proves SPA serving, the API, and MongoDB together.
 */
import { test, expect } from '@playwright/test'

test('landing page reports a healthy API', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveTitle('Slide Machine')
  await expect(
    page.getByRole('heading', { name: 'Slide Machine V2' }),
  ).toBeVisible()
  await expect(page.getByTestId('health-badge')).toHaveText('ok')
  await expect(page.getByText('mongo: connected')).toBeVisible()
})
