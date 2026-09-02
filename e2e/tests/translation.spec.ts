/**
 * Post-lecture translated viewing end to end (SHARE-2): a visitor arriving
 * through a shared permalink switches the slide language, reads the
 * translated text, and switches back to the authored original — which is
 * unchanged, because a translation is a layer over the deck and never a
 * rewrite of it.
 *
 * Translated viewing needs an account (AUTH-8): the first test's visitor
 * reaches the permalink signed out, is offered the sign-in dialog instead of
 * the language menu, and signs in through it — on the spot, same lecture —
 * before the rest of the scenario below is unchanged from before that
 * requirement.
 *
 * TRANSLATION_PROVIDER is `mock` here (see playwright.config), which tags each
 * translated segment with `[<locale>]`, so the assertions are exact.
 */
import { test, expect, type Page } from './fixtures'
import { createProject, verifyEmail } from './helpers'

const stamp = Date.now()
const author = { email: `translate-${stamp}@example.com`, name: 'Author' }
const visitor = {
  email: `translate-visitor-${stamp}@example.com`,
  name: 'Visitor',
}
const password = 'sturdy-passw0rd'

const register = async (page: Page, user: { email: string; name: string }) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill(user.name)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)
  // Sharing needs a confirmed address: an unconfirmed account's projects
  // start restricted (AUTH-3).
  await verifyEmail(page, user.email)
}

test('translated viewing: switch language, read, and return to the original', async ({
  browser,
}) => {
  const authorContext = await browser.newContext()
  const authorPage = await authorContext.newPage()
  await register(authorPage, author)

  // A one-slide public lecture
  await createProject(authorPage, 'TranslateProj')
  await authorPage
    .getByRole('button', { name: 'Start a new lecture in TranslateProj' })
    .click()
  await expect(authorPage).toHaveURL(/\/d\//)
  await authorPage.getByRole('button', { name: 'Start lecture' }).click()
  await authorPage.getByLabel('Spoken phrase').fill('Wave basics')
  await authorPage.getByRole('button', { name: 'Speak' }).click()
  await expect(authorPage.getByTestId('slide')).toBeVisible()
  const deckUrl = authorPage.url()
  // The author's own view carries the editing chrome (empty-slot prompts like
  // "Click to add text"), so each side is compared against its own baseline
  // rather than against the other's. Baselines are read as textContent, which
  // is what toHaveText compares against — innerText would add the line breaks
  // it renders and never match.
  const authorOriginal =
    (await authorPage.getByTestId('slide').textContent()) ?? ''

  // A visitor with an account of their own, currently signed out, opens the
  // permalink — reading needs no account, so the lecture shows right away.
  const visitorContext = await browser.newContext()
  const visitorPage = await visitorContext.newPage()
  await register(visitorPage, visitor)
  await visitorPage.getByRole('button', { name: 'Menu' }).click()
  await visitorPage.getByRole('menuitem', { name: 'Log out' }).click()
  // Logging out from /app races RequireAuth's own redirect for where it
  // lands (/ or /login) — immaterial here, since the very next step
  // navigates on regardless; only that the session is gone matters.
  await expect(visitorPage).not.toHaveURL(/\/app$/)

  await visitorPage.goto(deckUrl)
  await expect(visitorPage.getByTestId('slide')).toBeVisible()
  const visitorOriginal =
    (await visitorPage.getByTestId('slide').textContent()) ?? ''

  // The switcher is offered, but reaching for it signed out raises the
  // sign-in dialog instead of the language menu (AUTH-8) — translated
  // viewing needs an account, unlike reading the lecture itself.
  const switcher = visitorPage.getByRole('button', { name: /Slide language/ })
  await expect(switcher).toBeVisible()
  await switcher.click()
  const gate = visitorPage.getByRole('dialog', {
    name: 'Translated viewing needs an account',
  })
  await expect(gate).toBeVisible()
  await expect(visitorPage.getByRole('menu')).toHaveCount(0)

  // Signs in on the spot, without leaving the lecture
  await gate.getByLabel('Email').fill(visitor.email)
  await gate.getByLabel('Password').fill(password)
  await gate.getByRole('button', { name: 'Sign in' }).click()
  await expect(gate).toHaveCount(0)
  await expect(visitorPage).toHaveURL(deckUrl)

  // Signing in did not open the language menu itself — that press is next
  await expect(visitorPage.getByRole('menu')).toHaveCount(0)
  await switcher.click()
  await visitorPage.getByRole('menuitemradio', { name: /Français/ }).click()

  // The slide now reads in French, and says it is a machine translation
  await expect(visitorPage.getByTestId('slide')).toContainText('[fr]')
  await expect(visitorPage.getByText(/Machine-translated/)).toBeVisible()

  // Editing is not offered to a viewer reading a translation
  await expect(
    visitorPage.getByRole('button', { name: 'Add slide', exact: true }),
  ).toHaveCount(0)

  // The choice survives a reload
  await visitorPage.reload()
  await expect(visitorPage.getByTestId('slide')).toContainText('[fr]')

  // Back to the original: the authored words are intact
  await visitorPage.getByRole('button', { name: /Slide language/ }).click()
  await visitorPage.getByRole('menuitemradio', { name: /Original/ }).click()
  await expect(visitorPage.getByTestId('slide')).not.toContainText('[fr]')
  await expect(visitorPage.getByTestId('slide')).toHaveText(visitorOriginal)

  // And the author's own deck was never modified
  await authorPage.reload()
  await expect(authorPage.getByTestId('slide')).toHaveText(authorOriginal)
})

test('translated viewing: an editor cannot edit while reading a translation', async ({
  browser,
}) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await register(page, {
    email: `translate-editor-${stamp}@example.com`,
    name: 'Editor',
  })

  await createProject(page, 'EditorProj')
  await page
    .getByRole('button', { name: 'Start a new lecture in EditorProj' })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Start lecture' }).click()
  await page.getByLabel('Spoken phrase').fill('Wave basics')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toBeVisible()

  // The live session opened by "Start lecture" is still running here
  await expect(
    page.getByRole('button', { name: 'Live session' }),
  ).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: /Slide language/ }).click()
  await page.getByRole('menuitemradio', { name: /Español/ }).click()
  await expect(page.getByTestId('slide')).toContainText('[es]')

  // Speaking new slides into the deck is editing, so it goes quiet with the
  // rest of it — and the session that was running ends rather than recording
  // on with no control left to stop it
  await expect(page.getByRole('button', { name: 'Live session' })).toHaveCount(
    0,
  )
  await expect(
    page.getByRole('textbox', { name: 'Spoken phrase' }),
  ).toHaveCount(0)

  // The owner is told why the editing surface has gone quiet, and can undo it
  await expect(page.getByText(/editing is off/)).toBeVisible()
  await page.getByRole('button', { name: 'Show original' }).click()
  await expect(page.getByTestId('slide')).not.toContainText('[es]')

  // Back on the original the microphone is offered again, switched off
  await expect(
    page.getByRole('button', { name: 'Live session' }),
  ).toHaveAttribute('aria-pressed', 'false')
})

