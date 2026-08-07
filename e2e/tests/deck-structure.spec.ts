/**
 * Deck-structure section awareness (GENERATION_DECK_STRUCTURE, on by default):
 * once a few slides have accrued since the opening title, a section-cue phrase
 * opens a NEW section heading rather than another content slide — driven by the
 * outline + positional signals the server now sends the model. Runs against the
 * built app + test MongoDB with the mock provider, like the other specs.
 */
import { test, expect } from './fixtures'
import { createProject } from './helpers'

const password = 'sturdy-passw0rd'

test('a section-cue phrase opens a section slide once past the opening heading', async ({
  page,
}) => {
  const email = `structure-${Date.now()}@example.com`
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Structurer')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await createProject(page, 'Arithmetic')
  await page
    .getByRole('button', { name: 'Start a new lecture in Arithmetic' })
    .click()
  await expect(page).toHaveURL(/\/d\/untitled-/)
  await page.getByRole('button', { name: 'Start lecture' }).click()

  const speak = async (phrase: string) => {
    await page.getByLabel('Spoken phrase').fill(phrase)
    await page.getByRole('button', { name: 'Speak' }).click()
  }

  // Opening short phrase → a title (header) slide.
  await speak('Fractions')
  await expect(page.getByTestId('slide')).toHaveAttribute(
    'data-layout',
    'title',
  )

  // Two content slides accrue, so slidesSinceHeader reaches 2.
  await speak('A fraction represents part of a whole thing')
  await expect(page.getByTestId('slide')).toHaveAttribute(
    'data-layout',
    'content',
  )
  await speak('The denominator sits below the fraction bar')
  await expect(page.getByText('3 / 3')).toBeVisible()

  // A section-cue phrase now opens a NEW section heading (not a content slide),
  // because the deck structure shows several slides since the last heading.
  await speak('Next, subtracting fractions from each other')
  await expect(page.getByTestId('slide')).toHaveAttribute(
    'data-layout',
    'section',
  )
  await expect(page.getByText('4 / 4')).toBeVisible()
})
