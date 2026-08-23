/**
 * What a rendered slide's boxes actually do, measured in a real browser.
 *
 * Shared by the two specs that need the same answer: the one that writes a
 * lecture designed to strain a design, and the one that photographs every
 * layout for review. Kept in one place because the rules below are not
 * obvious — five of them each cost a round of debugging to arrive at — and
 * two copies would drift into two answers to one question, which is the
 * mistake `server/src/import/text-metrics.ts` was extracted to prevent.
 *
 * ## What counts as a fault, and what only looks like one
 *
 * Measured by tree NODE (`data-node-id`) rather than by slot: a slot's
 * wrapper hugs its text while the node is the box the design reserves, so two
 * boxes can overlap as designed while their wrappers never touch.
 *
 * Clipping is only a fault where WORDS are hidden. A picture in a box of
 * different proportions is cropped on purpose — that is what `object-fit:
 * cover` is for — and it reports exactly like clipping.
 *
 * An affordance is not content. An empty picture box draws "Add image" at an
 * intrinsic size far larger than the box; an empty text box draws "Click to
 * add text" inside a box that may be laid out at zero height, overflowing by
 * its whole height. Neither is anything a reader would see cut off. Both are
 * excluded by letting the app say what is furniture — the `aria-hidden` it
 * already sets and the `slot-blank` it already marks empty slots with —
 * rather than by matching on the wording, which would hold only in English.
 *
 * Overlap is text over text only. An imported design routinely lays a title
 * over a full-slide photograph, and flagging that would bury the real faults
 * under designs that are working correctly.
 */
import { type Locator, type Page } from './fixtures'

/** Rounding slack, as a fraction of the slide. Sub-pixel differences are not
 * a design fault. */
export const EPS = 0.004

/**
 * Overflow below this is layout noise rather than hidden content, in pixels.
 *
 * Chromium reports `scrollWidth` a few pixels over `clientWidth` on text boxes
 * that are not clipping anything — measured at a constant 4px on boxes of
 * 1527px and 139px alike, with identical scroll and client heights. A real
 * clip is not constant: it scales with the words that did not fit, and hides
 * hundreds of pixels rather than four. Eight is about one character at the
 * smallest size this app sets text in, so nothing a reader could notice is
 * dismissed.
 */
export const NOISE = 8

/**
 * Waits for the slide itself to stop moving.
 *
 * Not "no animation anywhere": the app keeps indefinitely-repeating ones
 * running elsewhere on the page — a pulse on the record indicator, and the
 * like — so waiting on all of them never returns. Only animations whose
 * target is inside the slide count, and endlessly repeating ones are ignored
 * however they are scoped, since they are never going to finish.
 *
 * Belt and braces over `prefers-reduced-motion`, which the app already
 * honours, so a timeout here is not worth failing a run over.
 */
export const settled = (page: Page) =>
  page
    .waitForFunction(
      () => {
        const slide = document.querySelector('[data-testid="slide"]')
        if (!slide) return false
        return document.getAnimations().every(animation => {
          const effect = animation.effect as KeyframeEffect | null
          const target = effect?.target ?? null
          if (!target || !slide.contains(target)) return true
          if (effect?.getTiming().iterations === Infinity) return true
          return animation.playState !== 'running'
        })
      },
      undefined,
      { timeout: 5_000 },
    )
    .catch(() => {})

/** Every box the design reserves on a rendered slide, as fractions of the
 * slide, with how far each one's content runs past it. */
