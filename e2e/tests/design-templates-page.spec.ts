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
 *
 * Every design but one is made through the action API rather than clicking
 * through the Design tab eleven-plus times over — register, verify, and
 * `template.duplicate`/`.setAccess`/`.share` directly, the way
 * `admin-usage-reset.spec.ts` and `admin-settings.spec.ts` set up their own
 * fixtures. One (`publicName`) still goes through the UI, so this spec keeps
 * covering the real duplicate-rename-save-publish path at least once.
 */
import { test, expect, type Page } from './fixtures'
import {
  createProject,
  openProjectSettings,
  verificationTokenFor,
} from './helpers'

const stamp = Date.now()
const owner = { email: `tmplpage-owner-${stamp}@example.com`, name: 'Curator' }
const guest = { email: `tmplpage-guest-${stamp}@example.com`, name: 'Browser' }
const password = 'sturdy-passw0rd'
const ownerProject = `TmplPageOwner${stamp}`

const publicName = `Public Design ${stamp}`
const restrictedName = `Restricted Design ${stamp}`
const sharedName = `Shared Design ${stamp}`
const deletableName = `Deletable Design ${stamp}`
// A shared, literal substring (`template.search` matches the query as one
// contiguous run of characters, never as separate words), so one search
// finds both and their relative order is what tells Top and Latest apart —
// created in this order (high, then low) so the two sorts disagree about
// which comes first even before either is voted on: Latest (newest first)
// starts them low-before-high, and voting up the high one is what should
// flip that under Top.
const highScoreName = `Top Order ${stamp} High`
const lowScoreName = `Top Order ${stamp} Low`
// Zero-padded and two digits wide throughout, so "#1" is never a substring
// of "#10" or "#11" — a plain `getByText` would otherwise match more than
// one row and a stray one-item assertion would pass for the wrong reason.
const bulkName = (i: number) =>
  `Bulk Design ${stamp} #${String(i).padStart(2, '0')}`
// One more than DISCOVER_PAGE_SIZE (10), so the first page never holds all
// of them and "Load more" has something to reveal.
const BULK_COUNT = 11

/** Registers an account through the API and returns what the rest of this
 * spec needs from it — its id (for the profile-link check) and an access
 * token (for the API calls that build its designs). Leaves `page` signed in:
 * registering sets the refresh cookie in `page`'s own browser context, so a
 * plain `page.goto('/app')` afterwards is already authenticated, the same
 * way `admin-usage-reset.spec.ts`'s `ensureSignedIn` works. */
const apiRegister = async (
  page: Page,
  user: { email: string; name: string },
): Promise<{ id: string; accessToken: string }> => {
  const res = await page.request.post('/api/auth/register', {
    data: { email: user.email, password, displayName: user.name },
  })
  expect(res.status()).toBe(201)
  const body = (await res.json()) as {
    user: { id: string }
    accessToken: string
  }
  await page.goto('/app')
  await expect(page).toHaveURL(/\/app$/)
  return { id: body.user.id, accessToken: body.accessToken }
}

/** Confirms an address via the API (AUTH-3), the same call
 * `admin-settings.spec.ts` makes rather than clicking the mailed link. */
const apiVerifyEmail = async (page: Page, email: string) => {
  const res = await page.request.post('/api/auth/verify-email', {
    data: { token: await verificationTokenFor(email) },
  })
  expect(res.status()).toBe(200)
}

/** Duplicates the "classic" built-in via the API, named for this run, and
 * returns the copy's id and permalink. */
const apiDuplicate = async (
  page: Page,
  accessToken: string,
  name: string,
): Promise<{ id: string; permalinkSlug: string }> => {
  const res = await page.request.post('/api/actions/template.duplicate', {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { templateId: 'classic', name },
  })
  expect(res.status()).toBe(200)
  return (await res.json()) as { id: string; permalinkSlug: string }
}

const apiSetAccess = async (
  page: Page,
  accessToken: string,
  templateId: string,
  visibility: 'public' | 'restricted',
) => {
  const res = await page.request.post('/api/actions/template.setAccess', {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { templateId, visibility },
  })
  expect(res.status()).toBe(200)
}

const apiShare = async (
  page: Page,
  accessToken: string,
  templateId: string,
  email: string,
  role: 'viewer' | 'editor',
) => {
  const res = await page.request.post('/api/actions/template.share', {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { templateId, email, role },
  })
  expect(res.status()).toBe(200)
}

/** Lands on a project's Design tab, from that project's own page — the
 * same route `template-library.spec.ts` and `template-sharing.spec.ts` take. */
