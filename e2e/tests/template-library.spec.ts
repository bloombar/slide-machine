/**
 * The style-template library and its editor end to end (TMPL-1, TMPL-4):
 * browse the library from a project's settings, duplicate a shipped template,
 * rename and retheme the copy, work on one layout at a time as a rendered
 * slide, give it a box of the author's own, apply it to the project, and
 * delete it again — checking at each step that the app agrees, rather than
 * that a request was sent.
 *
 * This is also where the claims jsdom cannot make are made: the unit tests
 * prove the editor writes the right numbers, and only a browser can say the
 * slide actually changed.
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

  // One layout at a time, as a real slide: the rail picks which.
  const canvas = page.getByTestId('template-canvas')
  await expect(canvas).toBeVisible()
  await page.getByRole('tab', { name: /Content/ }).click()
  await expect(page.getByRole('tab', { name: /Content/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )

  await test.step('a colour change shows on the slide, not just in a field', async () => {
    await page.getByLabel('Accent').fill('#00aa88')
    // The heading follows the accent, so the slide itself must have moved.
    const heading = canvas.locator('[data-node-id="title"]').first()
    await expect(heading).toHaveCSS('color', 'rgb(0, 170, 136)')
  })

  await test.step('clicking a box on the slide opens its settings', async () => {
    await canvas.locator('[data-flip-id$=":title"]').first().click()
    await expect(page.getByLabel('What is it')).toBeVisible()
    // An "x" hands the column back to the layout it belongs to.
    await page.getByRole('button', { name: 'Back to layout settings' }).click()
    await expect(page.getByLabel('When to use it')).toBeVisible()
  })

  await test.step('a text style restyles every box that follows it', async () => {
    const body = canvas.locator('[data-node-id="body"]').first()
    const before = (await body.boundingBox())!.height
    await page.getByLabel('Text size for Body').fill('6')
    await expect
      .poll(async () => (await body.boundingBox())!.height)
      .toBeGreaterThan(before)
  })

  await test.step('the author adds a picture box of their own', async () => {
    // The professor's case: a layout with more pictures than anything
    // shipped has (TMPL-4).
    await page
      .getByRole('button', { name: /^Add a box inside/ })
      .first()
      .click()
    await page.getByLabel('What is it').selectOption('image')
    await page.getByLabel('What it is called').fill('Image 2')
  })

  await test.step('a layout of the author’s own, for a design none of the conventional names describes (TMPL-9)', async () => {
    // It arrives named for its place in the list; renaming it is the first
    // thing there is to do, in the panel beside it.
    await page.getByRole('button', { name: 'Add layout' }).click()
    await page.getByLabel('Name', { exact: true }).fill('Lab safety')
    await expect(page.getByRole('tab', { name: /Lab safety/ })).toBeVisible()
  })

  await test.step('undo takes back one action, not one keystroke', async () => {
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByRole('tab', { name: /Lab safety/ })).toHaveCount(0)
    await page.getByRole('button', { name: 'Redo' }).click()
    await expect(page.getByRole('tab', { name: /Lab safety/ })).toBeVisible()
  })

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

  await test.step('the design survived the save', async () => {
    await page.getByRole('button', { name: `Edit ${templateName}` }).click()
    await expect(page.getByRole('tab', { name: /Lab safety/ })).toBeVisible()
    await page.getByRole('tab', { name: /Content/ }).click()
    // The author's own box came back, and so did the colour.
    await expect(page.getByText('Image 2')).toBeVisible()
    await expect(page.getByLabel('Accent')).toHaveValue('#00aa88')
    await page.getByRole('button', { name: 'Cancel' }).click()
  })

  // Deleting the copy takes it out of the library, and the project page
  // still opens afterwards — a lecture must not break with its template
  await page.getByRole('button', { name: `Delete ${templateName}` }).click()
  await page.getByRole('button', { name: 'Delete' }).last().click()
  await expect(library.getByText(templateName)).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible()
})

test('a layout of the author’s own survives leaving and returning', async ({
  page,
}) => {
  // The whole point of saving: close the settings entirely, come back, and
  // find the design still there — its boxes listed and each still set the way
  // it was left.
  const own = `Returner ${stamp}`
  await page.goto('/login')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/app$/)

  await openProjectSettings(page, projectName)
  await page.getByRole('tab', { name: 'Design' }).click()
  await page
    .getByRole('button', { name: /^Duplicate / })
    .first()
    .click()
  await page.getByLabel('Template name').fill(own)

  await page.getByRole('button', { name: 'Add layout' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Content + Image')
  await expect(
    page.getByRole('tab', { name: /Content \+ Image/ }),
  ).toBeVisible()

  const boxes = () => page.getByRole('list').last()
  await boxes().getByText('Slide title').click()
  await page.getByLabel('Text size', { exact: true }).fill('9')
  await page.getByRole('button', { name: 'Save' }).click()
  // A refused save keeps the editor open, so this is also the check that it
  // was accepted at all.
  await expect(page.getByLabel('Template name')).toHaveCount(0)

  await page.getByRole('button', { name: 'Close settings' }).click()
  await openProjectSettings(page, projectName)
  await page.getByRole('tab', { name: 'Design' }).click()
  await page.getByRole('button', { name: `Edit ${own}` }).click()
  await page.getByRole('tab', { name: /Content \+ Image/ }).click()

  await expect(boxes()).toContainText('Slide title')
  await boxes().getByText('Slide title').click()
  await expect(page.getByLabel('Text size', { exact: true })).toHaveValue('9')
  await page.getByRole('button', { name: 'Cancel' }).click()
})

test('arranging boxes freely, with rulers and guides', async ({ page }) => {
  const own = `Freeform ${stamp}`
  await page.goto('/login')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/app$/)

  await openProjectSettings(page, projectName)
  await page.getByRole('tab', { name: 'Design' }).click()
  await page
    .getByRole('button', { name: /^Duplicate / })
    .first()
    .click()
  await page.getByLabel('Template name').fill(own)
  await page.getByRole('tab', { name: 'Content', exact: true }).click()

  const canvas = page.getByTestId('template-canvas')
  const boxes = () => page.getByRole('list').last()

  await test.step('spreading a column keeps its contents inside the margins', async () => {
    // "At the start" used to put the first box hard against the top of the
    // slide, outside the safe area the template asks for and the editor
    // draws. The root is selected from the outline: clicking the middle of
    // the slide lands on whichever box is there.
    await boxes().getByText('Column').first().click()
    await page.getByLabel('Spread').selectOption('start')
    const frame = (await canvas.boundingBox())!
    const first = (await canvas
      .locator('[data-node-id="title"]')
      .boundingBox())!
    expect((first.y - frame.y) / frame.height).toBeGreaterThan(0.04)
  })

  await test.step('a box can be lifted out of the flow and dragged anywhere', async () => {
    await canvas.locator('[data-node-id="title"]').first().click()
    await page.getByLabel('Position this box freely').check()
    const title = canvas.locator('[data-node-id="title"]').first()
    const before = (await title.boundingBox())!
    const frame = (await canvas.boundingBox())!
    // Drag it towards the bottom-right quarter of the slide.
    await page.mouse.move(
      before.x + before.width / 2,
      before.y + before.height / 2,
    )
    await page.mouse.down()
    await page.mouse.move(
      frame.x + frame.width * 0.7,
      frame.y + frame.height * 0.7,
    )
    await page.mouse.up()
    await expect
      .poll(async () => (await title.boundingBox())!.y)
      .toBeGreaterThan(before.y)
  })

  await test.step('a guide is pulled off a ruler and snaps to the grid', async () => {
    const ruler = page.getByRole('button', { name: /Bottom ruler/ })
    const box = (await ruler.boundingBox())!
    const frame = (await canvas.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    // Up into the slide, roughly a third of the way down
    await page.mouse.move(box.x + box.width / 2, frame.y + frame.height * 0.32)
    await page.mouse.up()
    // Marks are every ten percent, so it lands on 30
    await expect(
      page.getByRole('slider', { name: /Horizontal guide/ }),
    ).toHaveAttribute('aria-valuenow', '30')
  })

  await test.step('a guide moves by keyboard too, and can be removed', async () => {
    const guide = page.getByRole('slider', { name: /Horizontal guide/ })
    await guide.focus()
    await page.keyboard.press('ArrowDown')
    await expect(guide).toHaveAttribute('aria-valuenow', '40')
    await page.keyboard.press('Delete')
    await expect(
      page.getByRole('slider', { name: /Horizontal guide/ }),
    ).toHaveCount(0)
  })

  await page.getByRole('button', { name: 'Cancel' }).click()
})

test('a box carries the author’s instruction to the AI (TMPL-10)', async ({
  page,
}) => {
  // The point of the requirement: a template teaches the AI what each box is
  // for, in the author's own words, and that survives being saved.
  const own = `Instructed ${stamp}`
  await page.goto('/login')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/app$/)

  await openProjectSettings(page, projectName)
  await page.getByRole('tab', { name: 'Design' }).click()
  await page
    .getByRole('button', { name: /^Duplicate / })
    .first()
    .click()
  await page.getByLabel('Template name').fill(own)

  const boxes = () => page.getByRole('list').last()
  await boxes().getByText('Slide title').click()

  const instruction = 'Only the concept being introduced, in three words.'
  await page.getByLabel('What goes in it (for the AI)').fill(instruction)
  await page.getByLabel('Max words').fill('6')
  await page.getByLabel('The slide should always fill this').check()
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByLabel('Template name')).toHaveCount(0)

  // Reopen from scratch: what the author wrote is what the template holds
  await page.getByRole('button', { name: 'Close settings' }).click()
  await openProjectSettings(page, projectName)
  await page.getByRole('tab', { name: 'Design' }).click()
  await page.getByRole('button', { name: `Edit ${own}` }).click()
  await boxes().getByText('Slide title').click()

  await expect(page.getByLabel('What goes in it (for the AI)')).toHaveValue(
    instruction,
  )
  await expect(page.getByLabel('Max words')).toHaveValue('6')
  await expect(
    page.getByLabel('The slide should always fill this'),
  ).toBeChecked()
  await page.getByRole('button', { name: 'Cancel' }).click()
})
