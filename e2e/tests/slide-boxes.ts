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
 * Leading tight enough that a face hangs its descenders outside the line box.
 *
 * Matches `useFitText`'s own `TIGHT_LEADING`, and for the same reason: below
 * about 1.2 the glyphs stop fitting the line box they are set on.
 */
export const TIGHT_LEADING = 1.2

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
          // How far the box had to shrink its own type to fit what it holds.
          //
          // `useFitText` steps a box's type down until its content fits, and
          // writes the factor here as an inline custom property. That is the
          // right behaviour for a deck imported from elsewhere, and it is
          // also the reason a box can be badly wrong while every other
          // measurement on it reads clean: the box keeps its geometry, the
          // content ends up fitting, and nothing clips, overlaps or leaves
          // the slide. A design whose leading or budgets are wrong is
          // converted silently into smaller type.
          //
          // So the factor is captured rather than inferred. 1 means the box
          // drew at the size the design asked for; below 1 it gave way. The
          // floor is `MIN_SCALE` (0.4) in `useFitText`, past which the box
          // switches to scrolling — only THAT is visible as a clip.
          fitScale: (() => {
            const raw = getComputedStyle(node)
              .getPropertyValue('--fit-scale')
              .trim()
            const value = Number.parseFloat(raw)
            return Number.isFinite(value) ? value : 1
          })(),
          // The type this box actually drew at, after the design's own
          // sizing and any shrink above. Reported rather than asserted here
          // because what counts as right depends on the design: a caller
          // comparing a template against the deck it came from needs the
          // ratio the browser resolved, not the number written in a file.
          fontSizePx: Number.parseFloat(style.fontSize) || 0,
          // The box as the browser actually laid it out. The fractions above
          // say where it sits; these say how much room it has, which is what
          // a capacity claim is about — and what anyone diagnosing an
          // over-budgeted box needs, since the estimate is arithmetic over
          // exactly these two numbers and the type size.
          widthPx: r.width,
          heightPx: r.height,
          // Line-height as a MULTIPLE of the font size, which is how a
          // design states it and how a source deck states it. `normal`
          // resolves to a number here, so it is comparable either way; a box
          // with no text to set gives 0 and callers skip it.
          leading: (() => {
            const size = Number.parseFloat(style.fontSize)
            const line = Number.parseFloat(style.lineHeight)
            return Number.isFinite(size) && Number.isFinite(line) && size > 0
              ? line / size
              : 0
          })(),
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
          // Furniture the design draws, as the app itself marks it. A
          // decoration is not a box the reader is missing content from.
          furniture: node.getAttribute('aria-hidden') === 'true',
          // Whether the app itself says this box is an EMPTY slot rather
          // than an unexplained gap. An empty slot draws the editor's
          // invitation to fill it, marked `slot-blank` — a deliberate
          // affordance, not a hole, and not anything a reader of a finished
          // deck ever sees.
          blank: Boolean(
            node.querySelector('.slot-blank, button, [role="button"]'),
          ),
          // A picture is content even though it has no text, so a box
          // holding one is not an empty box.
          hasImage: Boolean(
            node.querySelector('img') || node.tagName === 'IMG',
          ),
          // How much text the box actually held when measured.
          //
          // Provenance, not diagnosis. Two measurement runs on this project
          // looked exactly like valid ones until the counts were visible —
          // one box held 210 characters where 141 were typed, another 17.
          // A pixel height is only interpretable against what was in the box,
          // so every fault below carries the count it was measured with.
          chars: (() => {
            const clone = node.cloneNode(true) as HTMLElement
            clone
              .querySelectorAll('[aria-hidden="true"], .slot-blank')
              .forEach(f => f.remove())
            return (clone.textContent ?? '').trim().length
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
    // The vertical slack the RENDERER allows before it calls content hidden,
    // rather than a flat threshold of this module's own.
    //
    // `useFitText` shrinks a box's type until its content fits, and decides
    // "fits" with an explicit model: a quarter of an em for a box led under
    // 1.2, where the face hangs its descenders outside the line box, and a
    // pixel of rounding everywhere else. Below that it does not shrink,
    // because it has judged nothing to be hidden.
    //
    // Where this module disagreed with that model it reported as "hides its
    // content" precisely what the app had decided was visible — and on the
    // first design to arrive led under 1.2 that was a fault on every display
    // title at once. The app draws the slide, so the app is the authority on
    // what a reader loses; matching its model is aligning the instrument with
    // the program rather than widening a threshold to get past it. Overrun
    // beyond one line is still a line that did not fit, and still fails.
    const slack =
      box.leading > 0 && box.leading < TIGHT_LEADING
        ? Math.max(NOISE, box.fontSizePx * 0.25)
        : NOISE
    if (
      box.hasText &&
      box.clips &&
      (box.overflowY > slack || box.overflowX > NOISE)
    )
      faults.push(
        `${where} "${box.id}" hides its content ` +
          `(${box.overflowX}px wide, ${box.overflowY}px tall; ` +
          `allowed ${slack.toFixed(1)}px at leading ` +
          `${box.leading.toFixed(2)} on ${box.fontSizePx.toFixed(1)}px, ` +
          `holding ${box.chars} chars)${because}`,
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

/**
 * The type size a box is allowed to give up before it counts against the
 * design, as a fraction of what the design asked for.
 *
 * **The target is 1.0.** A budget is a claim about what the box holds, so if
 * filling the box to that claim needs the type shrunk, the claim is false —
 * that is what over-budgeted means. `useFitText` exists for content that
 * exceeds a design's expectations, not for content at the design's own stated
 * limit.
 *
 * The number below is 1.0 minus one renderer step, and nothing more. The
 * shrink search moves in 24 increments from 1.0 to 0.4, so a step is 0.025
 * and 0.975 is the smallest non-unity scale that can be observed at all. It
 * absorbs measurement and rounding. It is NOT the standard, and it does not
 * absorb a known cause: if a defect is fixed and boxes still sit here, that
 * is a finding rather than a rounding.
 *
 * It was 0.9 first — roughly two steps — which would have licensed a budget
 * wrong by two steps and called it correct.
 */
export const MIN_HONEST_SCALE = 0.975

/**
 * Boxes that only fit because the app made their type smaller.
 *
 * Separate from `faultsOn`, and deliberately not folded into it. Shrinking is
 * correct behaviour for a deck imported from somewhere else, which arrives as
 * full as its author made it — flagging it there would turn designs red for
 * doing the right thing.
 *
 * It is a fault in one specific circumstance: when the box was given no more
 * than the design's OWN stated budget for it. Then the budget, the leading
 * and the box disagree, and the shrink is the arithmetic being wrong rather
 * than the content being long.
 *
 * This is the only rule that can see a wrong line-height. A box whose leading
 * is too large needs more height than it has, so the type gives way until it
 * fits — after which nothing clips, nothing overlaps, nothing leaves the
 * slide, and every other measurement reads exactly as it would on a design
 * that was correct. What is left is smaller type, and only this reports it.
 */
export const shrunkOn = async (
  slide: Locator,
  where: string,
  why?: string,
): Promise<string[]> => {
  const boxes = await boxesOf(slide)
  const because = why ? ` — ${why}` : ''
  return boxes
    .filter(box => box.hasText && box.fitScale < MIN_HONEST_SCALE)
    .map(box => {
      // What the box can show at the size it was asked to draw at, so the
      // report carries its own arithmetic rather than an assertion that a
      // reader has to go and re-derive. Lines are the honest unit: a budget
      // is characters across times lines down, and it is nearly always the
      // "down" that fails.
      const designPx = box.fitScale > 0 ? box.fontSizePx / box.fitScale : 0
      const lineAt = (size: number) => size * (box.leading || 1)
      const linesShown = lineAt(designPx)
        ? Math.floor(box.heightPx / lineAt(designPx))
        : 0
      return (
        `${where} "${box.id}" only fits because its type was shrunk to ` +
        `${(box.fitScale * 100).toFixed(0)}% of the size the design asks for ` +
        `(drawn at ${box.fontSizePx.toFixed(1)}px, design size ` +
        `${designPx.toFixed(1)}px, leading ${box.leading.toFixed(2)}) — the ` +
        `box is ${box.widthPx.toFixed(0)}x${box.heightPx.toFixed(0)}px, which ` +
        `holds ${linesShown} line(s) at the design's own size, and was ` +
        `holding ${box.chars} chars when measured. It was given no more than ` +
        `its own stated budget, so the budget and the box disagree${because}`
      )
    })
}

/**
 * Boxes cutting the bottoms off their own letters.
 *
 * Asserted separately from the generic clip check because that check cannot
 * see this and should not be changed until it can. It ignores overflow under
 * `NOISE` (8px), which is right — Chromium reports a few pixels of spill on
 * boxes that are hiding nothing — but a clipped descender IS a few pixels.
 * The two are indistinguishable by size alone.
 *
 * What separates them is the leading. Only a box set tighter than
 * `TIGHT_LEADING` puts glyphs outside its line box, so only there does a
 * small overflow mean a letter is losing its tail rather than the renderer
 * rounding. Above that, a small overflow is noise and is left alone.
 *
 * The upper bound matters as much as the lower: an overflow of a whole line
 * or more is a line that did not fit, which is the generic clip check's
 * business, not this one's. Reporting it here too would say the same fault
 * twice in different words.
 */
export const descenderFaultsOn = async (
  slide: Locator,
  where: string,
): Promise<string[]> => {
  const boxes = await boxesOf(slide)
  return boxes
    .filter(box => {
      if (!box.hasText || !box.clips) return false
      if (!box.leading || box.leading >= TIGHT_LEADING) return false
      const line = box.fontSizePx * box.leading
      // Hidden, but by less than a line: the tails of the letters on the
      // last line rather than a line that did not fit.
      return box.overflowY > 0 && box.overflowY < line
    })
    .map(
      box =>
        `${where} "${box.id}" cuts the descenders off its last line ` +
        `(${box.overflowY}px hidden, leading ${box.leading.toFixed(2)} at ` +
        `${box.fontSizePx.toFixed(1)}px — under ${TIGHT_LEADING}, so the ` +
        `glyphs sit outside the line box the design gave them)`,
    )
}

/**
 * The smallest share of the slide an empty box has to occupy before it counts
 * as a hole rather than a rounding artifact.
 *
 * A tenth of a per cent of a 16:9 slide is a couple of thousand square pixels
 * at the size these are rendered — well under anything a reader would notice,
 * and well over the sub-pixel boxes a layout leaves behind.
 */
export const HOLE_AREA = 0.001

/**
 * Boxes that reserve space and then show nothing in it, for no stated reason.
 *
 * Narrower than it first looks, and the narrowing was expensive. The rule
 * began as "an empty box that keeps its space is a hole", on the strength of
 * `FlowLayout` returning nothing at all for a slot with nothing to show. That
 * premise does not hold for a design positioned by measured rectangles: its
 * boxes are `free` nodes at fixed places, and in the EDITOR an empty one
 * deliberately draws an invitation to fill it. Run as first written it
 * reported twenty-two holes across every layout of a design that is fine —
 * one for every optional box left empty, which is exactly the affordance the
 * module's own header warns about twice.
 *
 * So two kinds of wordless box are excluded, both by markers the app already
 * sets rather than by guessing from size or position: `aria-hidden` furniture
 * (a design's bands, rules and photographs are wordless on purpose) and
 * `slot-blank`, which is the app saying "this slot is empty and I am inviting
 * you to fill it".
 *
 * A control counts as that invitation too, and has to be named separately:
 * an empty PICTURE box carries no `slot-blank` at all — it offers an "Add
 * image" button instead. Read without that, every unfilled picture slot in a
 * design reports as a hole, which on one walk was five more false faults
 * after the text ones had already been excluded. A box holding a control is
 * the editor asking for something; a filled picture box shows an `img` and is
 * caught by `hasImage` above.
 *
 * What is left is genuinely narrow: a box that is neither filled, nor
 * furniture, nor a slot the app has marked empty. That is a box nobody can
 * account for, which is the only version of this worth failing on.
 */
export const holesOn = async (
  slide: Locator,
  where: string,
): Promise<string[]> =>
  (await boxesOf(slide))
    .filter(
      box =>
        !box.furniture &&
        !box.blank &&
        !box.hasText &&
        !box.hasImage &&
        box.w * box.h > HOLE_AREA,
    )
    .map(
      box =>
        `${where} "${box.id}" reserves ${(box.w * box.h * 100).toFixed(1)}% ` +
        `of the slide and shows nothing in it — an empty slot should take no ` +
        `space at all, so this is a hole the reader can see`,
    )
