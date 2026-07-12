/**
 * Lecture-row kebab menu end to end: Share deep-links into the
 * lecture's Privacy & Sharing settings; Delete confirms in a dialog
 * and removes the lecture from the list.
 */
import { test, expect } from '@playwright/test'

const email = `menu-${Date.now()}@example.com`

test('kebab menu shares and deletes lectures from lists', async ({ page }) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Menuist')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()

  await page.getByLabel('New project title').fill('MenuProj')
  await page.getByRole('button', { name: 'Create' }).click()
  await page
    .getByRole('button', { name: 'Start a new lecture in MenuProj' })
    .click()
  await expect(page).toHaveURL(/\/d\/untitled-/)

  // Back home: Settings opens the viewer on the General tab
  await page.getByRole('link', { name: 'The Slide Machine' }).click()
  await page
    .getByRole('button', { name: 'Options for Untitled lecture' })
    .click()
  await page.getByRole('menuitem', { name: 'Settings' }).click()
  await expect(
    page.getByRole('dialog', { name: 'Lecture settings' }),
  ).toBeVisible()
  await expect(page.getByRole('tab', { name: 'General' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(
    page.getByRole('textbox', { name: 'Lecture seed notes' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Close settings' }).click()

  // Share opens the viewer on the Privacy & Sharing tab
  await page.getByRole('link', { name: 'The Slide Machine' }).click()
  await page
    .getByRole('button', { name: 'Options for Untitled lecture' })
    .click()
  await page.getByRole('menuitem', { name: 'Share' }).click()
  await expect(
    page.getByRole('dialog', { name: 'Lecture settings' }),
  ).toBeVisible()
  await expect(
    page.getByRole('tab', { name: 'Privacy & Sharing' }),
  ).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('Add people by email')).toBeVisible()
  await page.getByRole('button', { name: 'Close settings' }).click()

  // From the project page: Delete confirms, then the row disappears
  await page.getByRole('link', { name: 'The Slide Machine' }).click()
  await page.getByRole('link', { name: 'MenuProj', exact: true }).click()
  await page
    .getByRole('button', { name: 'Options for Untitled lecture' })
    .click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Delete lecture?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText(/Untitled lecture/)).toBeVisible()

  await page
    .getByRole('button', { name: 'Options for Untitled lecture' })
    .click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page
    .getByRole('alertdialog', { name: 'Delete lecture?' })
    .getByRole('button', { name: 'Delete', exact: true })
    .click()
  await expect(
    page.getByText('No lectures yet — use + to start one.'),
  ).toBeVisible()

  // The project title edits in place; home reflects the rename
  await page.getByTitle('Click to edit Project title').click()
  await page
    .getByRole('textbox', { name: 'Project title' })
    .fill('MenuProj Renamed')
  await page.keyboard.press('Enter')
  await page.getByRole('link', { name: 'The Slide Machine' }).click()
  await expect(
    page.getByRole('heading', { name: 'MenuProj Renamed' }),
  ).toBeVisible()
})
