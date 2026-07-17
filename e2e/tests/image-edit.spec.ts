/**
 * Slide image editing end to end (EDIT-1): an owner adds, replaces, and
 * removes a slide's image. Removing the image from an image+text slide
 * drops it to a text layout; removing it from an image-only slide deletes
 * the slide after a confirm.
 */
import { test, expect, type Page } from '@playwright/test'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const png = (name: string) => ({ name, mimeType: 'image/png', buffer: PNG })

/** Registers a user and opens a new lecture with one dictated slide. */
const newLectureWithSlide = async (page: Page, tag: string) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Imager')
  await page
    .getByLabel('Email')
    .fill(`imgedit-${tag}-${Date.now()}@example.com`)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('New project title').fill(`ImgProj-${tag}`)
  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByRole('link', { name: `ImgProj-${tag}`, exact: true }).click()
  await page.getByRole('button', { name: 'Start a new lecture' }).click()
  await expect(page).toHaveURL(/\/d\//)
  await page.getByRole('button', { name: 'Start lecture' }).click()
  await page.getByLabel('Spoken phrase').fill('Cells are the unit of life')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toBeVisible()
}

/** Switches the current slide to a named layout via its kebab menu. */
const setLayout = async (page: Page, label: RegExp) => {
  await page.getByRole('button', { name: 'Options for slide 1' }).click()
  await page.getByRole('menuitem', { name: 'Change layout' }).click()
  await page.getByRole('radio', { name: label }).click()
}

test('add, replace, then remove an image on an image+text slide', async ({
  page,
}) => {
  await newLectureWithSlide(page, 'twocol')
  await setLayout(page, /Two column/)

  // The empty image slot offers Add; setting the hidden input uploads
  await expect(page.getByRole('button', { name: 'Add image' })).toBeVisible()
  await page.getByLabel('Upload image file').setInputFiles(png('cell.png'))
  // Once set, the image controls (Replace/Remove) appear
  await expect(page.getByRole('button', { name: 'Remove image' })).toBeVisible()
  const slideImg = page.getByTestId('slide').locator('img')
  await expect(slideImg).toBeVisible()
  const firstSrc = await slideImg.getAttribute('src')

  // Replace with another upload — the image must actually change, not just
  // keep its controls (each upload gets a fresh unguessable URL)
  await page.getByLabel('Upload image file').setInputFiles(png('cell2.png'))
  await expect(page.getByRole('button', { name: 'Remove image' })).toBeVisible()
  await expect(async () => {
    expect(await slideImg.getAttribute('src')).not.toBe(firstSrc)
  }).toPass()

  // Removing the image drops the slide to a plain text layout, no confirm
  await page.getByRole('button', { name: 'Remove image' }).click()
  await expect(page.getByTestId('slide')).toHaveAttribute(
    'data-layout',
    'content',
  )
  await expect(page.getByRole('button', { name: 'Remove image' })).toHaveCount(
    0,
  )
})

test('image button labels stay hidden until the specific icon is hovered', async ({
  page,
}) => {
  await newLectureWithSlide(page, 'tips')
  await setLayout(page, /Two column/)
  await page
    .getByLabel('Upload image file')
    .setInputFiles({ name: 'x.png', mimeType: 'image/png', buffer: PNG })
  await expect(page.getByRole('button', { name: 'Remove image' })).toBeVisible()

  const label = page.getByText('Replace image', { exact: true })
  const opacity = () => label.evaluate(el => getComputedStyle(el).opacity)

  // Hovering the image reveals the control buttons — but NOT their labels.
  // The bug was that every nested tooltip lit up with the image group.
  await page.getByTestId('slide').hover()
  expect(await opacity()).toBe('0')

  // Only hovering the Replace icon itself reveals its label
  await page.getByRole('button', { name: 'Replace image' }).hover()
  await expect.poll(opacity).toBe('1')
})

test('an uploaded slide image also appears in seed material', async ({
  page,
}) => {
  await newLectureWithSlide(page, 'seedlink')
  await setLayout(page, /Two column/)
  await page
    .getByLabel('Upload image file')
    .setInputFiles({ name: 'diagram.png', mimeType: 'image/png', buffer: PNG })
  await expect(page.getByRole('button', { name: 'Remove image' })).toBeVisible()

  // The upload is registered as lecture seed material
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  await expect(
    page
      .getByRole('dialog', { name: 'Lecture settings' })
      .getByText('diagram.png'),
  ).toBeVisible()
})

test('image attribution: an owner sets it, it persists and shows via the i icon', async ({
  page,
}) => {
  await newLectureWithSlide(page, 'attr')
  await setLayout(page, /Two column/)
  await page.getByLabel('Upload image file').setInputFiles(png('cell.png'))
  await expect(page.getByRole('button', { name: 'Remove image' })).toBeVisible()

  // The "i" icon opens the attribution dialog; fill in credit + license
  await page.getByRole('button', { name: 'Image details' }).click()
  const dialog = page.getByRole('dialog', { name: 'Image details' })
  await dialog.getByLabel('Credit').fill('Ada Lovelace')
  await dialog.getByLabel('License').fill('CC BY 4.0')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).not.toBeVisible()

  // It persists across a reload and is shown when reopened
  await page.reload()
  await page.getByRole('button', { name: 'Image details' }).click()
  const reopened = page.getByRole('dialog', { name: 'Image details' })
  await expect(reopened.getByLabel('Credit')).toHaveValue('Ada Lovelace')
  await expect(reopened.getByLabel('License')).toHaveValue('CC BY 4.0')
})

test('removing the image from an image-only slide deletes it after a confirm', async ({
  page,
}) => {
  await newLectureWithSlide(page, 'imageonly')
  // A second slide, so deleting the first leaves something behind
  await page.getByLabel('Spoken phrase').fill('Organelles do the work')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByTestId('slide')).toBeVisible()

  await setLayout(page, /^Image/)
  await page.getByLabel('Upload image file').setInputFiles(png('whole.png'))
  await expect(page.getByRole('button', { name: 'Remove image' })).toBeVisible()

  await page.getByRole('button', { name: 'List view' }).click()
  const before = await page.getByTestId('slide').count()

  // Back to carousel, remove the image → confirm → the slide is deleted
  await page.getByRole('button', { name: 'Carousel view' }).click()
  await page.getByRole('button', { name: 'Remove image' }).click()
  await expect(
    page.getByRole('alertdialog', { name: 'Delete this slide?' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Delete slide' }).click()

  await page.getByRole('button', { name: 'List view' }).click()
  await expect(page.getByTestId('slide')).toHaveCount(before - 1)
})
