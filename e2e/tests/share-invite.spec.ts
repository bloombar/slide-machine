/**
 * Share notifications and invitations end to end (SHARE-3).
 *
 * Two things a unit test cannot show together: that the person shared with
 * is actually emailed a working link, and that an address with no account
 * yet gets one too — the invitation becoming real access the moment they
 * register with it. `MAIL_PROVIDER=log` gives the run the same message text
 * a relay would have delivered, exactly as the AUTH-3 spec reads it.
 */
import { test, expect, type Page } from './fixtures'
import {
  chooseAccountDesign,
  createProject,
  lastMatch,
  mailTo,
  verifyEmail,
} from './helpers'

const stamp = Date.now()
const owner = { email: `inviter-${stamp}@example.com`, name: 'Inviter' }
// Never registered when the share is made: this is the invitation half.
const invitee = { email: `invitee-${stamp}@example.com`, name: 'Invitee' }
const password = 'sturdy-passw0rd'

/** The lecture link out of the share notification sent to an address. */
const sharedLinkTo = async (email: string): Promise<string> => {
  const link = () => lastMatch(mailTo(email), /(https?:\/\/\S*\/d\/\S+)/g)
  await expect
    .poll(link, { message: `no share notification was mailed to ${email}` })
    .not.toBe('')
  return link()
}

const register = async (page: Page, user: { email: string; name: string }) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill(user.name)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)
  await chooseAccountDesign(page, /classic/i)
}

test('share-invite: the invited address is emailed a link that works once they sign up', async ({
  browser,
}) => {
  const ownerContext = await browser.newContext()
  const ownerPage = await ownerContext.newPage()
  await register(ownerPage, owner)
  // Sharing with everyone needs a confirmed address (AUTH-3); restricting
  // the lecture below is what makes the invitation the only way in.
  await verifyEmail(ownerPage, owner.email)

  await createProject(ownerPage, 'InviteProj')
  await ownerPage
    .getByRole('button', { name: 'Start a new lecture in InviteProj' })
    .click()
  await expect(ownerPage).toHaveURL(/\/d\//)
  await ownerPage.getByRole('button', { name: 'Start lecture' }).click()
  await ownerPage.getByLabel('Spoken phrase').fill('Invitation basics')
  await ownerPage.getByRole('button', { name: 'Speak' }).click()
  await expect(ownerPage.getByTestId('slide')).toBeVisible()
  const deckUrl = ownerPage.url()

  // Restricted, so nothing but a real grant can open it
  await ownerPage.getByRole('button', { name: 'Lecture settings' }).click()
  await ownerPage.getByRole('tab', { name: 'Privacy & Sharing' }).click()
  await ownerPage.getByRole('radio', { name: /restricted/i }).click()
  await expect(
    ownerPage.getByRole('radio', { name: /restricted/i }),
  ).toBeChecked()

  // Share with an address that has no account: it is invited, not refused
  await ownerPage.getByLabel('Add people by email').fill(invitee.email)
  await ownerPage.getByLabel('Access role').selectOption('editor')
  await ownerPage.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(ownerPage.getByText('Invited')).toBeVisible()
  await expect(ownerPage.getByText(invitee.email)).toBeVisible()
  await ownerPage.getByRole('button', { name: 'Close settings' }).click()

  // The message that went out carries the link and says how to claim it
  const mailedLink = await sharedLinkTo(invitee.email)
  expect(mailedLink).toContain(new URL(deckUrl).pathname)
  expect(mailTo(invitee.email)).toContain('do not have a Slide Machine account')
  // The message names the step that actually grants access (SHARE-3)
  expect(mailTo(invitee.email)).toContain('confirm the address')

  // Following the link before signing up shows the same nothing-here answer
  // an outsider gets: an invitation is not access.
  const inviteeContext = await browser.newContext()
  const inviteePage = await inviteeContext.newPage()
  await inviteePage.goto(mailedLink)
  await expect(
    inviteePage.getByText('This deck does not exist or is private'),
  ).toBeVisible()

  // Registering is not enough — the address has to be confirmed, since
  // anyone can type any address into a sign-up form (SHARE-3).
  await register(inviteePage, invitee)
  await inviteePage.goto(mailedLink)
  await expect(
    inviteePage.getByText('This deck does not exist or is private'),
  ).toBeVisible()

  // Confirming it claims the invitation, and the link now opens
  await verifyEmail(inviteePage, invitee.email)
  await inviteePage.goto(mailedLink)
  await expect(inviteePage.getByTestId('slide')).toBeVisible()
  // Invited as an editor, so the editing controls are there
  await expect(
    inviteePage.getByRole('button', { name: 'Add slide', exact: true }),
  ).toHaveCount(1)

  // And the owner's people list now shows a person rather than an invitation
  await ownerPage.getByRole('button', { name: 'Lecture settings' }).click()
  await ownerPage.getByRole('tab', { name: 'Privacy & Sharing' }).click()
  await expect(ownerPage.getByText(invitee.name, { exact: true })).toBeVisible()
  await expect(ownerPage.getByText('Invited')).toHaveCount(0)
})
