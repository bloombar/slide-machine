/**
 * Shared e2e helpers.
 */
import { readFileSync } from 'node:fs'
import { expect, type Locator, type Page } from '@playwright/test'
import { MAIL_LOG } from '../playwright.config'

/**
 * Create a project through the home-page "New project" modal, reached from
 * the "+" menu beside the welcome heading. The app navigates to the new
 * project's page on submit, so this leaves `page` on /app/projects/:id.
 */
export async function createProject(
  page: Page,
  title: string,
  description?: string,
) {
  await page.getByRole('button', { name: 'Create new' }).click()
  await page.getByRole('menuitem', { name: 'New project' }).click()
  await page.getByLabel('Title').fill(title)
  if (description) {
    await page.getByLabel(/description/i).fill(description)
  }
  await page.getByRole('button', { name: 'Create project' }).click()
  await expect(page).toHaveURL(/\/app\/projects\//)
}

/**
 * Opens a project's settings from its kebab. Settings, sharing and delete
 * live in one menu per project — the same menu the home screen shows beside
 * each row — so the project page has no settings button of its own. The
 * kebab is named after the project because every lecture row carries one
 * too. Import is not in it on a project page; it is in the "+" menu there.
 */
export async function openProjectMenu(page: Page, projectTitle: string) {
  await page
    .getByRole('button', { name: `Options for ${projectTitle}` })
    .click()
}

export async function openProjectSettings(page: Page, projectTitle: string) {
  await openProjectMenu(page, projectTitle)
  await page.getByRole('menuitem', { name: 'Settings' }).click()
}

/**
 * Pins the account's default design (SPEC TMPL-24), so every project and
 * lecture the spec goes on to create starts from a known one.
 *
 * A spec that measures a design's geometry, or names its boxes, is a spec
 * about that design — and the deployment's default is a deployment's to
 * change. Saying which design the spec means is what keeps it true when it
 * does. Leaves the browser where it found it.
 */
export async function chooseAccountDesign(page: Page, design: RegExp) {
  // Registration redirects into the app; settling there first keeps the
  // navigation below from racing the sign-up that is still landing.
  await page.waitForURL(/\/app/)
  const back = page.url()
  await page.goto('/app/settings?tab=design')
  await page.getByRole('radio', { name: design }).click()
  await expect(page.getByRole('radio', { name: design })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  if (back && !back.endsWith('/app/settings?tab=design')) await page.goto(back)
}

/**
 * Confirms a freshly registered account by following the link the server
 * mailed it (AUTH-3).
 *
 * Specs that publish or share need this: an unconfirmed account's projects
 * start restricted, which is the point of the requirement. The link is read
 * out of the message the server actually sent — the token is stored hashed,
 * so there is nothing else to read — and matched by recipient, so parallel
 * specs cannot pick up each other's.
 */
export function verificationTokenFor(email: string): string {
  const log = readFileSync(MAIL_LOG, 'utf8')
  const forThisUser = log
    .split('\n---\n')
    .filter(block => block.includes(`to=${email}`))
    .at(-1)
  const token = forThisUser?.match(/\/verify-email\?token=(\S+)/)?.[1]
  if (!token) throw new Error(`no verification link was mailed to ${email}`)
  return decodeURIComponent(token)
}

export async function verifyEmail(page: Page, email: string) {
  // Confirming is a detour, so put the caller back where it was — otherwise
  // every spec would have to navigate home again afterwards.
  const wasAt = page.url()
  await page.goto(`/verify-email?token=${verificationTokenFor(email)}`)
  await expect(page.getByText(/your address is confirmed/i)).toBeVisible()
  await page.goto(wasAt)
}

/**
 * A layout's card in the "Change slide layout" dialog, by the layout's label.
 *
 * Named off the card's own `data-layout-label` rather than off its text. Each
 * card is a miniature slide above its name (EDIT-3), so the first line of a
 * card's text is the sample words in the preview, not the layout — and a name
 * pattern would match "Title" inside "Title 2" anyway.
 */
export function layoutCard(dialog: Locator, label: string): Locator {
  return dialog.locator(`[data-layout-label="${label}"]`)
}

/** Picks a layout in an open "Change slide layout" dialog by its label. */
export async function pickLayout(dialog: Locator, label: string) {
  const card = layoutCard(dialog, label)
  await expect(card, `no layout offered called "${label}"`).toHaveCount(1)
  await card.click()
}
