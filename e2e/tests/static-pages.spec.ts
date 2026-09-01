/**
 * E2E for the static pages against the built app: the four entries the
 * hamburger gained, each page they open, and the feedback form's whole path
 * from a filled-in form to a message the server accepted.
 *
 * Signed out throughout — these pages are public on purpose, and this is the
 * check that they really are.
 */
import { test, expect, type Page } from './fixtures'

/** Opens the nav drawer and returns once its links are there. */
const openMenu = async (page: Page) => {
  await page.getByRole('button', { name: 'Menu' }).click()
  await expect(page.getByRole('menuitem', { name: 'Home' })).toBeVisible()
}

test('the menu lists the static pages, signed out', async ({ page }) => {
  await page.goto('/')
  await openMenu(page)
  await expect(page.getByRole('menu').first().getByRole('menuitem')).toHaveText(
    [
      'Home',
      'Log in',
      'About us',
      'Send feedback',
      'Privacy policy',
      'Terms & conditions',
    ],
  )
})

test('each entry opens its page', async ({ page }) => {
  for (const [entry, path, heading] of [
    ['About us', '/about', 'About us'],
    ['Privacy policy', '/privacy', 'Privacy policy'],
    ['Terms & conditions', '/terms', 'Terms & conditions'],
  ]) {
    await page.goto('/')
    await openMenu(page)
    await page.getByRole('menuitem', { name: entry }).click()
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(
      page.getByRole('heading', { level: 1, name: heading }),
    ).toBeVisible()
  }
})

// The documents link to each other; the links have to be router links, or
// each one costs a full page load. Scoped to the article: the site footer
// (SiteFooter) links the same page from every page, and this is about the
// link inside the prose.
test('the About page links onward to the policy and the form', async ({
  page,
}) => {
  await page.goto('/about')
  await page
    .getByRole('article')
    .getByRole('link', { name: 'privacy policy' })
    .click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Privacy policy' }),
  ).toBeVisible()
  await expect(page.getByText(/Last updated:/)).toBeVisible()
})

// /assistants is reached from the About page rather than from the menu, so
// the prose link is its only way in and the one that can rot.
test('the About page leads to the assistant instructions', async ({ page }) => {
  await page.goto('/about')
  await page
    .getByRole('article')
    .getByRole('link', { name: 'How to connect an assistant' })
    .click()
  await expect(page).toHaveURL(/\/assistants$/)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Connecting an AI assistant' }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { level: 3, name: 'ChatGPT' }),
  ).toBeVisible()
})

// These four are the only pages written outside the app's usual page
// scaffolding, so they are the ones that can drift out of it. The content
// column is the app's (AppShell's main, ProfilePage), and the check is that
// a heading here starts exactly where a heading on the home screen does.
test('the static pages sit in the same column as the rest of the app', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const account = {
    email: `e2e-column-${Date.now()}@example.com`,
    displayName: 'Col Umn',
    password: 'sturdy-passw0rd',
  }
  // Registration signs the browser in, so /app renders its own heading
  expect(
    (await page.request.post('/api/auth/register', { data: account })).status(),
  ).toBe(201)

  await page.goto('/app')
  const home = await page
    .getByRole('heading', { level: 1 })
    .first()
    .boundingBox()
  expect(home).not.toBeNull()

  for (const path of [
    '/about',
    '/assistants',
    '/privacy',
    '/terms',
    '/feedback',
  ]) {
    await page.goto(path)
    const heading = await page.getByRole('heading', { level: 1 }).boundingBox()
    expect(heading, path).not.toBeNull()
    expect(heading!.x, `${path} left edge`).toBe(home!.x)
  }
})

// Who runs the deployment is server configuration (OPERATOR_* in
// playwright.config.ts), not source: the documents are built from what
// GET /api/config publishes, so changing entity or address is a restart.
test('the legal documents name the configured operator', async ({ page }) => {
  for (const path of ['/privacy', '/terms']) {
    await page.goto(path)
    await expect(page.getByText('E2E Teaching Ltd').first()).toBeVisible()
    await expect(page.getByText('legal@e2e.example').first()).toBeVisible()
    // No placeholder survives where a real detail was given
    await expect(page.getByText('[Operator legal name]')).toHaveCount(0)
  }
  // The terms are the document that turns on where the operator is
  await expect(page.getByText(/laws of New York, USA/)).toBeVisible()
  // Every detail is real, so the draft banner drops its brackets sentence
  // and keeps the one that matters
  await expect(page.getByText(/pending legal review/)).toBeVisible()
  await expect(page.getByText(/square brackets/)).toHaveCount(0)
})

test('a visitor can send feedback', async ({ page }) => {
  await page.goto('/')
  await openMenu(page)
  await page.getByRole('menuitem', { name: 'Send feedback' }).click()
  await expect(page).toHaveURL(/\/feedback$/)

  await page.getByLabel(/Something is missing/).check()
  await page.getByLabel('Summary').fill('A darker theme, please')
  await page
    .getByLabel('Details')
    .fill('The white background is bright in a lecture hall.')
  // Anonymous is allowed; leaving an address is what gets a reply
  await page.getByLabel(/Your email/).fill('visitor@example.com')
  await page.getByRole('button', { name: 'Send feedback' }).click()

  await expect(page.getByRole('heading', { name: 'Thank you' })).toBeVisible()

  // And the form comes back empty for a second message
  await page.getByRole('button', { name: 'Send another' }).click()
  await expect(page.getByLabel('Summary')).toHaveValue('')
})