const openDesignTab = async (page: Page, projectUrl: string) => {
  await page.goto(projectUrl)
  await openProjectSettings(page, ownerProject)
  await page.getByRole('tab', { name: 'Design' }).click()
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
  const ownerContext = await browser.newContext()
  const ownerPage = await ownerContext.newPage()
  const guestContext = await browser.newContext()
  const guestPage = await guestContext.newPage()

  const [ownerAuth] = await Promise.all([
    apiRegister(ownerPage, owner),
    apiRegister(guestPage, guest),
  ])

  // Publishing needs the owner's own address confirmed (AUTH-3); sharing
  // needs the *recipient's* confirmed too (SHARE-3, round 2) — an invite to
  // an unverified address is only a pending invitation, and Mine would not
  // list it, exactly as `template-sharing.spec.ts:49-50` notes.
  await apiVerifyEmail(ownerPage, owner.email)
  await apiVerifyEmail(guestPage, guest.email)

  await createProject(ownerPage, ownerProject)
  const ownerProjectUrl = ownerPage.url()

  await test.step('the owner builds the designs this run needs', async () => {
    // The one design made through the UI, exercising the real
    // duplicate-rename-save-publish path `template-library.spec.ts` and
    // `template-sharing.spec.ts` already check in full.
    await openDesignTab(ownerPage, ownerProjectUrl)
    await ownerPage
      .getByRole('button', { name: /^Duplicate / })
      .first()
      .click()
    await expect(ownerPage).toHaveURL(/\/t\//)
    await ownerPage.getByLabel('Template name').fill(publicName)
    await ownerPage.getByRole('button', { name: 'Save' }).click()
    await expect(ownerPage.getByTestId('template-saved')).toHaveText('Saved')
    await ownerPage.getByRole('radio', { name: /public/i }).click()
    await expect(
      ownerPage.getByRole('radio', { name: /public/i }),
    ).toBeChecked()

    // Everything else, through the API.
    // Left restricted (the default) — never shown to anyone but the owner.
    await apiDuplicate(ownerPage, ownerAuth.accessToken, restrictedName)

    const shared = await apiDuplicate(
      ownerPage,
      ownerAuth.accessToken,
      sharedName,
    )
    await apiShare(
      ownerPage,
      ownerAuth.accessToken,
      shared.id,
      guest.email,
      'editor',
    )

    const deletable = await apiDuplicate(
      ownerPage,
      ownerAuth.accessToken,
      deletableName,
    )
    await apiSetAccess(ownerPage, ownerAuth.accessToken, deletable.id, 'public')

    // The pair Top's order check votes on — high first, low second, so
    // Latest already orders them low-before-high before either is voted on.
    const high = await apiDuplicate(
      ownerPage,
      ownerAuth.accessToken,
      highScoreName,
    )
    await apiSetAccess(ownerPage, ownerAuth.accessToken, high.id, 'public')
    const low = await apiDuplicate(
      ownerPage,
      ownerAuth.accessToken,
      lowScoreName,
    )
    await apiSetAccess(ownerPage, ownerAuth.accessToken, low.id, 'public')

    // Sequential, not parallel: "Latest" orders by `updatedAt`, so #11 must
    // be the last one saved (and land on page one) and #01 the first (and
    // land on page two) — a `Promise.all` would race that order away.
    for (let i = 1; i <= BULK_COUNT; i++) {
      const bulk = await apiDuplicate(
        ownerPage,
        ownerAuth.accessToken,
        bulkName(i),
      )
      await apiSetAccess(ownerPage, ownerAuth.accessToken, bulk.id, 'public')
    }
  })

  await test.step('reached from the hamburger menu', async () => {
    await guestPage.goto('/app')
    await guestPage.getByRole('button', { name: 'Menu' }).click()
    await guestPage.getByRole('menuitem', { name: 'Design templates' }).click()
    await expect(guestPage).toHaveURL(/\/app\/templates$/)
  })

  await test.step('Latest shows built-ins and a public design, never a restricted one', async () => {
    await searchTemplatesPage(guestPage, publicName)
    await expect(guestPage.getByText(publicName)).toBeVisible()

    // "No matches" is itself the settled, positive proof of absence — a
    // second `not.toBeVisible()` on `restrictedName` would be redundant at
    // best, and at worst a false pass: the message's own text ("No matches
    // for “Restricted Design …”") contains the query, so a plain
    // `getByText(restrictedName)` matches the message paragraph itself.
    await searchTemplatesPage(guestPage, restrictedName)
    await expect(guestPage.getByText(/no matches for/i)).toBeVisible()

    // A built-in — shipped with every deployment, never owned by anyone —
    // still shows up on Latest.
    await searchTemplatesPage(guestPage, 'Classic')
    await expect(guestPage.getByText('Classic', { exact: true })).toBeVisible()
  })

  await test.step("search finds a design by its creator's name", async () => {
    // The owner's display name (`owner.name`), matched by `template.search`
    // alongside title and AI instructions (TMPL-28). The last bulk design is
    // the most recently saved of everything this owner made, so it is on
    // Latest's first page regardless of how many older designs of theirs
    // also match the same creator name.
    await searchTemplatesPage(guestPage, owner.name)
    await expect(
      guestPage.getByText(bulkName(BULK_COUNT), { exact: true }),
    ).toBeVisible()
    // The owner's restricted design shares the same creator name, but a
    // guest with no access to it must never see it surface this way either.
    await expect(guestPage.getByText(restrictedName)).not.toBeVisible()
  })

  await test.step("clicking the creator's name goes to their profile", async () => {
    await searchTemplatesPage(guestPage, publicName)
    const card = guestPage
      .locator('[data-template-card]')
      .filter({ hasText: publicName })
    const creatorLink = card.getByRole('link', { name: owner.name })
    await expect(creatorLink).toBeVisible()
    await creatorLink.click()
    await expect(guestPage).toHaveURL(new RegExp(`/u/${ownerAuth.id}$`))
    await expect(
      guestPage.getByRole('heading', { name: owner.name }),
    ).toBeVisible()
  })

  await test.step('a vote persists on the design it was cast on', async () => {
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

  await test.step('Top orders by score, differently from Latest', async () => {
    // A search naming both, so their relative order — not merely which is
    // present — is what this reads. Latest is newest first and the low
    // design was saved after the high one, so before either is voted on,
    // Latest already reads low-then-high.
    const cards = guestPage
      .locator('[data-template-card]')
      .filter({ hasText: 'Top Order' })
    await searchTemplatesPage(guestPage, `Top Order ${stamp}`)
    await expect(cards).toHaveCount(2)
    await expect(cards.nth(0)).toContainText(lowScoreName)
    await expect(cards.nth(1)).toContainText(highScoreName)

    const upvoteHigh = guestPage.getByRole('button', {
      name: `Upvote ${highScoreName}`,
    })
    await Promise.all([
      guestPage.waitForResponse(
        res =>
          res.url().includes('/api/actions/template.vote') &&
          res.status() === 200,
      ),
      upvoteHigh.click(),
    ])

    // Same search, Top instead of Latest: the design just voted up now
    // outranks the one nobody voted on — an order Latest never showed.
    await guestPage.goto('/app/templates')
    await guestPage.getByRole('button', { name: 'Top' }).click()
    await guestPage.getByRole('searchbox').fill(`Top Order ${stamp}`)
    await expect(cards).toHaveCount(2)
    await expect(cards.nth(0)).toContainText(highScoreName)
    await expect(cards.nth(1)).toContainText(lowScoreName)
  })

  await test.step('Mine shows only the caller’s own and shared designs', async () => {
    await guestPage.goto('/app/templates')
    await guestPage.getByRole('button', { name: 'Mine' }).click()
    await guestPage.getByRole('searchbox').fill(sharedName)
    await expect(guestPage.getByText(sharedName)).toBeVisible()

    // Public, but never shared with the guest and not theirs — Mine omits
    // it even though Latest shows it. "No matches" is the settled, positive
    // proof of that (see the Latest step's own comment on why a second,
    // plain-text absence check on top of it would be redundant, or worse).
    await guestPage.getByRole('searchbox').fill(publicName)
    await expect(guestPage.getByText(/no matches for/i)).toBeVisible()
  })

  await test.step('search narrows the list', async () => {
    await searchTemplatesPage(guestPage, `Bulk Design ${stamp}`)
    // #11 was saved last, so it is on Latest's first page regardless of how
    // many bulk designs exist — a settled, positive signal the later
    // absence check can be trusted against.
    await expect(
      guestPage.getByText(bulkName(BULK_COUNT), { exact: true }),
    ).toBeVisible()
    // `publicName` is a real design this run made, public, and shown on
    // Latest unfiltered — a query this narrow excluding it is the check
    // worth making; `restrictedName` never shows up here regardless of
    // whether search narrows anything at all, so asserting its absence
    // could not have failed either way.
    await expect(guestPage.getByText(publicName)).not.toBeVisible()
  })

  await test.step('infinite scroll loads a second page', async () => {
    await searchTemplatesPage(guestPage, `Bulk Design ${stamp}`)
    // Ten to a page (DISCOVER_PAGE_SIZE), newest first: #11 down to #02 are
    // on page one, and #01 — saved first, so ranked last — is not yet.
    //
    // `LoadMore`'s own IntersectionObserver can fire before this ever
    // clicks anything — the trigger sits within its rootMargin the moment
    // page one renders, in a real browser more readily than in a unit
    // test — so #01 is never asserted absent here; a moment that happened
    // to be read before the observer fired would make that pass by luck,
    // not by proof. The button, once page one has settled, is the only
    // trustworthy thing to wait on: if the observer already did the job,
    // it is gone (exhausted) by the time this looks; if not, this clicks it.
    await expect(
      guestPage.getByText(bulkName(BULK_COUNT), { exact: true }),
    ).toBeVisible()
    const loadMore = guestPage.getByRole('button', { name: /load more/i })
    if (await loadMore.isVisible()) await loadMore.click()
    await expect(
      guestPage.getByText(bulkName(1), { exact: true }),
    ).toBeVisible()
  })

  await test.step('a card opens the design, and Back returns to this page', async () => {
    await searchTemplatesPage(guestPage, publicName)
    await guestPage.getByRole('link', { name: new RegExp(publicName) }).click()
    await expect(guestPage).toHaveURL(/\/t\//)
    await guestPage.getByRole('button', { name: 'Back' }).click()
    await expect(guestPage).toHaveURL(/\/app\/templates$/)
    // The guest neither owns nor edits this built-in-derived public design,
    // so Back keeps the page's own default (Latest) rather than jumping to
    // "Mine" (TMPL-28).
    await expect(
      guestPage.getByRole('button', { name: 'Latest' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  await test.step('opening the owner’s own design and pressing Back lands on "Mine"', async () => {
    await ownerPage.goto('/app/templates')
    await ownerPage.getByRole('searchbox').fill(publicName)
    await ownerPage.getByRole('link', { name: new RegExp(publicName) }).click()
    await expect(ownerPage).toHaveURL(/\/t\//)
    await ownerPage.getByRole('button', { name: 'Back' }).click()
    await expect(ownerPage).toHaveURL(/\/app\/templates$/)
    // This is where the design just opened actually lives (TMPL-28) — the
    // owner's own library, not whichever sort the page happened to default
    // to before it was reached.
    await expect(
      ownerPage.getByRole('button', { name: 'Mine' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  await test.step('Duplicate lands in the editor for the copy, and Back from it lands on "Mine"', async () => {
    await searchTemplatesPage(guestPage, publicName)
    await guestPage.getByLabel(`Duplicate ${publicName}`).click()
    await expect(guestPage).toHaveURL(/\/t\//)
    // The copy is the guest's own, so they land in the editor, not the
    // read-only view a design they merely duplicated used to show them.
    await expect(guestPage.getByLabel('Template name')).toBeVisible()
    await guestPage.getByRole('button', { name: 'Back' }).click()
    await expect(guestPage).toHaveURL(/\/app\/templates$/)
    // The copy the guest just made is theirs, so Back lands them on "Mine",
    // where it lives — the same rule as opening an already-owned design.
    await expect(
      guestPage.getByRole('button', { name: 'Mine' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  await test.step('the owner can delete their own design from the page', async () => {
    await ownerPage.goto('/app/templates')
    await ownerPage.getByRole('button', { name: 'Mine' }).click()
    await ownerPage.getByRole('searchbox').fill(deletableName)
    await expect(ownerPage.getByText(deletableName)).toBeVisible()
    await ownerPage.getByLabel(`Delete ${deletableName}`).click()
    const dialog = ownerPage.getByRole('alertdialog')
    await dialog.getByRole('button', { name: 'Delete' }).click()
    // The dialog's own confirmation message also names the design, so
    // checking for the name's absence before the dialog itself has closed
    // is a strict-mode collision waiting to happen, not a settled result.
    await expect(dialog).not.toBeVisible()
    // And once it is gone, the search this step is already scoped to has
    // nothing left to match — "No matches" is the settled, positive proof
    // of that, the same reasoning the Latest and Mine steps above use; its
    // own text also names the design, so a plain text-absence check here
    // would be exactly the same false pass those steps avoid.
    await expect(ownerPage.getByText(/no matches for/i)).toBeVisible()

    // A reload reads the server's own state, not whatever this page's
    // client-side list still remembers — proving the delete was actually
    // written, not merely hidden from this one render. Sort and search are
    // component state, not carried in the URL (see the "sort in state, not
    // the URL" note in DECISIONS.md), so both are set again after landing
    // back on the plain, reset page.
    await ownerPage.reload()
    await ownerPage.getByRole('button', { name: 'Mine' }).click()
    await ownerPage.getByRole('searchbox').fill(deletableName)
    await expect(ownerPage.getByText(/no matches for/i)).toBeVisible()
  })
})
