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
import AdmZip from 'adm-zip'
import { test, expect, type Page } from './fixtures'
import { createProject, verifyEmail } from './helpers'

const stamp = Date.now()
const author = { email: `views-${stamp}@example.com`, name: 'Author' }
const password = 'sturdy-passw0rd'
// Must match ADMIN_EMAILS in playwright.config.ts; the account may already
// exist from a previous local run (research-export.spec.ts uses the same
// one), so signing in tolerates a 409 on registration.
const admin = { email: 'e2e-admin@example.com', displayName: 'E2E Admin' }

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

  // Opening the lecture is the one reading here. It succeeds, so the route
  // answers 200 with the depth-reporting key (EVAL-7 depth) rather than 204.
  await expect.poll(() => beacons.statuses).toEqual([200])

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

  expect(beacons.statuses).toEqual([200])
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
  await expect.poll(() => beacons.statuses).toEqual([200])

  // Reading on does not re-count — moving between slides never refetches.
  await visitorPage.keyboard.press('ArrowRight')
  await visitorPage.waitForTimeout(500)
  expect(beacons.statuses).toEqual([200])

  // Coming back is a second reading, and is counted as one.
  await visitorPage.reload()
  await expect(visitorPage.getByTestId('slide')).toBeVisible()
  await expect.poll(() => beacons.statuses).toEqual([200, 200])
  // `expect.poll` passes at the first moment the array matches, so on its own
  // it cannot see a third beacon arriving late — which is the whole property
  // this test is named for. Settle, then assert once, hard.
  await visitorPage.waitForTimeout(500)
  expect(beacons.statuses).toEqual([200, 200])

  await visitorContext.close()
})

/**
 * Signs the admin account in, registering it via the API when it doesn't
 * exist yet (registration also sets the session cookie), and lands on
 * /app. Mirrors research-export.spec.ts's helper — the account is shared
 * across spec files by design (one fixed ADMIN_EMAILS entry).
 */
const ensureAdminSignedIn = async (page: Page) => {
  const res = await page.request.post('/api/auth/register', {
    data: { ...admin, password },
  })
  if (res.status() === 201) {
    await page.goto('/app')
  } else {
    expect(res.status()).toBe(409)
    await page.goto('/login')
    await page.getByLabel('Email').fill(admin.email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in' }).click()
  }
  await expect(page).toHaveURL(/\/app$/)
}

/**
 * Downloads the research export bundle from the admin Research tab (the
 * same real button-click flow research-export.spec.ts exercises — the
 * bundle route needs the browser's own bearer token, which `page.request`
 * does not carry) and returns `deck-views.csv`'s text.
 */
const downloadDeckViewsCsv = async (page: Page): Promise<string> => {
  await page.goto('/app/admin/research')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /download bundle/i }).click()
  const download = await downloadPromise
  const file = await download.path()
  const zip = new AdmZip(file)
  return zip.getEntry('deck-views.csv')!.getData().toString('utf-8')
}

/** The row of `deck-views.csv` naming `deckName`, as `{header: cell}` —
 * simple comma-splitting is safe here because every field this spec
 * controls (title, project name) is chosen comma-free. */
const deckViewRow = (
  csv: string,
  deckName: string,
): Record<string, string> | null => {
  const lines = csv.trim().split('\r\n')
  const header = lines[0]!.split(',')
  const line = lines.find(
    l => l.split(',')[header.indexOf('deckName')] === deckName,
  )
  if (!line) return null
  const cells = line.split(',')
  return Object.fromEntries(header.map((name, i) => [name, cells[i] ?? '']))
}

test('records how far a signed-out reader got (EVAL-7 depth)', async ({
  page,
  browser,
}) => {
  const lectureTitle = `ReadingDepth ${stamp}`
  const depthAuthor = { email: `depth-${stamp}@example.com`, name: 'Depth' }

  // A fresh lecture with several slides: each short, non-continuation
  // phrase becomes its own slide under the mock generation provider (an
  // opener under five words is a title slide; anything else that is not a
  // comma list or a continuation is a new content slide).
  await page.goto('/register')
  await page.getByLabel('Display name').fill(depthAuthor.name)
  await page.getByLabel('Email').fill(depthAuthor.email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)
  await verifyEmail(page, depthAuthor.email)

  await createProject(page, 'DepthProj')
  await page
    .getByRole('button', { name: 'Start a new lecture in DepthProj' })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Start lecture' }).click()

  await page.getByTitle('Click to edit Lecture title').click()
  await page.getByRole('textbox', { name: 'Lecture title' }).fill(lectureTitle)
  await page.keyboard.press('Enter')

  const phrases = [
    'Wave basics',
    'Nodes and antinodes form',
    'Standing waves everywhere',
    'Wavelength frequency speed relationship',
  ]
  for (const [i, phrase] of phrases.entries()) {
    await page.getByLabel('Spoken phrase').fill(phrase)
    await page.getByRole('button', { name: 'Speak' }).click()
    // Each phrase must settle into its own slide before the next is spoken —
    // firing them back to back races the in-flight generation request.
    await expect(page.getByText(`${i + 1} / ${i + 1}`)).toBeVisible()
  }
  const deckUrl = page.url()

  // A signed-out visitor reads it, advancing through every slide.
  const visitorContext = await browser.newContext()
  const visitorPage = await visitorContext.newPage()
  await visitorPage.goto(deckUrl)
  await expect(visitorPage.getByTestId('slide')).toBeVisible()
  for (let i = 0; i < 3; i += 1) {
    await visitorPage.keyboard.press('ArrowRight')
    // A beat of genuinely visible time between slides, so `activeMs` is a
    // real (if small) reading rather than an instant flip through four.
    await visitorPage.waitForTimeout(300)
  }
  await expect(visitorPage.getByText('4 / 4')).toBeVisible()

  // Leaving the page fires `pagehide`, which is what makes the depth
  // beacon fire (`useReadingDepth`) — a real navigation, not a simulated
  // event, is the property only an e2e test can check.
  await visitorPage.goto('about:blank')
  await visitorContext.close()

  // The report is fire-and-forget from the reader's side; give it a moment
  // to land before asking the admin export for it.
  await page.waitForTimeout(1500)

  // A fresh session for the admin — reusing `page` (still signed in as the
  // lecture's author) would race the author's own cookie refresh against
  // the admin login form.
  const adminContext = await browser.newContext()
  const adminPage = await adminContext.newPage()
  await ensureAdminSignedIn(adminPage)
  const csv = await downloadDeckViewsCsv(adminPage)
  await adminContext.close()

  const row = deckViewRow(csv, lectureTitle)
  expect(row, `no deck-views.csv row named "${lectureTitle}"`).not.toBeNull()
  // A floor, not an exact count (EVAL-7 depth): reached at least all four
  // slides, and was visible for a real, non-zero stretch of time.
  expect(Number(row!.slidesReached)).toBeGreaterThanOrEqual(4)
  expect(Number(row!.activeMs)).toBeGreaterThan(0)
  // The reader who reported it was never identified, same as the opening.
  expect(row!.viewerStudyId).toBe('')
})
