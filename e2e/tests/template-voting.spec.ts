/**
 * Voting on a design end to end (TMPL-27): a second user upvotes a built-in
 * and another user's shared design from a lecture's Design tab, sees the
 * vote survive a reload, changes it to a downvote from the design's own
 * page, and — on their own design — sees a read-only tally rather than
 * buttons, exactly as the library card does.
 */
import { test, expect, type Browser, type Page } from './fixtures'
import { createProject, verifyEmail } from './helpers'

const stamp = Date.now()
const owner = { email: `voteowner-${stamp}@example.com`, name: 'Author' }
const voter = { email: `votevoter-${stamp}@example.com`, name: 'Voter' }
const password = 'sturdy-passw0rd'
const ownerProject = `VoteOwner${stamp}`
const voterProject = `VoteVoter${stamp}`
const designName = `Voted Design ${stamp}`

const register = async (page: Page, user: { email: string; name: string }) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill(user.name)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)
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

/** Opens the current lecture's Design tab — only reachable from a lecture's
 * own `/d/:slug` page, never from a design's own `/t/:slug`. */
const openLectureDesignTab = async (page: Page) => {
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  await page.getByRole('tab', { name: 'Design' }).click()
}

/** Casts a vote and waits for its own request to settle before returning —
 * `aria-pressed` flips optimistically, so proceeding (a reload especially)
 * before the request lands can cancel it mid-flight. */
const castAndSettle = async (
  page: Page,
  button: ReturnType<Page['getByRole']>,
) => {
  await Promise.all([
    page.waitForResponse(
      res =>
        res.url().includes('/api/actions/template.vote') &&
        res.status() === 200,
    ),
    button.click(),
  ])
}

/** A button's own visible count, read before voting so a built-in's total —
 * shared by every account, and persisted across e2e runs — can be asserted
 * as "+1", never as an absolute the rest of the suite does not own. */
const countOf = async (
  button: ReturnType<Page['getByRole']>,
): Promise<number> => Number((await button.textContent())?.trim())

