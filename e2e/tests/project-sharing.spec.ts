/**
 * Project-level privacy with lecture inheritance end to end (SHARE-1):
 * restricting a project hides its lectures from anonymous visitors; a
 * lecture-level override detaches one lecture from the cascade; "Use
 * project settings" re-attaches it.
 */
import { test, expect, type Browser, type Page } from '@playwright/test'

const stamp = Date.now()
const owner = { email: `powner-${stamp}@example.com`, name: 'Powner' }

const newUserPage = async (
  browser: Browser,
  user: { email: string; name: string },
): Promise<Page> => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/register')
  await page.getByLabel('Display name').fill(user.name)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.email)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)
  return page
}

test('project privacy cascades to lectures; overrides detach and reset', async ({
  browser,
}) => {
  const ownerPage = await newUserPage(browser, owner)
  const anonContext = await browser.newContext()
  const anonPage = await anonContext.newPage()

  // A project with one lecture, public by default
  await ownerPage.getByLabel('New project title').fill('CascadeProj')
  await ownerPage.getByRole('button', { name: 'Create' }).click()
  await ownerPage
    .getByRole('button', { name: 'Start a new lecture in CascadeProj' })
    .click()
  await expect(ownerPage).toHaveURL(/\/d\/untitled-/)
  const deckUrl = ownerPage.url()

  await anonPage.goto(deckUrl)
  await expect(anonPage.getByTestId('slide')).toHaveCount(0)
  await expect(anonPage.getByText('This deck has no slides.')).toBeVisible()

  // Restrict the PROJECT: the inheriting lecture goes dark
  await ownerPage.getByRole('link', { name: 'The Slide Machine' }).click()
  await ownerPage
    .getByRole('link', { name: 'CascadeProj', exact: true })
    .click()
  await ownerPage.getByRole('button', { name: 'Project settings' }).click()
  await ownerPage.getByRole('tab', { name: 'Privacy & Sharing' }).click()
  await ownerPage.getByRole('radio', { name: /restricted/i }).click()
  await expect(
    ownerPage.getByRole('radio', { name: /restricted/i }),
  ).toBeChecked()
  await ownerPage.getByRole('button', { name: 'Close settings' }).click()

  await anonPage.reload()
  await expect(
    anonPage.getByText('This deck does not exist or is private'),
  ).toBeVisible()

  // Override the LECTURE back to public: it detaches from the cascade
  await ownerPage.goto(deckUrl)
  await ownerPage.getByRole('button', { name: 'Lecture settings' }).click()
  await ownerPage.getByRole('tab', { name: 'Privacy & Sharing' }).click()
  await expect(ownerPage.getByText(/inherited from the project/i)).toBeVisible()
  await ownerPage.getByRole('radio', { name: /public/i }).click()
  await expect(
    ownerPage.getByText(/overridden for this lecture/i),
  ).toBeVisible()

  await anonPage.reload()
  await expect(anonPage.getByText('This deck has no slides.')).toBeVisible()

  // Reset to project settings: the (restricted) cascade applies again
  await ownerPage.getByRole('button', { name: 'Use project settings' }).click()
  await expect(ownerPage.getByText(/inherited from the project/i)).toBeVisible()
  await anonPage.reload()
  await expect(
    anonPage.getByText('This deck does not exist or is private'),
  ).toBeVisible()

  await anonContext.close()
})
