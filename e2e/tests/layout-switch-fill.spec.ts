/**
 * Content following its box when the USER switches a slide's layout (GEN-9).
 *
 * Distinct from layout-refit.spec.ts, which covers the GEN-8 generation-time
 * re-fit (the model re-laying-out a slide it is updating). This is the manual
 * path — the kebab's layout picker — and it has two halves, deliberately
 * different mechanisms:
 *
 *   - boxes that PAIR keep their content exactly, moved by the shared slot
 *     pairing. No model involved, nothing rewritten.
 *   - boxes the new layout adds and the old one had nothing for are HOLES,
 *     filled by `slide.refitLayout` from whatever the switch could not
 *     place — and that write is undoable, because the user did not ask
 *     for it.
 *
 * Runs against the live stack with the mock generation provider, whose fill
 * splits the orphaned paragraph on sentences.
 */
import { test, expect, type Page } from '@playwright/test'
import { createProject } from './helpers'

const stamp = Date.now()
const user = { email: `lswitch-${stamp}@example.com`, name: 'Switcher' }
const password = 'sturdy-passw0rd'

/** Switches slide 1 to a layout through the kebab's picker. */
const changeLayout = async (page: Page, layout: string, pick: RegExp) => {
  await page.getByRole('button', { name: 'Options for slide 1' }).click()
  await page.getByRole('menuitem', { name: 'Change layout' }).click()
  const dialog = page.getByRole('dialog', { name: 'Change slide layout' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('radio', { name: pick }).click()
  await expect(page.getByTestId('slide').first()).toHaveAttribute(
    'data-layout',
    layout,
  )
}

test('a manual layout switch carries content across, then fills what it could not', async ({
  page,
}) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill(user.name)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)

  await createProject(page, `Switch${stamp}`)
  await page
    .getByRole('button', { name: `Start a new lecture in Switch${stamp}` })
    .click()
  await expect(page).toHaveURL(/\/d\/untitled-/)
  await page.getByRole('button', { name: 'Start lecture' }).click()

  await page.getByLabel('Spoken phrase').fill('Osmosis basics')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toHaveAttribute(
    'data-layout',
    'title',
  )
  const slide = page.getByTestId('slide').first()

  await test.step('a box in both layouts keeps its text exactly', async () => {
    // title -> content: both call the headline `title`, so it pairs by name.
    // (The generator title-cases a short opening phrase.)
    await changeLayout(page, 'content', /^Content/)
    await expect(slide.locator('[data-flip-slot="title"]')).toContainText(
      'Osmosis Basics',
    )
  })

  await test.step('a box that is restyled still pairs, and is not rewritten', async () => {
    await slide.getByText('Add slide body').click()
    await page
      .getByRole('textbox', { name: 'Slide body' })
      .fill('Water crosses the membrane. Solutes stay behind.')
    // A multiline box takes Enter as a newline, so commit with the modifier
    // (Escape would revert the edit).
    await page.keyboard.press('ControlOrMeta+Enter')
    await expect(slide).toContainText('Water crosses the membrane')

    // content -> quote: `body` is in both, styled as a quote in the second.
    // The tier match is what keeps the headline paired here too, since the
    // quote layout has no title box at all.
    await changeLayout(page, 'quote', /^Quote/)
    await expect(slide.locator('[data-flip-slot="body"]')).toContainText(
      'Water crosses the membrane. Solutes stay behind.',
    )
  })

  await test.step('a hole is filled from the content that lost its box', async () => {
    // quote -> list: the paragraph is prose and the new layout wants a list,
    // so the two do not pair. The bullet box is a hole and the paragraph is
    // the source it gets written from.
    await changeLayout(page, 'list', /^Bullet list/)

    // The pill announces the write and offers the undo. Located by its text:
    // the header's health and usage bars are status regions too.
    await expect(
      page.getByText('Filled the boxes this layout added'),
    ).toBeVisible()
    const bullets = slide.getByRole('listitem')
    await expect(
      bullets.filter({ hasText: 'Water crosses the membrane' }),
    ).toHaveCount(1)
    // The transition's clones are cleaned up rather than left on the body.
    await expect(page.locator('body > [data-flip-slot]')).toHaveCount(0)
  })

  await test.step('the fill is undoable; the switch itself is not undone', async () => {
    await page.getByRole('button', { name: 'Undo' }).click()

    await expect(slide).toHaveAttribute('data-layout', 'list')
    await expect(slide.getByRole('listitem')).toHaveCount(0)

    // The undo was saved, not just dropped from the view.
    await page.reload()
    const reloaded = page.getByTestId('slide').first()
    await expect(reloaded).toHaveAttribute('data-layout', 'list')
    await expect(reloaded.getByRole('listitem')).toHaveCount(0)
  })
})
