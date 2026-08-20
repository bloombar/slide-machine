/**
 * Mid-speech interim generation end to end (GEN-12). Speech recognizers only
 * finalize a phrase after a trailing pause, so a speaker who never pauses got
 * no slides until now. With a stubbed Web Speech engine driving the real app
 * against the real server + mock generator, this proves:
 *
 * - a long uninterrupted interim transcript generates a slide BEFORE any
 *   finalized phrase exists, once its stable prefix passes the word threshold
 * - the eventual finalized phrase submits only the words not already flushed,
 *   so nothing reaches generation twice
 *
 * Runs in the default (browser STT) project; the stub stands in for
 * webkitSpeechRecognition and the test drives its onresult callback.
 */
import { test, expect } from './fixtures'
import { createProject } from './helpers'

const email = `interim-${Date.now()}@example.com`
const password = 'sturdy-passw0rd'

/** 45 words — past the pinned 40-word flush threshold once stable. */
const LECTURE =
  'the mitochondria is the powerhouse of the cell and it converts nutrients ' +
  'into usable chemical energy through a sequence of reactions known as ' +
  'cellular respiration which biologists study closely because energy ' +
  'management explains so much about how living systems grow adapt and ' +
  'survive over time'

test('long uninterrupted speech generates a slide before any final', async ({
  page,
}) => {
  // Stand in for the Web Speech API before the app loads: start() parks the
  // live instance on the window so the test can feed it recognition results.
  await page.addInitScript(() => {
    class FakeSpeechRecognition {
      continuous = false
      interimResults = false
      lang = ''
      onresult: ((e: unknown) => void) | null = null
      onerror: ((e: unknown) => void) | null = null
      onend: (() => void) | null = null
      start() {
        ;(window as unknown as { __rec: unknown }).__rec = this
      }
      stop() {}
    }
    // Chromium exposes both names and the app prefers SpeechRecognition,
    // so the stub must claim both.
    const w = window as unknown as {
      SpeechRecognition: unknown
      webkitSpeechRecognition: unknown
    }
    w.SpeechRecognition = FakeSpeechRecognition
    w.webkitSpeechRecognition = FakeSpeechRecognition
  })

  /** Feeds one recognition result (interim by default) to the live stub. */
  const hear = (transcript: string, isFinal = false) =>
    page.evaluate(
      ({ transcript, isFinal }) => {
        const rec = (
          window as unknown as {
            __rec: { onresult: ((e: unknown) => void) | null }
          }
        ).__rec
        rec.onresult?.({
          resultIndex: 0,
          results: [{ isFinal, 0: { transcript } }],
        })
      },
      { transcript, isFinal },
    )

  await page.goto('/register')
  await page.getByLabel('Display name').fill('Interim Speaker')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)

  await createProject(page, 'Cell Biology')
  await page
    .getByRole('button', { name: 'Start a new lecture in Cell Biology' })
    .click()
  await expect(page).toHaveURL(/\/d\/untitled-/)
  // "Start lecture" dismisses the seed dialog and opens the (stubbed) mic.
  await page.getByRole('button', { name: 'Start lecture' }).click()
  await page.waitForFunction(
    () => (window as unknown as { __rec?: unknown }).__rec !== undefined,
  )

  // The same interim twice: the second sighting makes all 45 words stable,
  // which clears the threshold — a slide generates with NO final ever sent.
  // Scoped to slides: the mock also suggests the deck title from each
  // phrase, so the page header would match these headings too.
  const slides = page.getByTestId('slide')
  await hear(LECTURE)
  await hear(LECTURE)
  await expect(
    slides.getByRole('heading', {
      name: 'The Mitochondria Is The Powerhouse',
    }),
  ).toBeVisible({ timeout: 15_000 })

  // The finalized utterance repeats everything plus a two-word tail; only
  // the tail generates (the mock renders the submitted phrase verbatim as
  // the slide body, so an exact match proves nothing was resubmitted).
  await hear(`${LECTURE} across generations`, true)
  await expect(
    slides.getByRole('heading', { name: 'Across Generations' }),
  ).toBeVisible({ timeout: 15_000 })
  await expect(
    slides.getByText('across generations', { exact: true }),
  ).toBeVisible()
})
