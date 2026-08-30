/**
 * EDIT-1 e2e: slide text is edited in place from the deck viewer — the
 * app's single editing surface. Covers list view, Markdown source
 * roundtrip, and persistence.
 */
import { test, expect, type Page } from './fixtures'
import { createProject } from './helpers'

const email = `edit-${Date.now()}@example.com`
const password = 'sturdy-passw0rd'

const buildDeck = async (page: Page) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Editor')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()

  await createProject(page, 'Chemistry')
  await page
    .getByRole('button', { name: 'Start a new lecture in Chemistry' })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  // The pre-lecture seed dialog opens first; dismiss it to begin recording
  await page.getByRole('button', { name: 'Start lecture' }).click()
  await page.getByTitle('Click to edit Lecture title').click()
  await page.getByRole('textbox', { name: 'Lecture title' }).fill('Atoms')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Atoms' })).toBeVisible()

  for (const phrase of ['Atomic structure', 'Protons, neutrons, electrons']) {
    await page.getByLabel('Spoken phrase').fill(phrase)
    await page.getByRole('button', { name: 'Speak' }).click()
    await expect(page.getByTestId('slide')).toBeVisible()
  }
}

test('in-place editing in the viewer, including list view and bullets', async ({
  page,
}) => {
  await buildDeck(page)

  // Open the deck in the viewer via the home screen
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Home' }).click()
  await page.getByRole('link', { name: 'Atoms' }).click()
  await expect(page).toHaveURL(/\/d\//)

  // Rename the lecture itself from the header
  await page.getByTitle('Click to edit Lecture title').click()
  await page
    .getByRole('textbox', { name: 'Lecture title' })
    .fill('Atoms, Revised')
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('heading', { name: 'Atoms, Revised' }),
  ).toBeVisible()

  // Edit the title slide's text in place
  await page.getByTitle('Click to edit Slide title').click()
  await page
    .getByRole('textbox', { name: 'Slide title' })
    .fill('Introduction to Atoms')
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('heading', { name: 'Introduction to Atoms' }),
  ).toBeVisible()

  // List view: every slide is editable up-front; edit a bullet in place
  await page.getByRole('button', { name: 'List view' }).click()
  await expect(page.getByTestId('slide')).toHaveCount(2)
  await page.getByTitle('Click to edit Slide bullets').click()
  await page
    .getByRole('textbox', { name: 'Slide bullets' })
    .fill('protons\n**neutrons**')
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(page.getByTestId('slide').last().locator('strong')).toHaveText(
    'neutrons',
  )

  // Everything persists across a fresh page load
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Introduction to Atoms' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'List view' }).click()
  await expect(page.getByTestId('slide').last().locator('strong')).toHaveText(
    'neutrons',
  )

  // Whole rows drag to reorder; Alt+arrows on a focused row is the
  // keyboard path
  await page.getByRole('listitem', { name: 'Slide 1' }).press('Alt+ArrowDown')
  await expect(page.getByTestId('slide').first()).toHaveAttribute(
    'data-layout',
    'list',
  )
  await page.reload()
  await page.getByRole('button', { name: 'List view' }).click()
  await expect(page.getByTestId('slide').first()).toHaveAttribute(
    'data-layout',
    'list',
  )
  await page.getByRole('listitem', { name: 'Slide 2' }).press('Alt+ArrowUp')
  await expect(page.getByTestId('slide').first()).toHaveAttribute(
    'data-layout',
    'title',
  )

  // The slide kebab changes layouts via the picker (current highlighted,
  // source template named)
  await page.getByRole('button', { name: 'Options for slide 1' }).click()
  await page.getByRole('menuitem', { name: 'Change layout' }).click()
  await expect(
    page.getByRole('dialog', { name: 'Change slide layout' }),
  ).toBeVisible()
  await expect(
    page.getByRole('dialog', { name: 'Change slide layout' }),
  ).toContainText('Layouts from the Classic template')
  await expect(
    page.getByRole('radio', { name: /^Title Opening/ }),
  ).toHaveAttribute('aria-checked', 'true')
  // Every choice is a miniature slide, not a line of prose (EDIT-3): one
  // preview per layout, drawn by the renderer the slide itself uses, and
  // each drawing its OWN layout rather than the same one over and over
  {
    const dialog = page.getByRole('dialog', { name: 'Change slide layout' })
    const previews = dialog.getByTestId('layout-preview')
    const layouts = await dialog.getByRole('radio').count()
    await expect(previews).toHaveCount(layouts)
    // The bullet-list card shows bullets; the title card does not. By
    // element, not by role: a preview is decoration to a screen reader, so
    // nothing inside one has a role to be found by.
    await expect(
      dialog.getByRole('radio', { name: /^Bullet list/ }).locator('li'),
    ).not.toHaveCount(0)
    await expect(
      dialog.getByRole('radio', { name: /^Title Opening/ }).locator('li'),
    ).toHaveCount(0)
  }
  await page.getByRole('radio', { name: /quote/i }).click()
  await expect(page.getByTestId('slide').first()).toHaveAttribute(
    'data-layout',
    'quote',
  )

  // The quote layout's caption was empty and hidden before the switch — the
  // blank slot carries the invitation every slide tool shows, but keeps it
  // transparent so a lecturer presenting never projects it; a page-background
  // click flashes the box as a skeleton, fading on its own
  const blankCaption = page.getByTitle('Click to edit Slide caption')
  await expect(blankCaption).toHaveText('Click to add text')
  await expect(blankCaption).toHaveCSS('color', 'rgba(0, 0, 0, 0)')
  await page
    .locator('div.max-w-5xl')
    .first()
    .click({ position: { x: 5, y: 5 } })
  await expect(blankCaption).toHaveCSS(
    'background-color',
    'rgba(148, 163, 184, 0.35)',
  )
  await expect(blankCaption).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(blankCaption).toHaveCSS('color', 'rgba(0, 0, 0, 0)')

  // The slide's own background, between its boxes, flashes them the same way
  await page
    .getByTestId('slide')
    .first()
    .click({ position: { x: 5, y: 5 } })
  await expect(blankCaption).toHaveCSS(
    'background-color',
    'rgba(148, 163, 184, 0.35)',
  )
  await expect(blankCaption).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  // Hovering one draws it for the editor — words and dashed box together —
  // and holds still, unlike the half-second flash above
  await blankCaption.hover()
  await expect(blankCaption).not.toHaveCSS('color', 'rgba(0, 0, 0, 0)')
  await blankCaption.click()
  await page
    .getByRole('textbox', { name: 'Slide caption' })
    .fill('Dalton, 1803')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('slide').first()).toContainText('Dalton, 1803')

  // ...and deletes a slide with no confirmation
  await page.getByRole('button', { name: 'Options for slide 2' }).click()
  await page.getByRole('menuitem', { name: 'Delete slide' }).click()
  await expect(page.getByTestId('slide')).toHaveCount(1)
  await page.reload()
  // The reload now preserves the view (list, from earlier); the rest of
  // this test asserts carousel behaviour, so return to it explicitly —
  // the choice then persists across the later reload too
  await page.getByRole('button', { name: 'Carousel view' }).click()
  await expect(page.getByText('1 / 1')).toBeVisible()
  await expect(page.getByTestId('slide')).toHaveAttribute(
    'data-layout',
    'quote',
  )
  await expect(page.getByTestId('slide')).toContainText('Dalton, 1803')

  // Lecture settings open as a full-width modal over the viewer
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  await expect(
    page.getByRole('dialog', { name: 'Lecture settings' }),
  ).toBeVisible()
  await page.getByRole('tab', { name: 'Design' }).click()
  await expect(page.getByRole('radio', { name: /classic/i })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await page.getByRole('radio', { name: /seminar/i }).click()
  await expect(page.getByRole('radio', { name: /seminar/i })).toHaveAttribute(
    'aria-checked',
    'true',
  )

  // Escape closes the modal and returns to the slides
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByTestId('slide')).toBeVisible()

  // The switch persisted: reopen after a reload and check
  await page.reload()
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  await page.getByRole('tab', { name: 'Design' }).click()
  await expect(page.getByRole('radio', { name: /seminar/i })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await page.getByRole('button', { name: 'Close settings' }).click()

  // The add icon appends an empty slide at the end, whose boxes invite the
  // author in rather than arriving with words they have to delete
  await page.getByRole('button', { name: 'Add slide', exact: true }).click()
  await expect(page.getByText('2 / 2')).toBeVisible()
  await expect(page.getByTitle('Click to edit Slide title').first()).toHaveText(
    'Click to add title',
  )
  await page.reload()
  await expect(page.getByText('1 / 2')).toBeVisible()

  // Line breaks entered while editing are preserved in the rendered text
  await page.keyboard.press('ArrowRight')
  await page.getByTitle('Click to edit Slide body').click()
  await page
    .getByRole('textbox', { name: 'Slide body' })
    .fill('line one\nline two')
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(page.getByTestId('slide').locator('br')).toHaveCount(1)
  await expect(page.getByTestId('slide')).toContainText('line two')
})