export const boxesOf = (slide: Locator) =>
  slide.evaluate(el => {
    const frame = el.getBoundingClientRect()
    return [...el.querySelectorAll('[data-node-id]')]
      .filter(node => !node.querySelector('[data-node-id]'))
      .map(node => {
        const r = node.getBoundingClientRect()
        const style = getComputedStyle(node)
        return {
          id: node.getAttribute('data-node-id') ?? '?',
          x: (r.x - frame.x) / frame.width,
          y: (r.y - frame.y) / frame.height,
          w: r.width / frame.width,
          h: r.height / frame.height,
          // Only meaningful where the box actually CLIPS: `scrollWidth`
          // exceeds `clientWidth` on any element whose content spills, but
          // under `overflow: visible` the words are still drawn and still
          // read. Spill that leaves the slide is caught by the bounds check
          // instead, which is where it costs the reader something.
          clips: /hidden|auto|scroll|clip/.test(
            [style.overflow, style.overflowX, style.overflowY].join(' '),
          ),
          overflowY: node.scrollHeight - node.clientHeight,
          overflowX: node.scrollWidth - node.clientWidth,
          // Where the GLYPHS actually are, which is not where the box is.
          // A dense design draws its boxes a hair wider than their pitch, so
          // neighbours in a grid overlap as rectangles while nothing a reader
          // sees touches: measured on one catalogue page, 60% of overlapping
          // box pairs had zero text overlap and the rest were affordances.
          // Overlap is judged on this rather than on the box.
          textBox: (() => {
            const range = document.createRange()
            range.selectNodeContents(node)
            const t = range.getBoundingClientRect()
            range.detach()
            return t.width && t.height
              ? {
                  x: (t.x - frame.x) / frame.width,
                  y: (t.y - frame.y) / frame.height,
                  w: t.width / frame.width,
                  h: t.height / frame.height,
                }
              : null
          })(),
          hasText: (() => {
            if (node.querySelector('img') || node.tagName === 'IMG')
              return false
            const clone = node.cloneNode(true) as HTMLElement
            clone
              .querySelectorAll('[aria-hidden="true"], .slot-blank')
              .forEach(furniture => furniture.remove())
            return (clone.textContent ?? '').trim().length > 0
          })(),
        }
      })
  })

export type SlideBox = Awaited<ReturnType<typeof boxesOf>>[number]

/** How much of the slide two boxes share. Zero when they merely touch. */
/** A rectangle as a fraction of the slide. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export const overlapArea = (a: Rect, b: Rect): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > EPS && h > EPS ? w * h : 0
}

/**
 * Everything wrong with one rendered slide, as lines a reader can act on.
 *
 * `where` names the slide or layout for the message; `why` is the reason this
 * particular content was chosen, where the caller has one, so a fault says
 * what was being tested as well as what broke.
 */
export const faultsOn = async (
  slide: Locator,
  where: string,
  why?: string,
): Promise<string[]> => {
  const boxes = await boxesOf(slide)
  const faults: string[] = []
  const because = why ? ` — ${why}` : ''
  if (!boxes.length) return [`${where} reserved no boxes at all`]

  for (const box of boxes) {
    if (
      box.hasText &&
      box.clips &&
      (box.overflowY > NOISE || box.overflowX > NOISE)
    )
      faults.push(
        `${where} "${box.id}" hides its content ` +
          `(${box.overflowX}px wide, ${box.overflowY}px tall)${because}`,
      )
    if (
      box.x < -EPS ||
      box.y < -EPS ||
      box.x + box.w > 1 + EPS ||
      box.y + box.h > 1 + EPS
    )
      faults.push(
        `${where} "${box.id}" runs off the slide ` +
          `(x ${box.x.toFixed(3)} y ${box.y.toFixed(3)} ` +
          `w ${box.w.toFixed(3)} h ${box.h.toFixed(3)})`,
      )
  }

  // Compared on the text, not the container — see `textBox`. A box with no
  // measurable text extent cannot collide with anything.
  const worded = boxes.filter(box => box.hasText && box.textBox)
  for (let a = 0; a < worded.length; a++)
    for (let b = a + 1; b < worded.length; b++) {
      const shared = overlapArea(worded[a]!.textBox!, worded[b]!.textBox!)
      if (shared > 0)
        faults.push(
          `${where} "${worded[a]!.id}" and "${worded[b]!.id}" overlap over ` +
            `${(shared * 100).toFixed(1)}% of the slide — both are showing text`,
        )
    }
  return faults
}
