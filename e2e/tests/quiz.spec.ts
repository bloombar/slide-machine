/**
 * Quiz tab end to end (QUIZ-1..6): an instructor opens a lecture's settings,
 * connects Google, generates a quiz (optionally folding in the transcript),
 * creates a Drive folder to save it in, gets a shareable Form URL with a
 * working copy button, and can delete the quiz. The Google side is mock-backed
 * (QUIZ_PROVIDER=mock), so the full flow runs with the live front/back end and
 * test DB.
 */
import { test, expect } from '@playwright/test'
import { createProject } from './helpers'

// The copy button writes to the clipboard, which headless Chromium blocks
// without an explicit grant.
test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

test('generate and publish a quiz from lecture settings', async ({ page }) => {
  // A lecture with one slide to quiz on
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Quizzer')
  await page.getByLabel('Email').fill(`quiz-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()
  await createProject(page, 'QuizProj')
  await page
    .getByRole('button', { name: 'Start a new lecture in QuizProj' })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Start lecture' }).click()
  await page
    .getByLabel('Spoken phrase')
    .fill('Photosynthesis happens in the chloroplasts')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toBeVisible()

  // Open the Quiz tab in lecture settings
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Lecture settings' })
  await dialog.getByRole('tab', { name: 'Quiz' }).click()

  // Not connected yet → connect, then generate
  await dialog.getByRole('button', { name: 'Connect Google' }).click()
  await dialog.getByRole('button', { name: 'Generate quiz' }).click()

  // Pick a Drive folder and set options
  const picker = page.getByRole('dialog', { name: 'Choose a Drive folder' })
  await expect(picker).toBeVisible()

  // Basic option: number of questions
  await picker.getByLabel('Number of questions').fill('3')

  // Advanced settings: the transcript option lives here (a phrase was spoken)
  await picker.getByRole('button', { name: 'Advanced settings' }).click()
  const includeTranscript = picker.getByRole('checkbox', {
    name: /include spoken transcript/i,
  })
  await expect(includeTranscript).toBeVisible()
  await includeTranscript.check()

  // Create a new destination folder; the finder steps into it, and we save there
  await picker.getByRole('button', { name: 'New folder' }).click()
  await picker.getByLabel('New folder name').fill('E2E Quizzes')
  await picker.getByRole('button', { name: 'Create' }).click()
  await expect(
    picker.getByRole('button', { name: 'E2E Quizzes' }),
  ).toBeVisible()

  await picker.getByRole('button', { name: 'Generate & save' }).click()

  // The shareable Form URL appears with a copy button
  const link = dialog.getByRole('link', { name: /forms/ })
  await expect(link).toBeVisible()
  expect(await link.getAttribute('href')).toMatch(/docs\.google\.com\/forms\//)
  await dialog.getByRole('button', { name: 'Copy quiz link' }).click()
  await expect(
    dialog.getByRole('button', { name: 'Link copied' }),
  ).toBeVisible()

  // It persists: reopening the Quiz tab still shows the URL
  await page.reload()
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  await dialog.getByRole('tab', { name: 'Quiz' }).click()
  await expect(dialog.getByRole('link', { name: /forms/ })).toBeVisible()

  // Deleting the quiz returns the tab to its generate state
  await dialog.getByRole('button', { name: /delete quiz/i }).click()
  await expect(
    dialog.getByRole('button', { name: 'Generate quiz' }),
  ).toBeVisible()
  await expect(dialog.getByRole('link', { name: /forms/ })).toBeHidden()
})
