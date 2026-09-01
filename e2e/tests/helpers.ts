/**
 * Shared e2e helpers.
 */
import { existsSync, readFileSync } from 'node:fs'
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
 * Every message the log transport wrote to one address, as one string, or ''
 * if none has arrived yet. Each logged message is one `---` block, headed by
 * a line naming its recipient — so scoping by recipient is what keeps
 * parallel specs out of each other's mail, and is why a spec reading too
 * early waits instead of quietly answering with someone else's link.
 *
 * The trailing space matters: `to=` is followed by ` subject=`, so it pins
 * the whole address rather than matching one this is a prefix of.
 */
export function mailTo(email: string): string {
  const log = existsSync(MAIL_LOG) ? readFileSync(MAIL_LOG, 'utf8') : ''
  return log
    .split('\n---\n')
    .filter(block => block.includes(`to=${email} `))
    .join('\n')
}

/** The last match of `pattern`'s first group in `text`, or ''. */
export const lastMatch = (text: string, pattern: RegExp): string =>
  [...text.matchAll(pattern)].at(-1)?.[1] ?? ''

/**
 * Waits for the verification token the server mailed an address (AUTH-3).
 *
 * Specs that publish or share need it: an unconfirmed account's projects
 * start restricted, which is the point of the requirement. The token is
 * stored hashed, so the message is the only place it exists.
 *
 * This waits rather than reads once because registration hands the message
 * off without awaiting it — the 201 means the account exists, and the mail
 * follows a moment later. A spec that read on the very next line would find
 * nothing at all.
 */
export async function verificationTokenFor(email: string): Promise<string> {
  const token = () => lastMatch(mailTo(email), /\/verify-email\?token=(\S+)/g)
  await expect
    .poll(token, { message: `no verification link was mailed to ${email}` })
    .not.toBe('')
  return decodeURIComponent(token())
}

export async function verifyEmail(page: Page, email: string) {
  // Confirming is a detour, so put the caller back where it was — otherwise
  // every spec would have to navigate home again afterwards.
  const wasAt = page.url()
  await page.goto(`/verify-email?token=${await verificationTokenFor(email)}`)
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