test('translated narration: the deck is heard in the language it is read in', async ({
  browser,
}) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await register(page, {
    email: `translate-narration-${stamp}@example.com`,
    name: 'Narrator',
  })

  await createProject(page, 'NarrationProj')
  await page
    .getByRole('button', { name: 'Start a new lecture in NarrationProj' })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Start lecture' }).click()
  await page.getByLabel('Spoken phrase').fill('Wave basics')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toBeVisible()

  // What each synthesis was asked to speak, recorded off the wire — the locale
  // on the request is the whole of what PLAY-3 adds to playback.
  const spoken: Array<Record<string, unknown>> = []
  page.on('request', request => {
    if (request.url().includes('/tts') && request.method() === 'POST') {
      spoken.push(JSON.parse(request.postData() ?? '{}'))
    }
  })

  // Read in the original first: narration carries no language of its own.
  await page.getByRole('button', { name: 'Play deck' }).click()
  await expect
    .poll(() => spoken.length, { message: 'narration started' })
    .toBeGreaterThan(0)
  expect(spoken.every(s => s.locale === undefined)).toBe(true)

  // Now read it in French. Reloading first so narration starts from a clean
  // stop rather than resuming the clip that is already cued — and it proves
  // the remembered language survives the reload.
  await page.getByRole('button', { name: /Slide language/ }).click()
  await page.getByRole('menuitemradio', { name: /Français/ }).click()
  await expect(page.getByTestId('slide')).toContainText('[fr]')
  await page.reload()
  await expect(page.getByTestId('slide')).toContainText('[fr]')

  // The same control as before — no separate switch for sound, which is the
  // whole of what the requirement asks for.
  await page.getByRole('button', { name: 'Play deck' }).click()
  // Asserted as "some request asked for French" rather than by counting: a
  // request that is retried after a token refresh is sent twice, and the
  // duplicate is not what this test is about.
  await expect
    .poll(() => spoken.some(s => s.locale === 'fr'), {
      message: 'translated narration started',
    })
    .toBe(true)

  // It really played: a refusal would have put a message on screen instead.
  await expect(page.getByText(/Could not read this lecture aloud/)).toHaveCount(
    0,
  )
})
