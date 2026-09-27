/**
 * The Design Templates page end to end (TMPL-28): every design the caller
 * can browse, at `/app/templates`, reached from the hamburger menu — Latest
 * (built-ins and public designs, never a restricted one), Top (a vote moves
 * a design's own tally), Mine (owned or shared, never a stranger's public
 * design), search, and infinite scroll past a first page. A card's creator
 * link, its Duplicate, and its Back-returns-here navigation are the same
 * ones `template-library.spec.ts` and `template-sharing.spec.ts` already
 * check from the Design tab — this only checks they still work from the
 * page built around them.
 *
 * The e2e database persists across runs, so nothing here counts a global
 * total: every design this test needs is created fresh, named with this
 * run's own stamp, and found again by searching for that stamp rather than
 * by position in an unscoped list.
 */
import { test, expect, type Browser, type Page } from './fixtures'
import { createProject, openProjectSettings, verifyEmail } from './helpers'

const stamp = Date.now()
const owner = { email: `tmplpage-owner-${stamp}@example.com`, name: 'Curator' }
const guest = { email: `tmplpage-guest-${stamp}@example.com`, name: 'Browser' }
const password = 'sturdy-passw0rd'
const ownerProject = `TmplPageOwner${stamp}`
const guestProject = `TmplPageGuest${stamp}`

const publicName = `Public Design ${stamp}`
const restrictedName = `Restricted Design ${stamp}`
const sharedName = `Shared Design ${stamp}`
const deletableName = `Deletable Design ${stamp}`
const bulkName = (i: number) => `Bulk Design ${stamp} #${i}`
// One more than DISCOVER_PAGE_SIZE (10), so the first page never holds all
// of them and "Load more" has something to reveal.
const BULK_COUNT = 11

const register = async (page: Page, user: { email: string; name: string }) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill(user.name)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)
}

const newUserPage = async (
  browser: Browser,
  user: { email: string; name: string },
): Promise<Page> => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await register(page, user)
  return page
}

/** Lands on a project's Design tab, from that project's own page — the
 * same route `template-library.spec.ts` and `template-sharing.spec.ts` take. */
const openDesignTab = async (
  page: Page,
  projectUrl: string,
  projectTitle: string,
) => {
  await page.goto(projectUrl)
  await openProjectSettings(page, projectTitle)
  await page.getByRole('tab', { name: 'Design' }).click()
}

/** Duplicates a shipped template from a project's Design tab, renames it,
 * saves, and returns the design's own URL. */
const duplicateAsDesign = async (
  page: Page,
  projectUrl: string,
  projectTitle: string,
  name: string,
): Promise<string> => {
  await openDesignTab(page, projectUrl, projectTitle)
  await page
    .getByRole('button', { name: /^Duplicate / })
    .first()
    .click()
  await expect(page).toHaveURL(/\/t\//)
  await page.getByLabel('Template name').fill(name)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('template-saved')).toHaveText('Saved')
  return page.url()
}

/** Makes the design at the page's current `/t/:slug` public. */
const makePublic = async (page: Page) => {
  await page.getByRole('radio', { name: /public/i }).click()
  await expect(page.getByRole('radio', { name: /public/i })).toBeChecked()
}

/** Opens `/app/templates` and searches it down to whatever the stamped
 * query narrows to — every assertion here reads only rows this run made. */
const searchTemplatesPage = async (page: Page, query: string) => {
  await page.goto('/app/templates')
  await page.getByRole('searchbox').fill(query)
}

