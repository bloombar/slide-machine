/**
 * The AI command-intent path end to end (GENERATION_VOICE_COMMANDS on,
 * mock generation provider): a spoken phrase with no wake word is
 * recognized server-side as a CAP-4 voice command and executed by the
 * client — navigating or adding a slide instead of generating content.
 */
import { test, expect } from '@playwright/test'
import { createProject } from './helpers'

const email = `voice-cmd-${Date.now()}@example.com`
const password = 'sturdy-passw0rd'

test('AI-recognized commands act on the deck without generating slides', async ({
  page,
}) => {
  // Register, create a project, start a lecture
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Voice Commander')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)
  await createProject(page, 'Chemistry 101')
  await page
    .getByRole('button', { name: 'Start a new lecture in Chemistry 101' })
    .click()
  await expect(page).toHaveURL(/\/d\/untitled-/)
  await page.getByRole('button', { name: 'Start lecture' }).click()

  // Two lecture phrases become two slides
  await page.getByLabel('Spoken phrase').fill('Chemical bonds')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(
    page.getByRole('heading', { name: 'Chemical Bonds' }),
  ).toBeVisible()
  await page
    .getByLabel('Spoken phrase')
    .fill('Bonds can be ionic, covalent, metallic')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByText('2 / 2')).toBeVisible()

  // "Please go back": recognized as a command — navigates, adds nothing
  await page.getByLabel('Spoken phrase').fill('Please go back')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByText('1 / 2')).toBeVisible()

  // And forward again
  await page.getByLabel('Spoken phrase').fill('Please next slide')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByText('2 / 2')).toBeVisible()

  // "Please new slide" appends a blank slide and moves to it
  await page.getByLabel('Spoken phrase').fill('Please new slide')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByText('3 / 3')).toBeVisible()

  // Ordinary lecture speech still generates content alongside commands
  await page
    .getByLabel('Spoken phrase')
    .fill('Ionic bonds transfer electrons between atoms completely')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByText('4 / 4')).toBeVisible()
})
