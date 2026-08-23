/**
 * A side-by-side of the imported NYU Bold design against the deck it came
 * from (TMPL-8) — a reviewable artifact, not an assertion.
 *
 * The question this answers is the one only an eye can: does the import LOOK
 * like its source, with the boxes and decorations roughly where the designer
 * put them. A pixel comparison against Google's rendering would fail on font
 * hinting and antialiasing and tell us nothing about whether the import
 * worked, so nothing here is thresholded. The mechanical properties — nothing
 * clipped, nothing overlapping, nothing off the slide — are asserted
 * separately in `imported-template-fidelity.spec.ts`, where they can fail
 * honestly.
 *
 * ## It asserts as well as photographs
 *
 * The pictures are for a person to judge; the geometry is not left to one.
 * While it is here it walks EVERY layout, which is more than any other test
 * does — the spec that strains a design with a lecture only ever reaches the
 * handful of layouts the generator happens to choose, so most layouts in most
 * designs were never measured in a browser at all. The same rules run on each
 * one as it is photographed: nothing clipped, nothing overlapping, nothing off
 * the slide. A layout that would fail them should not reach the contact sheet
 * looking fine.
 *
 * What that does and does not add is worth being exact about, since it is
 * easy to read as more than it is. Only one slide's worth of content exists
 * here, mapped into whatever slots each layout offers, so a box a layout has
 * nothing to put in stays empty. Geometry is checked everywhere — a box off
 * the slide is off it whether or not anything fills it — while clipping is
 * only visible where a box was given words, and two boxes cannot be caught
 * overlapping unless both were filled. The static audit
 * (`server/src/templates/audit.test.ts`) is the one that sees an overlap in
 * boxes nothing has filled yet, which is why both exist.
 *
 * The pairing is approximate by nature: the importer consolidated 13 slides
 * into 11 layouts, so a layout may stand for more than one slide. The sheet
 * shows both sequences in order and says so, rather than inventing a
 * correspondence the data does not carry.
 */
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect, type APIRequestContext } from './fixtures'
import { faultsOn, settled } from './slide-boxes'
import { createProject } from './helpers'

const OUT = path.resolve('artifacts/nyu-bold')

/**
 * Every layout the import derived, minus the blank slate — a whiteboard is
 * synthesized rather than imported, so it has no source slide to stand beside.
 *
 * Read from the template rather than listed here. The importer renames and
 * renumbers its layouts whenever the derivation changes, so a hard-coded list
 * silently captures the wrong set — or nothing — on the next regeneration.
 */
const LAYOUTS: { type: string; label: string }[] = JSON.parse(
  readFileSync(
    path.resolve('../server/config/templates/nyu-bold.json'),
    'utf8',
  ),
)
  .layouts.filter((l: { type: string }) => l.type !== 'whiteboard')
  .map((l: { type: string; label: string }) => ({
    type: l.type,
    label: l.label,
  }))

/** Every distinct picture the design draws itself with. */
const DECORATION_PICTURES: string[] = [
  ...new Set(
    (
      JSON.parse(
        readFileSync(
          path.resolve('../server/config/templates/nyu-bold.json'),
          'utf8',
        ),
      ).layouts as { decoration?: { imageUrl?: string }[] }[]
    ).flatMap(layout =>
      (layout.decoration ?? [])
        .map(piece => piece.imageUrl)
        .filter((url): url is string => Boolean(url)),
    ),
  ),
]

/**
 * Makes the design's own pictures reachable, and refuses to photograph it if
 * they are not.
 *
 * The e2e server is started from THIS directory, so its `STORAGE_LOCAL_DIR` of
 * `.uploads-e2e` means `e2e/.uploads-e2e` — while an import run by hand writes
 * to `server/.uploads`. The pictures are then on disk, the template refers to
 * them, and every one of them 404s. Nothing fails: the slides simply render
 * without their photographs, and the comparison sheet comes out looking like
 * the import lost them.
 *
 * That is the worst kind of pass — a believable artifact of a defect that does
 * not exist. So the files are copied where the server actually reads, and then
 * checked over HTTP. A sheet with no pictures in it should be a failed run,
 * not a quiet one.
 */
