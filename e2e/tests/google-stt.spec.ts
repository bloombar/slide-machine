/**
 * Real-time streaming STT end to end (mock transcription adapter + fake mic):
 * starting a lecture opens the mic, the browser streams audio over the
 * WebSocket to the server's streaming adapter, and the returned final phrase
 * flows through the same session.phrase pipeline into a generated slide —
 * proving the socket → capture → onPhrase path without hitting Google.
 *
 * Runs only under the 'chromium-stt' project (mock STT server + fake audio).
 */
import { test, expect } from './fixtures'
import { createProject } from './helpers'

const email = `stt-${Date.now()}@example.com`
const password = 'sturdy-passw0rd'

test('streamed speech generates a slide via the STT WebSocket', async ({
  page,
}) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Speaker One')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)

  await createProject(page, 'Biology 101')
  // Starting a lecture shows the pre-lecture seed dialog; "Start lecture"
  // dismisses it and opens the mic. The fake device then feeds audio and the
  // mock adapter returns the scripted final phrase "Photosynthesis basics".
  await page
    .getByRole('button', { name: 'Start a new lecture in Biology 101' })
    .click()
  await expect(page).toHaveURL(/\/d\/untitled-/)
  await page.getByRole('button', { name: 'Start lecture' }).click()

  // The streamed phrase becomes a slide (mock generator title-cases it).
  await expect(
    page.getByRole('heading', { name: 'Photosynthesis Basics' }),
  ).toBeVisible({ timeout: 15_000 })
})
