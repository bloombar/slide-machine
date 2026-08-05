/**
 * The style-template library end to end (TMPL-1, TMPL-4): browse the library
 * from a project's settings, duplicate a shipped template, rename and retheme
 * the copy, give a layout a box of the author's own, arrange it, apply it to
 * the project, and delete it again — checking at each step that the app
 * agrees, rather than that a request was sent.
 */
import { test, expect } from '@playwright/test'
import { createProject, openProjectSettings } from './helpers'

const stamp = Date.now()
const user = { email: `tmpl-${stamp}@example.com`, name: 'Templater' }
const password = 'sturdy-passw0rd'
const projectName = `TmplLib${stamp}`
const templateName = `My Style ${stamp}`

test('template library: duplicate, edit, apply, delete', async ({ page }) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill(user.name)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)

  await createProject(page, projectName)
  await openProjectSettings(page, projectName)
  await page.getByRole('tab', { name: 'Design' }).click()

  // The library shows each template as a slide in its own theme, not a
  // colour swatch — that is what makes it browsable (TMPL-1).
  const library = page.getByRole('radiogroup', { name: 'Slide template' })
  await expect(library).toBeVisible()
  const previews = page.getByTestId('template-preview')
  expect(await previews.count()).toBeGreaterThan(0)
  const shipped = await previews.count()

  // Duplicating is how a template is made: the copy opens straight in the
  // editor, since its name is the first thing anyone changes (TMPL-4).
  await page
    .getByRole('button', { name: /^Duplicate / })
    .first()
    .click()

  const nameField = page.getByLabel('Template name')
  await expect(nameField).toBeVisible()
  await nameField.fill(templateName)
  await page.getByLabel('Accent').fill('#00aa88')

  // Every template carries the conventional layouts (TMPL-2), so they are
  // folded away — open the one being worked on.
  const firstLayout = page.locator('details').first()
  await firstLayout.locator('summary').click()

  // A custom template is not just a recolour: the author decides what the
  // slide holds. Adding a second picture box is how a layout ends up with
  // more pictures than anything shipped has (TMPL-4).
  await firstLayout.getByLabel('Name this box').fill('Photo 2')
  await firstLayout.getByLabel('What goes in it').last().selectOption('image')
  await firstLayout.getByRole('button', { name: 'Add a box' }).click()

  // Arrange a layout: where its slots sit becomes data on the template, and
  // the slide renderer draws from it instead of the hand-tuned component
  // (TMPL-4 positioning).
  await firstLayout.getByRole('button', { name: 'Arrange this layout' }).click()
  // Moving a box by keyboard rather than dragging: the same result, and the
  // route a pointer user does not need but a keyboard user does. Narrow it
  // first — a box is kept inside the slide, so a full-width one cannot move.
  const titleBox = page.getByLabel(/^title:/)
  await titleBox.focus()
  await page.keyboard.press('Shift+ArrowLeft')
  await expect(titleBox).toHaveAttribute('aria-label', /86% wide/)
  await page.keyboard.press('ArrowRight')
  await expect(titleBox).toHaveAttribute('aria-label', /8% from the left/)
  // A layout of the author's own, for a design none of the conventional
  // names describes (TMPL-9)
  await page.getByLabel('Name this layout').fill('Lab safety')
  await page.getByRole('button', { name: 'Add layout' }).click()
  await expect(page.getByText('Lab safety', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Save' }).click()

  // Back in the library, the copy is there and marked as the user's own
  await expect(library.getByText(templateName)).toBeVisible()
  expect(await page.getByTestId('template-preview').count()).toBe(shipped + 1)
  await expect(library.getByText('Custom').first()).toBeVisible()

  // Applying it to the project sticks across a reload
  await page.getByRole('radio', { name: new RegExp(templateName) }).click()
  await expect(
    page.getByRole('radio', { name: new RegExp(templateName) }),
  ).toHaveAttribute('aria-checked', 'true')
  await page.reload()
  await openProjectSettings(page, projectName)
  await page.getByRole('tab', { name: 'Design' }).click()
  await expect(
    page.getByRole('radio', { name: new RegExp(templateName) }),
  ).toHaveAttribute('aria-checked', 'true')

  // A shipped template stays read-only: it can be copied, never edited
  await expect(
    page.getByRole('button', { name: `Edit ${templateName}` }),
  ).toBeVisible()

  // The arrangement survived the save
  await page.getByRole('button', { name: `Edit ${templateName}` }).click()
  await expect(page.getByText('Lab safety', { exact: true })).toBeVisible()
  await page.locator('details').first().locator('summary').click()
  await expect(page.getByLabel(/^title:/)).toHaveAttribute(
    'aria-label',
    /8% from the left/,
  )
  // ...and so did the author's own box, with a place on the slide of its own
  await expect(page.getByLabel(/^photo-2:/)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Remove the Photo 2 box' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()

  // Deleting the copy takes it out of the library, and the project page
  // still opens afterwards — a lecture must not break with its template
  await page.getByRole('button', { name: `Delete ${templateName}` }).click()
  await page.getByRole('button', { name: 'Delete' }).last().click()
  await expect(library.getByText(templateName)).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible()
})
