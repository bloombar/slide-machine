/**
 * Opening a lecture at one slide from a link, and getting in when the link is
 * followed signed out.
 *
 * This is the journey an assistant's link takes (docs/MCP.md §4): an MCP tool
 * cannot see the slides it edits, so it hands the instructor an address, and
 * that address is opened in a browser that may have no session by a reader who
 * has not chosen a slide. Nothing about the link grants access — the ordinary
 * sign-in decides — so the sign-in has to be reachable from where the link
 * lands.
 */
import { test, expect, type Page } from './fixtures'
import { createProject, verifyEmail } from './helpers'

const password = 'sturdy-passw0rd'

const register = async (page: Page, email: string) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Linker')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)
}

/** A two-slide lecture, returning where it lives. */
const buildTwoSlideLecture = async (
  page: Page,
  projectTitle: string,
): Promise<string> => {
  await createProject(page, projectTitle)
  await page
    .getByRole('button', { name: `Start a new lecture in ${projectTitle}` })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Start lecture' }).click()

  // Each phrase is allowed to land before the next is typed: a submit made
  // while the previous round trip is in flight is dropped.
  await page.getByLabel('Spoken phrase').fill('Recursion basics')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(
    page.getByRole('heading', { name: 'Recursion Basics' }),
  ).toBeVisible()

  await page
    .getByLabel('Spoken phrase')
    .fill('Base case, recursive case, stack depth')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByText('2 / 2')).toBeVisible()

  return new URL(page.url()).pathname.replace('/d/', '')
}

test('a link naming a slide opens the deck on it', async ({ page }) => {
  const email = `deeplink-${Date.now()}@example.com`
  await register(page, email)
  // A confirmed account's projects are public, which is what lets the ids
  // below be read back without a session (AUTH-3).
  await verifyEmail(page, email)
  const slug = await buildTwoSlideLecture(page, 'DeepLinkProj')

  const deck = await page.request.get(`/api/decks/${slug}`)
  expect(deck.status()).toBe(200)
  const slides = (await deck.json()).slides as { id: string }[]
  expect(slides.length).toBe(2)

  // Without a slide named, the deck opens where it always did.
  await page.goto(`/d/${slug}`)
  await expect(page.getByText('1 / 2')).toBeVisible()

  // With one named, it opens there instead.
  await page.goto(`/d/${slug}?slide=${slides[1]!.id}`)
  await expect(page.getByText('2 / 2')).toBeVisible()

  // A slide this deck does not have — one since deleted, a mistyped link —
  // opens the deck rather than failing the page.
  await page.goto(`/d/${slug}?slide=no-such-slide`)
  await expect(page.getByText('1 / 2')).toBeVisible()
})

test('a private deck’s link offers the sign-in that opens it', async ({
  page,
  browser,
}) => {
  const email = `deeplink-private-${Date.now()}@example.com`
  await register(page, email)
  await verifyEmail(page, email)
  const slug = await buildTwoSlideLecture(page, 'PrivateLinkProj')

  const deck = await page.request.get(`/api/decks/${slug}`)
  const slides = (await deck.json()).slides as { id: string }[]
  const link = `/d/${slug}?slide=${slides[1]!.id}`

  // Shut the lecture to everyone but its owner.
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  await page.getByRole('tab', { name: 'Privacy & Sharing' }).click()
  await page.getByRole('radio', { name: /restricted/i }).click()
  await expect(page.getByRole('radio', { name: /restricted/i })).toBeChecked()
  await page.getByRole('button', { name: 'Close settings' }).click()

  // Someone following the link with no session: the deck reads as missing,
  // which is the no-leak answer — and signing in is offered, because it is
  // the one thing that can change the answer.
  const anonContext = await browser.newContext()
  const anonPage = await anonContext.newPage()
  await anonPage.goto(link)
  await expect(
    anonPage.getByText('This deck does not exist or is private'),
  ).toBeVisible()
  await anonPage.getByRole('link', { name: 'Sign in' }).click()

  await anonPage.getByLabel('Email').fill(email)
  await anonPage.getByLabel('Password').fill(password)
  await anonPage.getByRole('button', { name: 'Sign in' }).click()

  // Back at the address they were sent, on the slide it named — not at /app,
  // and not at the front of the deck.
  await expect(anonPage).toHaveURL(new RegExp(`/d/${slug}\\?slide=`))
  await expect(anonPage.getByText('2 / 2')).toBeVisible()
  await anonContext.close()
})