test('design templates page: browse, vote, mine, search, and manage designs (TMPL-28)', async ({
  browser,
}) => {
  const ownerPage = await newUserPage(browser, owner)
  const guestPage = await newUserPage(browser, guest)

  // Publishing and sharing both need the owner's address confirmed
  // (AUTH-3), the same gate `template-sharing.spec.ts` exercises.
  await verifyEmail(ownerPage, owner.email)

  await createProject(ownerPage, ownerProject)
  const ownerProjectUrl = ownerPage.url()
  await createProject(guestPage, guestProject)

  await test.step('the owner builds the designs this run needs', async () => {
    await duplicateAsDesign(
      ownerPage,
      ownerProjectUrl,
      ownerProject,
      publicName,
    )
    await makePublic(ownerPage)

    // Left restricted (the default) — never shown to anyone but the owner.
    await duplicateAsDesign(
      ownerPage,
      ownerProjectUrl,
      ownerProject,
      restrictedName,
    )

    await duplicateAsDesign(
      ownerPage,
      ownerProjectUrl,
      ownerProject,
      sharedName,
    )
    await ownerPage.getByLabel('Add people by email').fill(guest.email)
    await ownerPage.getByLabel('Access role').selectOption('editor')
    await ownerPage.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(ownerPage.getByText(guest.name, { exact: true })).toBeVisible()

    await duplicateAsDesign(
      ownerPage,
      ownerProjectUrl,
      ownerProject,
      deletableName,
    )
    await makePublic(ownerPage)

    for (let i = 1; i <= BULK_COUNT; i++) {
      await duplicateAsDesign(
        ownerPage,
        ownerProjectUrl,
        ownerProject,
        bulkName(i),
      )
      await makePublic(ownerPage)
    }
  })

  await test.step('reached from the hamburger menu', async () => {
    await guestPage.goto('/app')
    await guestPage.getByRole('button', { name: 'Menu' }).click()
    await guestPage.getByRole('menuitem', { name: 'Design Templates' }).click()
    await expect(guestPage).toHaveURL(/\/app\/templates$/)
  })

  await test.step('Latest shows built-ins and a public design, never a restricted one', async () => {
    await searchTemplatesPage(guestPage, publicName)
    await expect(guestPage.getByText(publicName)).toBeVisible()

    await searchTemplatesPage(guestPage, restrictedName)
    await expect(guestPage.getByText(restrictedName)).not.toBeVisible()

    // A built-in — shipped with every deployment, never owned by anyone —
    // still shows up on Latest.
    await searchTemplatesPage(guestPage, 'Classic')
    await expect(guestPage.getByText('Classic', { exact: true })).toBeVisible()
  })

  await test.step("clicking the creator's name goes to their profile", async () => {
    await searchTemplatesPage(guestPage, publicName)
    const card = guestPage
      .locator('[data-template-card]')
      .filter({ hasText: publicName })
    const creatorLink = card.getByRole('link', { name: owner.name })
    await expect(creatorLink).toBeVisible()
    await creatorLink.click()
    await expect(guestPage).toHaveURL(/\/u\//)
    await expect(
      guestPage.getByRole('heading', { name: owner.name }),
    ).toBeVisible()
  })

  await test.step('Top reflects a vote', async () => {
    await searchTemplatesPage(guestPage, publicName)
    const upvote = guestPage.getByRole('button', {
      name: `Upvote ${publicName}`,
    })
    await Promise.all([
      guestPage.waitForResponse(
        res =>
          res.url().includes('/api/actions/template.vote') &&
          res.status() === 200,
      ),
      upvote.click(),
    ])
    await expect(upvote).toHaveAttribute('aria-pressed', 'true')
    await expect(upvote).toHaveText('1')

    // Reload under Top: the freshly-voted design is this run's alone, so its
    // exact count (not merely "present") is safe to assert.
    await guestPage.goto('/app/templates')
    await guestPage.getByRole('button', { name: 'Top' }).click()
    await guestPage.getByRole('searchbox').fill(publicName)
    await expect(
      guestPage.getByRole('button', { name: `Upvote ${publicName}` }),
    ).toHaveText('1')
  })

  await test.step('Mine shows only the caller’s own and shared designs', async () => {
    await guestPage.goto('/app/templates')
    await guestPage.getByRole('button', { name: 'Mine' }).click()
    await guestPage.getByRole('searchbox').fill(sharedName)
    await expect(guestPage.getByText(sharedName)).toBeVisible()

    await guestPage.getByRole('searchbox').fill(publicName)
    // Public, but never shared with the guest and not theirs — Mine omits it
    // even though Latest shows it.
    await expect(guestPage.getByText(publicName)).not.toBeVisible()
  })

  await test.step('search narrows the list', async () => {
    await searchTemplatesPage(guestPage, `Bulk Design ${stamp}`)
    await expect(guestPage.getByText(bulkName(1))).toBeVisible()
    await expect(guestPage.getByText(restrictedName)).not.toBeVisible()
  })

  await test.step('infinite scroll loads a second page', async () => {
    await searchTemplatesPage(guestPage, `Bulk Design ${stamp}`)
    await expect(guestPage.getByText(bulkName(1))).toBeVisible()
    // Ten to a page (DISCOVER_PAGE_SIZE): the eleventh is not there yet.
    await expect(guestPage.getByText(bulkName(BULK_COUNT))).toHaveCount(0)
    await guestPage.getByRole('button', { name: /load more/i }).click()
    await expect(guestPage.getByText(bulkName(BULK_COUNT))).toBeVisible()
  })

  await test.step('a card opens the design, and Back returns to this page', async () => {
    await searchTemplatesPage(guestPage, publicName)
    await guestPage.getByRole('radio', { name: new RegExp(publicName) }).click()
    await expect(guestPage).toHaveURL(/\/t\//)
    await guestPage.getByRole('button', { name: 'Back' }).click()
    await expect(guestPage).toHaveURL(/\/app\/templates$/)
  })

  await test.step('Duplicate lands in the editor for the copy', async () => {
    await searchTemplatesPage(guestPage, publicName)
    await guestPage.getByLabel(`Duplicate ${publicName}`).click()
    await expect(guestPage).toHaveURL(/\/t\//)
    // The copy is the guest's own, so they land in the editor, not the
    // read-only view a design they merely duplicated used to show them.
    await expect(guestPage.getByLabel('Template name')).toBeVisible()
  })

  await test.step('the owner can delete their own design from the page', async () => {
    await ownerPage.goto('/app/templates')
    await ownerPage.getByRole('button', { name: 'Mine' }).click()
    await ownerPage.getByRole('searchbox').fill(deletableName)
    await expect(ownerPage.getByText(deletableName)).toBeVisible()
    await ownerPage.getByLabel(`Delete ${deletableName}`).click()
    await ownerPage.getByRole('button', { name: 'Delete' }).click()
    await expect(ownerPage.getByText(deletableName)).not.toBeVisible()
  })
})