/**
 * A slot's authoring hint is drawn over the slide, not inside the box it
 * describes (EDIT-7/TMPL-10), and entering a box does not resize its type
 * (TMPL-8).
 *
 * Only a browser can show this fault. A slide box clips what it holds and is
 * sized by its design, so a hint drawn under a field that already fills the
 * box was cut off — and, counting as the box's content, it made the box
 * overflow, so `useFitText` shrank the words to its floor for as long as the
 * cursor was in them. jsdom lays nothing out and reports neither.
 */
test('a slot hint clears its box, and the type keeps its size', async ({
  page,
}) => {
  const hintEmail = `hint-${Date.now()}@example.com`
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Hinter')
  await page.getByLabel('Email').fill(hintEmail)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()

  await createProject(page, 'Hints')
  await page
    .getByRole('button', { name: 'Start a new lecture in Hints' })
    .click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Start lecture' }).click()
  await page.getByLabel('Spoken phrase').fill('The cell membrane is a barrier')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toBeVisible()

  // NYU Bold writes a description for every slot, so its boxes have hints —
  // and its title box is tight enough that one drawn inside it would not fit
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  await page.getByRole('tab', { name: 'Design' }).click()
  await page.getByRole('radio', { name: /nyu bold/i }).click()
  await page.getByRole('button', { name: 'Close settings' }).click()
  await expect(page.getByTestId('slide')).toBeVisible()

  /** The type size and fit scale of the box holding a named slot. */
  const boxType = () =>
    page.evaluate(() => {
      const box = document
        .querySelector('[data-flip-slot="title"]')
        ?.closest('[data-node-id]') as HTMLElement | null
      const cs = box && getComputedStyle(box)
      return cs
        ? {
            fontSize: cs.fontSize,
            fit: cs.getPropertyValue('--fit-scale').trim(),
          }
        : null
    })

  // Wait for the new design to be on screen before measuring it. NYU Bold
  // names the box "Title" where the built-in calls it "Slide title", so the
  // label is the signal that the slide has redrawn — measuring on the way
  // there compares one template's type size against another's.
  await expect(page.getByTitle('Click to edit Title')).toBeVisible()
  const before = await boxType()
  expect(before?.fit).toBe('1')

  await page.locator('[data-flip-slot="title"] [role="button"]').click()
  const field = page.getByRole('textbox', { name: 'Title' })
  await expect(field).toBeVisible()

  // The words are the size they were: the box is not re-fitted around a field
  // whose height is reserved in pixels and cannot answer to a smaller type
  await expect
    .poll(async () => (await boxType())?.fontSize)
    .toBe(before?.fontSize)
  expect((await boxType())?.fit).toBe('1')

  // The hint is on screen and out of the box, so nothing can clip it
  const hint = page.getByText('A label for the paragraph, in capitals.')
  await expect(hint).toBeVisible()
  expect(await hint.evaluate(el => el.parentElement === document.body)).toBe(
    true,
  )
  const rect = await hint.boundingBox()
  const view = page.viewportSize()
  expect(rect).not.toBeNull()
  expect(rect!.y).toBeGreaterThanOrEqual(0)
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(view!.height)

  // A box whose text wraps is edited in a field that wraps
  expect(await field.evaluate(el => el.tagName)).toBe('TEXTAREA')

  // And the hint leaves with the edit
  await page.keyboard.press('Escape')
  await expect(hint).toHaveCount(0)
})
