/**
 * E2E admin interface journey against the built app: a regular user
 * never sees the admin entries and is bounced from every admin URL;
 * the allowlisted admin (ADMIN_EMAILS in playwright.config.ts) reaches
 * the user directory from the menu, drills into a user and through to
 * a project's own admin page, browses the site-wide project and
 * lecture directories (sorting them by every column), exports the audit
 * log as CSV, and moves between sections with the admin nav bar.
 */
import { test, expect, type Page } from '@playwright/test'
import { createProject } from './helpers'

const password = 'sturdy-passw0rd'
// The admin email is fixed (it must match ADMIN_EMAILS); the account may
// already exist from a previous local run, so creation tolerates 409.
const admin = { email: 'e2e-admin@example.com', displayName: 'E2E Admin' }
const run = Date.now()
const user = { email: `e2e-plain-${run}@example.com`, displayName: 'Plain Jo' }

/** Signs the account in, creating it via the API when it doesn't exist
 * yet (registration also sets the session cookie), and lands on /app. */
const ensureSignedIn = async (
  page: Page,
  account: { email: string; displayName: string },
) => {
  const res = await page.request.post('/api/auth/register', {
    data: { ...account, password },
  })
  if (res.status() === 201) {
    await page.goto('/app')
  } else {
    expect(res.status()).toBe(409)
    await page.goto('/login')
    await page.getByLabel('Email').fill(account.email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in' }).click()
  }
  await expect(page).toHaveURL(/\/app$/)
}

test.describe.configure({ mode: 'serial' })

test('a regular user has no admin entry and is bounced from /app/admin', async ({
  page,
}) => {
  await ensureSignedIn(page, user)
  await createProject(page, 'Admin E2E Project')

  await page.goto('/app')
  await page.getByRole('button', { name: 'Menu' }).click()
  await expect(page.getByRole('menuitem', { name: 'Profile' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Admin' })).toHaveCount(0)

  await page.goto('/app/admin')
  await expect(page).toHaveURL(/\/app$/)

  await page.goto('/app/admin/projects')
  await expect(page).toHaveURL(/\/app$/)

  await page.goto('/app/admin/decks')
  await expect(page).toHaveURL(/\/app$/)

  await page.goto('/app/admin/logs')
  await expect(page).toHaveURL(/\/app$/)
})

// The submenu opens *beside* the drawer, so the drawer must not clip it —
// give the panel any overflow but `visible` and the flyout disappears from
// view while every other check still passes: it keeps its box, and clicking
// it works because Playwright scrolls it into view first. Hit-testing the
// point a user would actually aim at is what catches that.
test('the Admin flyout opens beside the drawer, unclipped', async ({
  page,
}) => {
  await ensureSignedIn(page, admin)

  await page.getByRole('button', { name: 'Menu' }).click()
  const trigger = page.getByRole('menuitem', { name: 'Admin', exact: true })
  await trigger.hover()

  const users = page.getByRole('menuitem', { name: 'Users' })
  await expect(users).toBeVisible()
  const box = await users.boundingBox()
  expect(box).not.toBeNull()

  // Beside the 256px drawer, not inside it
  expect(box!.x).toBeGreaterThanOrEqual(256)
  // And really on screen: whatever is painted at its centre is the link
  // itself, rather than the page showing through where it was clipped away.
  const at = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x!, y!)?.closest('a')?.textContent,
    [box!.x + box!.width / 2, box!.y + box!.height / 2],
  )
  expect(at).toBe('Users')
})

test('the allowlisted admin reaches the directory and a user drill-down', async ({
  page,
}) => {
  await ensureSignedIn(page, admin)

  // The Admin entry is a flyout submenu: hover reveals the sections
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('menuitem', { name: 'Admin', exact: true }).hover()
  await page.getByRole('menuitem', { name: 'Users' }).click()
  await expect(page).toHaveURL(/\/app\/admin$/)

  // The directory offers a configurable page size.
  await expect(page.getByLabel('Users per page')).toBeVisible()

  // Newest-first: the account registered by the previous test is on page 1
  await page.getByRole('link', { name: user.email }).click()
  await expect(page).toHaveURL(/\/app\/admin\/users\//)
  await expect(
    page.getByRole('heading', { name: user.displayName }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'View public profile' }),
  ).toBeVisible()

  // The project row links to the project's own admin page
  await page.getByRole('link', { name: 'Admin E2E Project' }).click()
  await expect(page).toHaveURL(/\/app\/admin\/projects\//)
  await expect(
    page.getByRole('heading', { name: 'Admin E2E Project' }),
  ).toBeVisible()
  await expect(page.getByText('No lectures.')).toBeVisible()

  // Its back link returns to the owner's admin page
  await page.getByRole('link', { name: `← ${user.displayName}` }).click()
  await expect(page).toHaveURL(/\/app\/admin\/users\//)
})

test('the admin browses the project and lecture directories', async ({
  page,
}) => {
  await ensureSignedIn(page, admin)

  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('menuitem', { name: 'Admin', exact: true }).hover()
  await page.getByRole('menuitem', { name: 'Projects' }).click()
  await expect(page).toHaveURL(/\/app\/admin\/projects$/)
  await expect(page.getByRole('heading', { name: /Projects/ })).toBeVisible()
  await expect(page.getByLabel('Projects per page')).toBeVisible()

  // The directory is site-wide and the test DB is shared with every other
  // spec running in parallel, so which projects land on page 1 is not ours
  // to predict — asserting on a specific one made this fail whenever a
  // concurrent spec created newer projects. Drive the FIRST row instead:
  // that exercises the same join and drill-down without depending on the
  // directory's contents (as the lecture and log tables below already do).
  const firstRow = page.getByRole('table').getByRole('row').nth(1)
  // The owner column is a join onto the user collection: it must render an
  // email, or the explicit "—" placeholder for a project whose owner was
  // deleted (the shared DB has those), but never an empty cell.
  await expect(firstRow.getByRole('cell').nth(1)).toHaveText(/@|—/)

  // Rows drill into the project's own admin page, under that project's title
  const projectLink = firstRow.getByRole('link').first()
  const title = (await projectLink.textContent())?.trim() ?? ''
  expect(title).not.toBe('')
  await projectLink.click()
  await expect(page).toHaveURL(/\/app\/admin\/projects\/[0-9a-f]+$/)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()

  // The lecture directory renders its table; the test DB is shared, so
  // assert rows or the empty state rather than specific contents
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('menuitem', { name: 'Admin', exact: true }).hover()
  await page.getByRole('menuitem', { name: 'Lectures' }).click()
  await expect(page).toHaveURL(/\/app\/admin\/decks$/)
  await expect(page.getByRole('heading', { name: /Lectures/ })).toBeVisible()
  await expect(page.getByLabel('Lectures per page')).toBeVisible()
  const rows = page.getByRole('table').getByRole('row')
  // Header plus at least one body row (a lecture or the empty-state row)
  expect(await rows.count()).toBeGreaterThanOrEqual(2)
})

test('the admin reaches the audit log and downloads the CSV export', async ({
  page,
}) => {
  await ensureSignedIn(page, admin)

  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('menuitem', { name: 'Admin', exact: true }).hover()
  await page.getByRole('menuitem', { name: 'Admin Logs', exact: true }).click()
  await expect(page).toHaveURL(/\/app\/admin\/logs$/)
  await expect(page.getByRole('heading', { name: /Audit log/ })).toBeVisible()

  // Nothing in-app writes to the log yet (no admin mutations exist), but
  // the test DB is shared with the integration suite, which may leave
  // entries behind — so assert the table renders either rows or the
  // empty state rather than assuming emptiness
  await expect(
    page.getByRole('row', { name: 'Time Admin Action Target Details' }),
  ).toBeVisible()
  const rows = page.getByRole('table').getByRole('row')
  // Header plus at least one body row (an entry or the empty-state row)
  expect(await rows.count()).toBeGreaterThanOrEqual(2)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download CSV' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('admin-audit-log.csv')
})

test('every admin table column sorts, including the joined ones', async ({
  page,
}) => {
  await ensureSignedIn(page, admin)

  // Each table: its columns, and the row-count assertion that proves
  // the re-sorted page still loaded (the test DB is shared, so assert
  // "renders rows", not specific contents)
  const tables = [
    {
      url: '/app/admin/projects',
      columns: ['Title', 'Owner', 'Visibility', 'Lectures', 'Created'],
    },
    {
      url: '/app/admin/decks',
      columns: ['Lecture', 'Project', 'Owner', 'Visibility', 'Slides'],
    },
    // The two logs sort server-side over the whole log, like the
    // directories above — their one unsortable column is asserted below
    { url: '/app/admin/logs', columns: ['Time', 'Admin', 'Action', 'Target'] },
    {
      url: '/app/admin/settings-logs',
      columns: ['Time', 'Changed by', 'Settings'],
    },
  ]

  for (const directory of tables) {
    await page.goto(directory.url)
    const table = page.getByRole('table')
    for (const column of directory.columns) {
      await table.getByRole('button', { name: column }).click()
      // The clicked column becomes the only sorted one, ascending first
      await expect(
        page.getByRole('columnheader', { name: column }),
      ).toHaveAttribute('aria-sort', 'ascending')
      expect(await table.getByRole('row').count()).toBeGreaterThanOrEqual(2)

      // Clicking again flips the direction rather than re-sorting ascending
      await table.getByRole('button', { name: column }).click()
      await expect(
        page.getByRole('columnheader', { name: column }),
      ).toHaveAttribute('aria-sort', 'descending')
    }
  }
})

test('the log columns holding recorded data offer no sort', async ({
  page,
}) => {
  await ensureSignedIn(page, admin)

  // Both hold what an entry recorded — a bag of action context, a set of
  // changed fields — which has no order to sort into
  for (const [url, column] of [
    ['/app/admin/logs', 'Details'],
    ['/app/admin/settings-logs', 'What changed'],
  ]) {
    await page.goto(url!)
    const header = page.getByRole('columnheader', { name: column })
    await expect(header).toBeVisible()
    // Not even aria-sort="none", which would advertise a sort that is
    // not on offer
    await expect(header).not.toHaveAttribute('aria-sort', /.*/)
    await expect(header.getByRole('button')).toHaveCount(0)
  }
})

test('the admin nav bar moves between every section and marks the current one', async ({
  page,
}) => {
  await ensureSignedIn(page, admin)
  await page.goto('/app/admin')

  const nav = page.getByRole('navigation', { name: 'Admin' })
  await expect(nav.getByRole('link', { name: 'Users' })).toHaveAttribute(
    'aria-current',
    'page',
  )

  await nav.getByRole('link', { name: 'Projects' }).click()
  await expect(page).toHaveURL(/\/app\/admin\/projects$/)
  await expect(nav.getByRole('link', { name: 'Projects' })).toHaveAttribute(
    'aria-current',
    'page',
  )

  await nav.getByRole('link', { name: 'Lectures' }).click()
  await expect(page).toHaveURL(/\/app\/admin\/decks$/)

  await nav.getByRole('link', { name: 'Admin Logs', exact: true }).click()
  await expect(page).toHaveURL(/\/app\/admin\/logs$/)

  await nav.getByRole('link', { name: 'Users' }).click()
  await expect(page).toHaveURL(/\/app\/admin$/)

  // A detail page keeps its section marked, and the bar stays available
  await page.getByRole('link', { name: user.email }).click()
  await expect(page).toHaveURL(/\/app\/admin\/users\//)
  await expect(nav.getByRole('link', { name: 'Users' })).toHaveAttribute(
    'aria-current',
    'page',
  )
})
