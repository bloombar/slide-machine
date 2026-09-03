/**
 * Counting lecture openings end to end (SPEC EVAL-7).
 *
 * The requirement's substance is not that a row gets written — an integration
 * test settles that — but that the *browser* asks for one exactly once per
 * opening. The viewer re-fetches the deck to poll for retained audio and after
 * a settings change, and it calls `setView` on every generation event, so a
 * beacon tied to the deck state would file an author's editing session as
 * dozens of readings. That gap exists only between the real page and the real
 * server, which is why it is tested here.
 *
 * Two readers, because they fail differently: the author, whose page churns
 * its deck state constantly and must still count once, and the signed-out
 * visitor, who is the reader the requirement exists for.
 */
import { test, expect, type Page } from './fixtures'
import { createProject, verifyEmail } from './helpers'

const stamp = Date.now()
const author = { email: `views-${stamp}@example.com`, name: 'Author' }
const password = 'sturdy-passw0rd'

/** The lecture the first test publishes and the second one reads. */
let deckUrl = ''

test.describe.configure({ mode: 'serial' })

/** Records every view beacon the page sends, with the status it came back
 * with — so "asked to be counted" and "was counted" stay separable. */
const watchViewBeacons = (page: Page): { statuses: number[] } => {
  const statuses: number[] = []
  page.on('response', res => {
    if (
      res.request().method() === 'POST' &&
      /\/api\/decks\/[^/]+\/view$/.test(new URL(res.url()).pathname)
    ) {
      statuses.push(res.status())
    }
  })
  return { statuses }
}

test('an author writing a lecture is counted once, not once per edit', async ({
  page,
}) => {
  const beacons = watchViewBeacons(page)

  await page.goto('/register')
  await page.getByLabel('Display name').fill(author.name)
  await page.getByLabel('Email').fill(author.email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)
  // Sharing needs a confirmed address: an unconfirmed account's projects start
  // restricted (AUTH-3), and the visitor below could not open this.
  await verifyEmail(page, author.email)

  await createProject(page, 'ViewsProj')
  await page
    .getByRole('button', { name: 'Start a new lecture in ViewsProj' })
    .click()
  await expect(page).toHaveURL(/\/d\//)

  // Opening the lecture is the one reading here.
  await expect.poll(() => beacons.statuses).toEqual([204])

  // Now churn the deck state the way authoring does. Every generated slide
  // and every auto-title replaces the view object, and the beacon must not
  // follow it — this is the count that would otherwise read as an engaged
  // audience and be untraceable downstream.
  await page.getByRole('button', { name: 'Start lecture' }).click()
  await page.getByLabel('Spoken phrase').fill('Wave basics')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toBeVisible()
  await page.getByLabel('Spoken phrase').fill('Nodes and antinodes')
  await page.getByRole('button', { name: 'Speak' }).click()
  await page.waitForTimeout(1000)

  expect(beacons.statuses).toEqual([204])
  deckUrl = page.url()
})

test('a signed-out reader is counted once per opening', async ({ browser }) => {
  expect(deckUrl).not.toBe('')

  // A visitor with no account, arriving through the shared link.
  const visitorContext = await browser.newContext()
  const visitorPage = await visitorContext.newPage()
  const beacons = watchViewBeacons(visitorPage)

  await visitorPage.goto(deckUrl)
  await expect(visitorPage.getByTestId('slide')).toBeVisible()
  // One opening, one beacon, accepted. Not two: the page settles its session
  // before fetching, which re-runs the load effect.
  await expect.poll(() => beacons.statuses).toEqual([204])

  // Reading on does not re-count — moving between slides never refetches.
  await visitorPage.keyboard.press('ArrowRight')
  await visitorPage.waitForTimeout(500)
  expect(beacons.statuses).toEqual([204])

  // Coming back is a second reading, and is counted as one.
  await visitorPage.reload()
  await expect(visitorPage.getByTestId('slide')).toBeVisible()
  await expect.poll(() => beacons.statuses).toEqual([204, 204])

  await visitorContext.close()
})