test('template voting: cast, persist, change, and the owner’s own tally (TMPL-27)', async ({
  browser,
}) => {
  const ownerPage = await newUserPage(browser, owner)
  const voterPage = await newUserPage(browser, voter)

  // Sharing (and making the design public) needs the owner's address
  // confirmed (AUTH-3), the same gate template-sharing.spec.ts exercises.
  await verifyEmail(ownerPage, owner.email)
  await verifyEmail(voterPage, voter.email)

  // The owner needs a design of their own, shared with the voter — a
  // design's own page is not otherwise reachable, and a design not shared
  // does not show up in anyone else's Design tab library (only own, shared,
  // and built-in templates do).
  await createProject(ownerPage, ownerProject)
  await ownerPage
    .getByRole('button', { name: `Start a new lecture in ${ownerProject}` })
    .click()
  await expect(ownerPage).toHaveURL(/\/d\//)
  await ownerPage.getByRole('button', { name: 'Start lecture' }).click()
  // The owner's own lecture, to come back to once the design page's own
  // business is done — Lecture settings only exists on this page, not on
  // the design's `/t/:slug`.
  const ownerLectureUrl = ownerPage.url()

  await openLectureDesignTab(ownerPage)
  await ownerPage
    .getByRole('button', { name: /^Duplicate / })
    .first()
    .click()
  await expect(ownerPage).toHaveURL(/\/t\//)
  await ownerPage.getByLabel('Template name').fill(designName)
  await ownerPage.getByRole('button', { name: 'Save' }).click()
  await expect(ownerPage.getByTestId('template-saved')).toHaveText('Saved')
  const designUrl = ownerPage.url()

  // Public, and shared with the voter as a viewer — the sharing panel on
  // the design's own page, same controls template-sharing.spec.ts drives.
  await ownerPage.getByRole('radio', { name: /public/i }).click()
  await expect(ownerPage.getByRole('radio', { name: /public/i })).toBeChecked()
  await ownerPage.getByLabel('Add people by email').fill(voter.email)
  await ownerPage.getByLabel('Access role').selectOption('viewer')
  await ownerPage.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(ownerPage.getByText(voter.name, { exact: true })).toBeVisible()

  // The voter's own lecture, whose Design tab shows the built-ins and the
  // design the owner just shared.
  await createProject(voterPage, voterProject)
  await voterPage
    .getByRole('button', { name: `Start a new lecture in ${voterProject}` })
    .click()
  await expect(voterPage).toHaveURL(/\/d\//)
  await voterPage.getByRole('button', { name: 'Start lecture' }).click()
  await openLectureDesignTab(voterPage)

  // Every button carries its own design's name in its accessible name
  // ("Upvote {name}", TMPL-27), which is unique per card — so a button is
  // found directly by its full name rather than by first locating the
  // card's container (the vote row is a sibling of the card's radio, not a
  // descendant of it, so `radio.locator('..')` does not reach it).
  await expect(voterPage.getByText(designName)).toBeVisible()
  const builtinUpvote = voterPage.getByRole('button', {
    name: 'Upvote Classic',
  })
  const sharedUpvote = voterPage.getByRole('button', {
    name: `Upvote ${designName}`,
  })
  await expect(builtinUpvote).toBeVisible()
  await expect(sharedUpvote).toBeVisible()

  // A built-in's own tally is shared by every account and persists across
  // e2e runs, so only the *change* this vote makes is this test's to own.
  const builtinBefore = await countOf(builtinUpvote)

  await castAndSettle(voterPage, builtinUpvote)
  await expect(builtinUpvote).toHaveAttribute('aria-pressed', 'true')
  await castAndSettle(voterPage, sharedUpvote)
  await expect(sharedUpvote).toHaveAttribute('aria-pressed', 'true')

  // Reloading refetches the library from the server: the vote is the
  // account's, not just this page's optimistic state.
  await voterPage.reload()
  await openLectureDesignTab(voterPage)
  const builtinUpvoteAfter = voterPage.getByRole('button', {
    name: 'Upvote Classic',
  })
  const sharedUpvoteAfter = voterPage.getByRole('button', {
    name: `Upvote ${designName}`,
  })
  await expect(builtinUpvoteAfter).toHaveAttribute('aria-pressed', 'true')
  expect(await countOf(builtinUpvoteAfter)).toBe(builtinBefore + 1)
  // The shared design was created fresh in this test, so its total is this
  // test's alone to assert as an absolute.
  await expect(sharedUpvoteAfter).toHaveAttribute('aria-pressed', 'true')
  await expect(sharedUpvoteAfter).toHaveText('1')

  // On the shared design's own page, the voter changes their vote to a
  // downvote — a viewer may vote, the same rule that let them cast one from
  // the card.
  await voterPage.goto(designUrl)
  await expect(
    voterPage.getByRole('heading', { name: designName }),
  ).toBeVisible()
  const downvoteOnPage = voterPage.getByRole('button', {
    name: `Downvote ${designName}`,
  })
  const upvoteOnPage = voterPage.getByRole('button', {
    name: `Upvote ${designName}`,
  })
  await castAndSettle(voterPage, downvoteOnPage)
  await expect(downvoteOnPage).toHaveAttribute('aria-pressed', 'true')
  await expect(upvoteOnPage).toHaveAttribute('aria-pressed', 'false')

  // The owner sees a tally on their own design's own page — never buttons
  // to vote on their own work — reflecting the voter's downvote.
  await ownerPage.reload()
  await expect(
    ownerPage.getByRole('button', { name: `Upvote ${designName}` }),
  ).toHaveCount(0)
  await expect(
    ownerPage.getByRole('button', { name: `Downvote ${designName}` }),
  ).toHaveCount(0)
  await expect(ownerPage.getByText('1 vote')).toBeVisible()

  // The same trade on the library card, back on the owner's own lecture —
  // the only page that offers "Lecture settings".
  await ownerPage.goto(ownerLectureUrl)
  await openLectureDesignTab(ownerPage)
  await expect(
    ownerPage.getByRole('button', { name: `Upvote ${designName}` }),
  ).toHaveCount(0)
  await expect(ownerPage.getByText('1 vote')).toBeVisible()
})
