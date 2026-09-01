/**
 * Walking-skeleton e2e: the landing page renders with a sign-in call to
 * action, and the sticky footer's health bar transitively proves SPA
 * serving, the API, and MongoDB together.
 */
import { test, expect } from './fixtures'

test('landing page shows the hero and a healthy API footer', async ({
  page,
}) => {
  await page.goto('/')

  await expect(page).toHaveTitle('The Slide Machine')
  await expect(
    page.getByRole('heading', { level: 1, name: 'The Slide Machine' }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: /sign in to get started/i }),
  ).toBeVisible()

  const bar = page.getByTestId('health-bar')
  await expect(bar).toContainText('API ok')

  // Clicking the bar expands the component breakdown: mode, version, and
  // per-service status including a connected MongoDB.
  await bar.getByRole('button').click()
  const panel = page.getByTestId('health-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('Version')
  await expect(panel.getByTestId('health-component-mongo')).toContainText(
    'connected',
  )
})
