/**
 * Post-lecture translated viewing end to end (SHARE-2): an anonymous visitor
 * arriving through a shared permalink switches the slide language, reads the
 * translated text, and switches back to the authored original — which is
 * unchanged, because a translation is a layer over the deck and never a
 * rewrite of it.
 *
 * TRANSLATION_PROVIDER is `mock` here (see playwright.config), which tags each
 * translated segment with `[<locale>]`, so the assertions are exact.
 */
import { test, autoAnswerAccountType, expect, type Page } from './fixtures'
import { createProject, verifyEmail } from './helpers'

const stamp = Date.now()
const author = { email: `translate-${stamp}@example.com`, name: 'Author' }
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
  await autoAnswerAccountType(authorPage)
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
  // "Add slide caption"), so each side is compared against its own baseline
  // rather than against the other's. Baselines are read as textContent, which
  // is what toHaveText compares against — innerText would add the line breaks
  // it renders and never match.
  const authorOriginal =
    (await authorPage.getByTestId('slide').textContent()) ?? ''

  // An anonymous visitor opens the permalink — no account, no sign-in
  const visitorContext = await browser.newContext()
  const visitorPage = await visitorContext.newPage()
  await visitorPage.goto(deckUrl)
  await expect(visitorPage.getByTestId('slide')).toBeVisible()
  const visitorOriginal =
    (await visitorPage.getByTestId('slide').textContent()) ?? ''

  // The switcher offers the deck's own language as "Original"
  const switcher = visitorPage.getByRole('button', { name: /Slide language/ })
  await expect(switcher).toBeVisible()
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
  await autoAnswerAccountType(page)
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
