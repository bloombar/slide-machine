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

// The checks above all run in a browser, which executes the bundle. This one
// deliberately does not: it reads the HTML off the wire, the way a fetch that
// runs no JavaScript sees it. The app is client-rendered, so without the
// noscript fallback that response is an empty <div id="root"> — everything
// above would still pass while a non-rendering reader saw nothing at all.
test('the served HTML carries the disclosures without running any JavaScript', async ({
  page,
}) => {
  const body = await (await page.request.get('/')).text()
  const html = body.replace(/\s+/g, ' ')

  expect(html).toContain('<noscript>')
  expect(html).toContain('The Slide Machine')
  expect(html).toMatch(/builds your lecture slides live/i)
  // Each data disclosure, and the connect scope by name
  expect(html).toContain('Your account')
  expect(html).toContain('Google sign-in')
  expect(html).toContain('Connecting Google Drive')
  expect(html).toContain('Your microphone')
  expect(html).toContain('drive.file')
  // And a real link to the policy, not one React would have to draw
  expect(html).toContain('href="/privacy"')
  expect(html).toContain('href="/terms"')
})

// Google's privacy-policy requirement asks for the policy "in the body of a
// dedicated privacy policy web page". A link is not the body, and a
// client-rendered page has no body until the bundle runs — so this reads
// /privacy and /terms off the wire, with no browser rendering, the way a
// checker that does not execute JavaScript would.
test('the policy and the terms are in the served body, without JavaScript', async ({
  page,
}) => {
  const privacy = (await (await page.request.get('/privacy')).text()).replace(
    /\s+/g,
    ' ',
  )
  expect(privacy).toContain('<h1>Privacy policy</h1>')
  // Real sections of the document, not a summary of it
  expect(privacy).toContain('What we collect')
  expect(privacy).toContain('Google Drive')
  // Built from the operator this deployment configured (playwright.config.ts)
  expect(privacy).toContain('E2E Teaching Ltd')
  expect(privacy).not.toContain('[Operator legal name]')

  const terms = (await (await page.request.get('/terms')).text()).replace(
    /\s+/g,
    ' ',
  )
  expect(terms).toContain('<h1>Terms &amp; conditions</h1>')
  expect(terms).toContain('E2E Teaching Ltd')
})

// The home page keeps the app summary — the documents replace it only on
// their own paths, and a swap that leaked everywhere would be a regression
// the test above could not see.
test('the home page still carries the app summary, not a document', async ({
  page,
}) => {
  const html = (await (await page.request.get('/')).text()).replace(/\s+/g, ' ')
  expect(html).toContain('What we ask for, and why')
  expect(html).not.toContain('<h1>Privacy policy</h1>')
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
