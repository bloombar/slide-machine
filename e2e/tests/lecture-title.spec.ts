/**
 * Lecture title end to end: an auto-titled lecture keeps REFINING its title
 * as more is spoken, and the General settings tab lets the user set the title
 * by hand — which locks it so the AI never overwrites it again.
 */
import { test, expect } from '@playwright/test'
import { createProject } from './helpers'

const speak = async (page: import('@playwright/test').Page, phrase: string) => {
  await page.getByLabel('Spoken phrase').fill(phrase)
  await page.getByRole('button', { name: 'Speak' }).click()
}

test('auto-title refines, then a settings edit locks it', async ({ page }) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Titler')
  await page.getByLabel('Email').fill(`title-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()
  await createProject(page, 'TitleProj')
  await page
    .getByRole('button', { name: 'Start a new lecture in TitleProj' })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Start lecture' }).click()

  // Second phrase earns a title (mock needs prior context)
  await speak(page, 'Photosynthesis basics')
  await expect(page.getByTestId('slide')).toBeVisible()
  await speak(page, 'Plants convert light into energy')
  await expect(
    page.getByRole('heading', {
      name: 'Plants Convert Light Into Energy',
      level: 1,
    }),
  ).toBeVisible()

  // Third phrase REFINES the auto-title rather than freezing it
  await speak(page, 'Chlorophyll absorbs red and blue light')
  await expect(
    page.getByRole('heading', {
      name: 'Chlorophyll Absorbs Red And Blue',
      level: 1,
    }),
  ).toBeVisible()

  // Set the title by hand in General settings
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Lecture settings' })
  const titleInput = settings.getByRole('textbox', { name: 'Lecture title' })
  await titleInput.fill('My Custom Title')
  await titleInput.press('Enter')
  // Close the settings modal
  await settings.getByRole('button', { name: /Close/ }).click()
  await expect(
    page.getByRole('heading', { name: 'My Custom Title', level: 1 }),
  ).toBeVisible()

  // Speaking more never overwrites the user's chosen title
  await speak(page, 'Water splits to release oxygen gas')
  // The phrase is processed into a slide (proves the server handled it)...
  await expect(
    page.getByRole('heading', { name: /Water Splits/ }).first(),
  ).toBeVisible()
  // ...but the locked deck title (the level-1 heading) is untouched
  await expect(
    page.getByRole('heading', { name: 'My Custom Title', level: 1 }),
  ).toBeVisible()
})