const stagePictures = async (request: APIRequestContext) => {
  const into = path.resolve('.uploads-e2e/templates/nyu-bold')
  const from = path.resolve('../server/.uploads/templates/nyu-bold')
  // Copied every run rather than only when the directory is missing: a
  // regenerated template refers to different files, and a stale copy from a
  // previous round would leave the new ones 404ing while the folder looks
  // populated.
  if (existsSync(from)) cpSync(from, into, { recursive: true })
  for (const url of DECORATION_PICTURES) {
    const response = await request.get(url)
    expect(
      response.status(),
      `${url} is not being served — the design would be photographed without ` +
        `its pictures. Copy server/.uploads/templates/nyu-bold into ` +
        `e2e/.uploads-e2e/templates/.`,
    ).toBe(200)
  }
}

test('captures every imported layout beside its source deck', async ({
  page,
  request,
}) => {
  mkdirSync(OUT, { recursive: true })
  await stagePictures(request)
  // The slide morphs between layouts (GEN-9), and a screenshot taken mid-flight
  // catches text at partial opacity or drawn twice at two positions — which
  // reads as a design defect and is not one. `layoutFlip.ts` already skips the
  // morph under `prefers-reduced-motion`, so this asks the app for the still
  // frame through its own opt-out rather than overriding its CSS from outside
  // and hoping the override reaches everything.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const email = `cmp-${Date.now()}@example.com`
  await page.goto('/register')
  await page.getByLabel('Display name').fill('Compare')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('sturdy-passw0rd')
  await page.getByRole('button', { name: 'Create account' }).click()

  await createProject(page, 'Compare')
  await page
    .getByRole('button', { name: 'Start a new lecture in Compare' })
    .click()
  await page.getByRole('button', { name: 'Start lecture' }).click()
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  await page.getByRole('tab', { name: 'Design' }).click()
  await page.getByRole('radio', { name: /nyu bold/i }).click()
  await page.getByRole('button', { name: 'Close settings' }).click()

  // Something in the boxes, so a layout is photographed holding a lecture
  // rather than empty — an empty design shows its geometry and none of its
  // typography, which is half of what there is to review.
  await page
    .getByLabel('Spoken phrase')
    .fill('Rainwater harvesting on the Manhattan campus')
  await page.getByRole('button', { name: 'Speak' }).click()
  await expect(page.getByText('1 / 1')).toBeVisible({ timeout: 15_000 })

  const slide = page.getByTestId('slide').first()
  const faults: string[] = []
  for (const layout of LAYOUTS) {
    await page.getByRole('button', { name: 'Options for slide 1' }).click()
    await page.getByRole('menuitem', { name: 'Change layout' }).click()
    const dialog = page.getByRole('dialog', { name: 'Change slide layout' })
    await expect(dialog).toBeVisible()
    // Each radio reads as its label followed by the layout's purpose, and
    // "Title" is a prefix of "Title 2" — so it is matched on the label line
    // exactly rather than by a name pattern that would take the wrong one.
    const radios = dialog.getByRole('radio')
    const labels = (await radios.allInnerTexts()).map(t =>
      (t.split('\n')[0] ?? '').trim(),
    )
    const which = labels.indexOf(layout.label)
    expect(which, `no layout offered called "${layout.label}"`).toBeGreaterThan(
      -1,
    )
    await radios.nth(which).click()
    await expect(slide).toHaveAttribute('data-layout', layout.type)
    // Switching layout raises a toast offering to undo the boxes it filled,
    // and it sits over the slide. Photographing it would put a piece of the
    // editor's furniture in the middle of every comparison the user is being
    // asked to judge the DESIGN by.
    const toast = page.getByText(/Filled the boxes this layout added/)
    await toast.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {})
    // Belt and braces: whatever the opt-out does not cover, wait for the
    // browser itself to say nothing is still animating. Waiting on the
    // condition rather than on a duration — a fixed pause is either too short
    // on a loaded machine or wasted on a fast one.
    await settled(page)
    await slide.screenshot({
      path: path.join(OUT, `imported-${layout.type}.png`),
    })
    faults.push(...(await faultsOn(slide, `layout ${layout.type}`)))
  }

  // After the captures, so a failing layout is still photographed and can be
  // looked at rather than only read about.
  expect(faults, faults.join('\n')).toEqual([])
})
