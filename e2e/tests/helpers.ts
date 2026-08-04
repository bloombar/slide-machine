/**
 * Shared e2e helpers.
 */
import { expect, type Page } from '@playwright/test'

/**
 * Create a project through the home-page "New project" modal. The app
 * navigates to the new project's page on submit, so this leaves `page`
 * on /app/projects/:id.
 */
export async function createProject(
  page: Page,
  title: string,
  description?: string,
) {
  await page.getByRole('button', { name: 'New project' }).click()
  await page.getByLabel('Title').fill(title)
  if (description) {
    await page.getByLabel(/description/i).fill(description)
  }
  await page.getByRole('button', { name: 'Create project' }).click()
  await expect(page).toHaveURL(/\/app\/projects\//)
}

/**
 * Opens a project's settings from its kebab. Settings, sharing, import and
 * delete all live in one menu per project — the same menu the home screen
 * shows beside each row — so the project page has no settings button of its
 * own. The kebab is named after the project because every lecture row carries
 * one too.
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
