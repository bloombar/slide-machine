/**
 * A design's own sharing panel end to end (TMPL-26): the owner shares a
 * restricted design with a second user as a viewer, who sees it — with a
 * "shared" badge, not "custom" — in their own lecture's Design tab, and can
 * open the design's page read-only but not edit it. Raising the role to
 * editor turns the same page editable; making the design public and then
 * restricted again, then unsharing it outright, ends with the second user
 * refused at `/t/:slug` exactly as a missing design would be.
 */
import { test, expect, type Browser, type Page } from './fixtures'
import { createProject, openProjectSettings, verifyEmail } from './helpers'

const stamp = Date.now()
const owner = { email: `tmplowner-${stamp}@example.com`, name: 'Designer' }
const guest = { email: `tmplguest-${stamp}@example.com`, name: 'Colleague' }
const password = 'sturdy-passw0rd'
const projectName = `TmplShare${stamp}`
const designName = `Shared Design ${stamp}`

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

test('template sharing: viewer, then editor, then unshared (TMPL-26)', async ({
  browser,
}) => {
  const ownerPage = await newUserPage(browser, owner)
  const guestPage = await newUserPage(browser, guest)

  // Sharing needs the sharer's own address confirmed (AUTH-3) — the same
  // gate `template.setAccess`/`template.share` enforce for a lecture. And a
  // share only becomes a real grant, rather than a pending invitation
  // (SHARE-3), once the recipient's own address is confirmed too.
  await verifyEmail(ownerPage, owner.email)
  await verifyEmail(guestPage, guest.email)

  // The owner needs a design of their own to share: duplicate a shipped one
  // from a project's Design tab, exactly the way template-library.spec.ts
  // makes one, and land on its own page.
  await createProject(ownerPage, projectName)
  await openProjectSettings(ownerPage, projectName)
  await ownerPage.getByRole('tab', { name: 'Design' }).click()
  await ownerPage
    .getByRole('button', { name: /^Duplicate / })
    .first()
    .click()
  await expect(ownerPage).toHaveURL(/\/t\//)
  await ownerPage.getByLabel('Template name').fill(designName)
  await ownerPage.getByRole('button', { name: 'Save' }).click()
  await expect(ownerPage.getByTestId('template-saved')).toHaveText('Saved')
  const designUrl = ownerPage.url()

  // A duplicate starts restricted, so nobody but its owner can reach it yet.
  await expect(
    ownerPage.getByRole('radio', { name: /restricted/i }),
  ).toBeChecked()

  // The guest needs a lecture of their own, whose Design tab is where a
  // shared design shows up alongside the built-ins.
  const guestProject = `TmplGuest${stamp}`
  await createProject(guestPage, guestProject)
  await guestPage
    .getByRole('button', { name: `Start a new lecture in ${guestProject}` })
    .click()
  await expect(guestPage).toHaveURL(/\/d\//)
  await guestPage.getByRole('button', { name: 'Start lecture' }).click()

  const openGuestDesignTab = async () => {
    await guestPage.getByRole('button', { name: 'Lecture settings' }).click()
    await guestPage.getByRole('tab', { name: 'Design' }).click()
  }

  await openGuestDesignTab()
  // Wait on something positive — a built-in's own card — before asserting
  // the shared design is absent, or the library simply not having loaded
  // yet would pass the same way a real absence would.
  await expect(guestPage.getByRole('radio', { name: /classic/i })).toBeVisible()
  await expect(guestPage.getByText(designName)).toHaveCount(0)
  await guestPage.getByRole('button', { name: 'Close settings' }).click()

  // Owner shares it with the guest, as a viewer, from the sharing panel on
  // the design's own page.
  await ownerPage.getByLabel('Add people by email').fill(guest.email)
  await ownerPage.getByLabel('Access role').selectOption('viewer')
  await ownerPage.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(ownerPage.getByText(guest.name, { exact: true })).toBeVisible()

  // The guest now sees it, badged "Shared" rather than "Custom" — they did
  // not author it. A shared, restricted design is never on Latest/Top (those
  // list public designs only, TMPL-28); "Mine" is where it lives, alongside
  // anything the guest owns.
  await guestPage.reload()
  await openGuestDesignTab()
  await guestPage.getByRole('button', { name: 'Mine' }).click()
  const guestCard = guestPage
    .getByRole('radio', { name: new RegExp(designName) })
    .locator('..')
  await expect(guestCard.getByText(designName)).toBeVisible()
  await expect(guestCard.getByText('Shared', { exact: true })).toBeVisible()
  await expect(guestCard.getByText('Custom', { exact: true })).toHaveCount(0)
  // A viewer gets no pencil: template.update would refuse them.
  await expect(
    guestPage.getByRole('button', { name: `Edit ${designName}` }),
  ).toHaveCount(0)
  await guestPage.getByRole('button', { name: 'Close settings' }).click()

  // Opened directly, the design's own page is read-only for the guest — the
  // real field is there (TMPL-29: a reader sees everything the editor shows),
  // just disabled rather than absent, so nothing about the design is hidden
  // from them, only writable.
  await guestPage.goto(designUrl)
  await expect(
    guestPage.getByRole('heading', { name: designName }),
  ).toBeVisible()
  await expect(guestPage.getByLabel('Template name')).toBeDisabled()
  await expect(guestPage.getByLabel('Template name')).not.toBeEditable()

  // The owner raises the guest to editor.
  await ownerPage.getByLabel(`Role for ${guest.name}`).selectOption('editor')
  await expect(ownerPage.getByLabel(`Role for ${guest.name}`)).toHaveValue(
    'editor',
  )

  // The guest can now edit the design in place and save.
  await guestPage.reload()
  await expect(guestPage.getByLabel('Template name')).toBeVisible()
  await guestPage.getByLabel('Template name').fill(`${designName} v2`)
  await guestPage.getByRole('button', { name: 'Save' }).click()
  await expect(guestPage.getByTestId('template-saved')).toHaveText('Saved')

  // The owner makes it public, then restricted again — the sharing panel's
  // general-access radios, not a save of the draft.
  await ownerPage.getByRole('radio', { name: /public/i }).click()
  await expect(ownerPage.getByRole('radio', { name: /public/i })).toBeChecked()

  // While it is public, a third user — never on its people list — finds it
  // under Top with a search and applies it to their own lecture's Design tab
  // (TMPL-28/TMPL-26): a public design is reachable by anyone, not only by
  // whoever it was explicitly shared with, and the same browser that lists
  // it lets them choose it.
  await test.step('a third user applies the owner’s public design, found by search under Top', async () => {
    const onlooker = {
      email: `tmplonlooker-${stamp}@example.com`,
      name: 'Bystander',
    }
    const onlookerPage = await newUserPage(browser, onlooker)
    const onlookerProject = `TmplOnlooker${stamp}`
    await createProject(onlookerPage, onlookerProject)
    await onlookerPage
      .getByRole('button', {
        name: `Start a new lecture in ${onlookerProject}`,
      })
      .click()
    await expect(onlookerPage).toHaveURL(/\/d\//)
    await onlookerPage.getByRole('button', { name: 'Start lecture' }).click()
    await onlookerPage.getByRole('button', { name: 'Lecture settings' }).click()
    await onlookerPage.getByRole('tab', { name: 'Design' }).click()

    const currentName = `${designName} v2`
    await onlookerPage.getByRole('button', { name: 'Top' }).click()
    await onlookerPage.getByRole('searchbox').fill(currentName)
    const found = onlookerPage.getByRole('radio', {
      name: new RegExp(currentName),
    })
    await expect(found).toBeVisible()
    await found.click()
    await expect(found).toHaveAttribute('aria-checked', 'true')
  })

  await ownerPage.getByRole('radio', { name: /restricted/i }).click()
  await expect(
    ownerPage.getByRole('radio', { name: /restricted/i }),
  ).toBeChecked()

  // Unshared outright: the guest gets not-found, exactly as a nonexistent
  // design would.
  await ownerPage.getByLabel(`Role for ${guest.name}`).selectOption('remove')
  await expect(ownerPage.getByText(guest.name, { exact: true })).toHaveCount(0)

  await guestPage.reload()
  await expect(
    guestPage.getByText('This design does not exist, or is private.'),
  ).toBeVisible()
})
