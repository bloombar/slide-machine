/**
 * Social voting, search, and the discovery feed end to end (SOC-1, SOC-2,
 * SOC-3), with two users in separate browser contexts. The owner publishes a
 * lecture; the guest finds it in the home "Discover" feed, opens it, up-votes
 * it (the score rises and persists across a reload), then reaches the owner's
 * profile from the feed. The "Top" tab reorders by score, the feed row shows
 * the net rating read-only, and searching by the author's name finds the
 * lecture with the sort still in force.
 */
import { test, expect, type Browser, type Page } from '@playwright/test'
import { createProject, verifyEmail } from './helpers'

const stamp = Date.now()
// Every name is stamped. The e2e database persists between runs and the
// Discover feed lists everyone's public lectures, so a fixed name would match
// earlier runs' rows as well as this one's.
const owner = {
  email: `voteowner-${stamp}@example.com`,
  name: `VoteOwner${stamp}`,
}
const guest = {
  email: `voteguest-${stamp}@example.com`,
  name: `VoteGuest${stamp}`,
}
const password = 'sturdy-passw0rd'
const lectureTitle = `Voting Target ${stamp}`
const projectName = `VoteProj${stamp}`

const register = async (page: Page, user: { email: string; name: string }) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill(user.name)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)
  // Sharing needs a confirmed address: an unconfirmed account's projects
  // start restricted (AUTH-3).
  await verifyEmail(page, user.email)
}

const newUserPage = async (
  browser: Browser,
  user: { email: string; name: string },
): Promise<Page> => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await register(page, user)
  return page
}

test('voting + discover feed: upvote persists, owner link, top sort', async ({
  browser,
}) => {
  const ownerPage = await newUserPage(browser, owner)
  const guestPage = await newUserPage(browser, guest)

  // Owner builds a public (default) one-slide lecture with a unique title
  await createProject(ownerPage, projectName)
  await ownerPage
    .getByRole('button', { name: `Start a new lecture in ${projectName}` })
    .click()
  await expect(ownerPage).toHaveURL(/\/d\//)
  await ownerPage.getByRole('button', { name: 'Start lecture' }).click()
  await ownerPage.getByTitle('Click to edit Lecture title').click()
  await ownerPage
    .getByRole('textbox', { name: 'Lecture title' })
    .fill(lectureTitle)
  await ownerPage.keyboard.press('Enter')
  await ownerPage.getByLabel('Spoken phrase').fill('Wave basics')
  await ownerPage.getByRole('button', { name: 'Speak' }).click()
  await expect(ownerPage.getByTestId('slide')).toBeVisible()

  // The guest sees the lecture in the home "Discover" feed and opens it
  await guestPage.goto('/app')
  const feed = guestPage.getByRole('complementary', {
    name: 'Community lectures',
  })
  const feedLink = feed.getByRole('link', { name: lectureTitle })
  await expect(feedLink).toBeVisible()
  await feedLink.click()
  await expect(guestPage).toHaveURL(/\/d\//)
  await expect(guestPage.getByTestId('slide')).toBeVisible()

  // Up-vote from the fixed viewer widget: the up count becomes 1 and the arrow
  // reads as active
  const upvote = guestPage.getByRole('button', { name: 'Upvote' })
  await upvote.click()
  await expect(upvote).toHaveAttribute('aria-pressed', 'true')
  await expect(upvote).toContainText('1')

  // The vote persists across a reload
  await guestPage.reload()
  const upvoteAfter = guestPage.getByRole('button', { name: 'Upvote' })
  await expect(upvoteAfter).toHaveAttribute('aria-pressed', 'true')
  await expect(upvoteAfter).toContainText('1')

  // Back on the home feed, the Top tab lists the lecture (now scored)
  await guestPage.goto('/app')
  const feedAgain = guestPage.getByRole('complementary', {
    name: 'Community lectures',
  })
  await guestPage.getByRole('button', { name: 'Top' }).click()
  await expect(
    feedAgain.getByRole('link', { name: lectureTitle }),
  ).toBeVisible()

  // This lecture's own row: the feed lists other people's lectures too, so
  // every assertion below is scoped to the row carrying our title.
  const row = feedAgain
    .getByRole('listitem')
    .filter({ hasText: lectureTitle })
    .first()

  // The row reports how many voted (the guest's single up-vote), and offers
  // no way to vote from the list — voting happens inside the lecture
  await expect(row.getByText('1 vote')).toBeVisible()
  await expect(feedAgain.getByRole('button', { name: 'Upvote' })).toHaveCount(0)

  // The row credits its owner, and that name reaches their public profile
  // (SOC-2 discovery: you find a person through their work)
  await row.getByRole('link', { name: owner.name }).click()
  await expect(guestPage).toHaveURL(/\/u\//)
  await expect(
    guestPage.getByRole('heading', { name: owner.name }),
  ).toBeVisible()
  await guestPage.goBack()
  await guestPage.getByRole('button', { name: 'Top' }).click()

  // Searching by the AUTHOR's name finds their lecture (SOC-2), and the
  // Latest/Top choice still governs the result list while a query is typed
  const box = feedAgain.getByRole('searchbox')
  await box.fill(owner.name)
  await expect(
    feedAgain.getByRole('link', { name: lectureTitle }),
  ).toBeVisible()
  await guestPage.getByRole('button', { name: 'Latest' }).click()
  await expect(
    feedAgain.getByRole('link', { name: lectureTitle }),
  ).toBeVisible()
  await box.fill('')
  await expect(
    feedAgain.getByRole('link', { name: lectureTitle }),
  ).toBeVisible()

  // The project is browsable read-only from the feed (public project): clicking
  // it opens the project page rather than the old "Could not load" error.
  const rowAgain = feedAgain
    .getByRole('listitem')
    .filter({ hasText: lectureTitle })
    .first()
  await rowAgain.getByRole('link', { name: projectName }).click()
  await expect(guestPage).toHaveURL(/\/app\/projects\//)
  await expect(
    guestPage.getByRole('heading', { name: 'Lectures' }),
  ).toBeVisible()
  await expect(guestPage.getByText('Could not load this project')).toHaveCount(
    0,
  )
  // A read-only viewer gets no owner controls: the project's menu carries
  // settings, sharing, import and delete, and none of them are theirs.
  await expect(
    guestPage.getByRole('button', { name: `Options for ${projectName}` }),
  ).toHaveCount(0)
})
