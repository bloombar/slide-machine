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
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import path from 'node:path'
import { test, expect, type APIRequestContext } from './fixtures'
import { faultsOn, settled } from './slide-boxes'
import { createProject, pickLayout } from './helpers'

const OUT = path.resolve(process.env.COMPARE_OUT ?? 'artifacts/nyu-bold')

/**
 * Every layout the import derived, minus the blank slate — a whiteboard is
 * synthesized rather than imported, so it has no source slide to stand beside.
 *
 * Read from the template rather than listed here. The importer renames and
 * renumbers its layouts whenever the derivation changes, so a hard-coded list
 * silently captures the wrong set — or nothing — on the next regeneration.
 */
/**
 * The design under review, and where its pictures go.
 *
 * Overridable, because this walk — every layout, photographed and measured —
 * is what verifying ANY imported design needs, not only the first one it was
 * written for. `COMPARE_TEMPLATE` and `COMPARE_OUT` point it at another.
 */
const TEMPLATE_FILE = path.resolve(
  process.env.COMPARE_TEMPLATE ?? '../server/config/templates/nyu-bold.json',
)

/**
 * Whether the design this spec is about is installed at all.
 *
 * It is a template DERIVED from someone's deck and installed for review, not
 * one the app ships, so it comes and goes. Read once, and guarded: reading it
 * unconditionally at module scope threw `ENOENT` in CI the moment the file was
 * removed, which fails the whole e2e stage rather than this one spec — and it
 * failed only in CI, because the local gate never runs e2e.
 *
 * The test skips loudly when it is absent rather than passing over an empty
 * design list. A spec that quietly succeeds because its subject is missing is
 * the exact green that means nothing ran.
 */
const INSTALLED = existsSync(TEMPLATE_FILE)

interface DerivedTemplate {
  name?: string
  layouts: {
    type: string
    label: string
    decoration?: { imageUrl?: string }[]
  }[]
}

const TEMPLATE: DerivedTemplate = INSTALLED
  ? (JSON.parse(readFileSync(TEMPLATE_FILE, 'utf8')) as DerivedTemplate)
  : { layouts: [] }

