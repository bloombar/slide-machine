/**
 * The access-control system end to end (SHARE-1), with two users in
 * separate browser contexts: the owner shares a lecture for editing,
 * the collaborator edits it in place; private visibility hides the deck
 * and the profile without leaking existence; the public profile lists
 * only what the viewer may see.
 */
import { test, expect, type Browser, type Page } from './fixtures'
import { createProject, verifyEmail } from './helpers'

const stamp = Date.now()
const owner = { email: `owner-${stamp}@example.com`, name: 'Owner' }
const guest = { email: `guest-${stamp}@example.com`, name: 'Guest' }
const password = 'sturdy-passw0rd'

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

test('sharing: view/edit grants, private no-leak, public profile', async ({
  browser,
}) => {
  const ownerPage = await newUserPage(browser, owner)
  const guestPage = await newUserPage(browser, guest)

  // Owner builds a one-slide lecture
  await createProject(ownerPage, 'ShareProj')
  await ownerPage
    .getByRole('button', { name: 'Start a new lecture in ShareProj' })
    .click()
  await expect(ownerPage).toHaveURL(/\/d\//)
  // Dismiss the pre-lecture seed dialog
  await ownerPage.getByRole('button', { name: 'Start lecture' }).click()
  await ownerPage.getByTitle('Click to edit Lecture title').click()
  await ownerPage
    .getByRole('textbox', { name: 'Lecture title' })
    .fill('Shared Waves')
  await ownerPage.keyboard.press('Enter')
  await expect(
    ownerPage.getByRole('heading', { name: 'Shared Waves' }),
  ).toBeVisible()
  await ownerPage.getByLabel('Spoken phrase').fill('Wave basics')
  await ownerPage.getByRole('button', { name: 'Speak' }).click()
  await expect(ownerPage.getByTestId('slide')).toBeVisible()
  const deckUrl = ownerPage.url()

  // Public by default: the guest can view but sees no editing controls
  await guestPage.goto(deckUrl)
  await expect(guestPage.getByTestId('slide')).toBeVisible()
  await expect(
    guestPage.getByRole('button', { name: 'Add slide', exact: true }),
  ).toHaveCount(0)

  // Owner adds the guest as an editor under "People with access"
  await ownerPage.getByRole('button', { name: 'Lecture settings' }).click()
  await ownerPage.getByRole('tab', { name: 'Privacy & Sharing' }).click()
  await ownerPage.getByLabel('Add people by email').fill(guest.email)
  await ownerPage.getByLabel('Access role').selectOption('editor')
  await ownerPage.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(ownerPage.getByText(guest.name, { exact: true })).toBeVisible()
  await ownerPage.getByRole('button', { name: 'Close settings' }).click()

  // The guest can now edit the slide in place
  await guestPage.reload()
  await guestPage.getByTitle('Click to edit Slide title').click()
  await guestPage
    .getByRole('textbox', { name: 'Slide title' })
    .fill('Wave fundamentals')
  await guestPage.keyboard.press('Enter')
  await expect(
    guestPage.getByRole('heading', { name: 'Wave fundamentals' }),
  ).toBeVisible()

  // Owner flips general access to Restricted: an anonymous visitor
  // sees the same not-found message as for a nonexistent deck (no
  // leak), while the listed editor still gets in
  await ownerPage.getByRole('button', { name: 'Lecture settings' }).click()
  await ownerPage.getByRole('tab', { name: 'Privacy & Sharing' }).click()
  await ownerPage.getByRole('radio', { name: /restricted/i }).click()
  await expect(
    ownerPage.getByRole('radio', { name: /restricted/i }),
  ).toBeChecked()
  await ownerPage.getByRole('button', { name: 'Close settings' }).click()

  const anonContext = await browser.newContext()
  const anonPage = await anonContext.newPage()
  await anonPage.goto(deckUrl)
  await expect(
    anonPage.getByText('This deck does not exist or is private'),
  ).toBeVisible()
  await guestPage.reload()
  await expect(guestPage.getByTestId('slide')).toBeVisible()

  // Owner's profile, reached from the hamburger menu: only visible
  // lectures appear. The private deck is hidden from anonymous visitors
  // but shown to the editor.
  await ownerPage.getByRole('button', { name: 'Menu' }).click()
  await ownerPage.getByRole('menuitem', { name: 'Profile' }).click()
  await expect(
    ownerPage.getByRole('heading', { name: owner.name }),
  ).toBeVisible()
  const profileUrl = ownerPage.url()
  expect(profileUrl).toContain('/u/')

  await anonPage.goto(profileUrl)
  await expect(
    anonPage.getByRole('heading', { name: owner.name }),
  ).toBeVisible()
  await expect(anonPage.getByText('No lectures to show.')).toBeVisible()

  await guestPage.goto(profileUrl)
  await expect(
    guestPage.getByRole('link', { name: /Shared Waves/ }),
  ).toBeVisible()

  // The owner edits their display name and bio on the account settings page,
  // which is where every account setting now lives; visitors see the result.
  // Both fields commit on blur rather than behind a Save button.
  await ownerPage.goto('/app/settings')
  await ownerPage.getByLabel('Display name').fill(`${owner.name} Jr`)
  await ownerPage.getByLabel('Display name').blur()
  const bioSaved = ownerPage.waitForResponse(
    res => res.url().includes('user.updateProfile') && res.status() === 200,
  )
  await ownerPage.getByLabel('Bio').fill('Lectures on waves.')
  await ownerPage.getByLabel('Bio').blur()
  await bioSaved

  await ownerPage.goto(profileUrl)
  await expect(
    ownerPage.getByRole('heading', { name: `${owner.name} Jr` }),
  ).toBeVisible()

  await anonPage.reload()
  await expect(
    anonPage.getByRole('heading', { name: `${owner.name} Jr` }),
  ).toBeVisible()
  await expect(anonPage.getByText('Lectures on waves.')).toBeVisible()

  // Private profile reads as missing to others; the toggle lives on the
  // Privacy tab of the account settings page.
  await ownerPage.goto('/app/settings?tab=privacy')
  const profileToggle = ownerPage.getByRole('checkbox', {
    name: 'Public profile',
  })
  // Controlled input: it unticks when the save round-trips
  await profileToggle.click()
  await expect(profileToggle).not.toBeChecked()
  await anonPage.reload()
  await expect(
    anonPage.getByText('This profile does not exist or is private.'),
  ).toBeVisible()

  await anonContext.close()
})
