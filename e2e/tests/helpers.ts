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