/** The name the design is offered under, escaped for use as a pattern. */
const DESIGN_NAME = new RegExp(
  (TEMPLATE.name ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') || 'nyu bold',
  'i',
)

const LAYOUTS = TEMPLATE.layouts
  .filter(layout => layout.type !== 'whiteboard')
  .map(layout => ({ type: layout.type, label: layout.label }))

/** Every distinct picture the design draws itself with. */
const DECORATION_PICTURES: string[] = [
  ...new Set(
    TEMPLATE.layouts.flatMap(layout =>
      (layout.decoration ?? [])
        .map(piece => piece.imageUrl)
        .filter((url): url is string => Boolean(url)),
    ),
  ),
]
/** How storage addresses a picture it holds, as opposed to one that ships. */
const UPLOAD_PREFIX = '/api/files/'

/**
 * Makes the design's own pictures reachable, and refuses to photograph it if
 * they are not.
 *
 * A design's pictures come from one of two places, and only one of them needs
 * anything done to it.
 *
 * An IMPORTED design's pictures were uploaded, so they live in storage and are
 * addressed `/api/files/<key>`. The e2e server is started from THIS directory,
 * so its `STORAGE_LOCAL_DIR` of `.uploads-e2e` means `e2e/.uploads-e2e` —
 * while an import run by hand writes to `server/.uploads`. The pictures are
 * then on disk, the template refers to them, and every one of them 404s.
 * Nothing fails: the slides simply render without their photographs, and the
 * comparison sheet comes out looking like the import lost them. So those are
 * copied where the server actually reads.
 *
 * A SHIPPED built-in's pictures are already in the repo and are addressed
 * `/templates/<id>/<file>`, served by the API itself out of
 * `server/config/templates/assets/` (`server/src/templates/assets.ts`).
 * `TEMPLATES_DIR` defaults from the server module's own location rather than
 * from the working directory, so those are reachable from here already and
 * there is nothing to stage.
 *
 * Telling the two apart is not tidiness. Putting a built-in URL through the
 * upload path does worse than nothing: stripping a prefix the URL does not
 * carry leaves it absolute, and `path.resolve` against an absolute path
 * discards the base it was given — so both source and destination collapse to
 * `/templates/<id>` at the filesystem root, and the copy silently no-ops
 * because nothing is there.
 *
 * Either way the pictures are then checked over HTTP, because being served is
 * the only property the browser about to photograph them cares about, and it
 * is the same question for both kinds. A sheet with no pictures in it should
 * be a failed run, not a quiet one.
 */
const stagePictures = async (request: APIRequestContext) => {
  // Which folders to stage is read from the design's own picture URLs, not
  // hard-coded: pointing this spec at another design must not mean
  // remembering to change a path here as well.
  const folders = new Set(
    DECORATION_PICTURES.filter(url => url.startsWith(UPLOAD_PREFIX))
      .map(url =>
        url.slice(UPLOAD_PREFIX.length).split('/').slice(0, -1).join('/'),
      )
      .filter(Boolean),
  )
  for (const folder of folders) {
    const into = path.resolve('.uploads-e2e', folder)
    const from = path.resolve('../server/.uploads', folder)
    // Copied every run rather than only when the directory is missing: a
    // regenerated template refers to different files, and a stale copy from a
    // previous round would leave the new ones 404ing while the folder looks
    // populated.
    if (existsSync(from)) cpSync(from, into, { recursive: true })
  }
  for (const url of DECORATION_PICTURES) {
    const response = await request.get(url)
    // Said differently for each kind, because the thing to go and look at is
    // different: a missing upload is a staging problem, a missing built-in
    // picture is a file that is not in the repo or is not named what the
    // template says it is.
    const remedy = url.startsWith(UPLOAD_PREFIX)
      ? `Copy the design's pictures from server/.uploads into e2e/.uploads-e2e ` +
        `(same sub-path), or re-run the import with the e2e storage directory.`
      : `A shipped design serves its pictures from server/config/templates/assets/ ` +
        `— check the file is committed there and that its name matches the ` +
        `decoration URL in the template JSON.`
    expect(
      response.status(),
      `${url} is not being served — the design would be photographed without ` +
        `its pictures. ${remedy}`,
    ).toBe(200)
    // And that a picture is what came back. A 200 on its own is not enough to
    // conclude that: the SPA fallback answers an unknown path with index.html
    // at 200, so if a picture ever fell through to it — a mount order changed,
    // a prefix renamed — a status check would be satisfied while the design
    // still photographs blank. That is the same believable-wrong-artifact this
    // whole helper exists to prevent, so it is checked rather than assumed.
    expect(
      response.headers()['content-type'] ?? '',
      `${url} was served, but not as an image — it is being answered by ` +
        `something other than the picture (the SPA fallback answers unknown ` +
        `paths with HTML at status 200). ${remedy}`,
    ).toMatch(/^image\//)
  }
}

test('captures every imported layout beside its source deck', async ({
  page,
  request,
}) => {
  /*
   * A budget, not a threshold. This walks EVERY layout, switching layout and
   * waiting for the morph to settle and taking a screenshot on each — two
   * orders of magnitude more work than the specs the 30-second default was
   * chosen for. At the default it died part-way through and reported the page
   * as closed, which reads like a crash and is only a clock; worse, it left a
   * partial contact sheet, which is the one output nobody should be asked to
   * judge a design from.
   */
  test.setTimeout(300_000)
  // Said out loud, and as a skip rather than a pass: this spec is about a
  // design that is installed for review and removed again, so "not run" is a
  // normal outcome — but it must never be mistaken for "checked and fine".
  test.skip(
    !INSTALLED,
    `${TEMPLATE_FILE} is not installed, so there is no derived design to ` +
      `photograph or measure. Install the template to run this.`,
  )
  // And it must not pass by having nothing to do: if the file IS there, it has
  // to describe layouts, or the walk below covers none of them silently.
  expect(
    LAYOUTS.length,
    'the installed template declares no layouts',
  ).toBeGreaterThan(0)
  mkdirSync(OUT, { recursive: true })
  /*
   * Clear this run's own pictures before taking any.
   *
   * The importer renames and renumbers layouts whenever the derivation
   * changes, so a previous round's files sit here under names the design no
   * longer has — `imported-title-4.png`, `imported-content-2.png` — and the
   * sheet is built by reading the directory. Measured on this design: nine
   * stale pictures of layouts that do not exist, alongside sixteen current
   * ones, all looking equally current.
   *
   * That is the worst kind of artifact to hand someone. The reviewer is being
   * asked to judge a design by eye, and cannot tell from an image whether the
   * layout it shows is still in the design — so a stale picture reads as a
   * real layout, and a stale BAD picture reads as a real defect. Only this
   * spec's own output is removed, by prefix, so anything else left here for
   * another purpose survives.
   */
  for (const file of existsSync(OUT) ? readdirSync(OUT) : [])
    if (file.startsWith('imported-') && file.endsWith('.png'))
      rmSync(path.join(OUT, file))
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
  // Chosen by the name the template carries, so pointing this spec at another
  // design needs no edit here.
  await page.getByRole('radio', { name: DESIGN_NAME }).click()
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
    await pickLayout(dialog, layout.label)
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
