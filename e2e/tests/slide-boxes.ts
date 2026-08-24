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
import { NATURAL_LINE_BOX, inkBoxOf } from '@slide-machine/shared'
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

/** Ink outside a box by less than this is rounding, in pixels. The ink model
 * places a baseline from font tables; a pixel is below anything it resolves. */
export const NOISE_PX = 1

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
/**
 * Whether the faces the design asks for have actually loaded.
 *
 * Every box measurement is a text measurement, and text measures differently
 * in a fallback face. The design's stack is
 * `Montserrat, ui-sans-serif, system-ui, -apple-system, …` — so if Montserrat
 * has not arrived, macOS measures in San Francisco and Linux in whatever it
 * has, and the same box legitimately produces two different answers on two
 * machines. Boxes that abut by construction then differ between "touching"
 * and "overlapping" for reasons that have nothing to do with the design.
 *
 * Reported rather than assumed, because the failure is silent: a fallback
 * face renders perfectly well and says nothing about not being the one asked
 * for.
 */
export const fontsLoaded = (page: Page) =>
  page.evaluate(async () => {
    await document.fonts.ready
    // The faces THIS slide actually asks for, read off the rendered boxes
    // rather than from a list — a design that uses one face should not be
    // reported against another it never mentions.
    //
    // Checked at the WEIGHT the box is set in, not at the default. A browser
    // fetches only the faces a page uses, so a family bundled at 400 and 700
    // and used only at 700 has no 400 face loaded — and a check written
    // `16px "Family"` asks about 400 and answers "no" about a face that is
    // on screen and correct. That false negative was live in this helper:
    // it is the difference between reporting a design's real face and
    // reporting the one nobody asked for.
    const slide = document.querySelector('[data-testid="slide"]')
    const wanted = new Map<
      string,
      { family: string; weight: string; style: string }
    >()
    for (const node of slide?.querySelectorAll('[data-node-id]') ?? []) {
      const cs = getComputedStyle(node)
      const family = cs.fontFamily
        .split(',')[0]
        ?.trim()
        .replace(/^["']|["']$/g, '')
      // Only real families; the generic keywords at the end of a stack are
      // always "available" and say nothing.
      if (
        !family ||
        /^(ui-|system-ui|-apple-system|serif|sans-serif)/.test(family)
      )
        continue
      const weight = cs.fontWeight || '400'
      const style = cs.fontStyle === 'italic' ? 'italic' : 'normal'
      wanted.set(`${family}|${weight}|${style}`, { family, weight, style })
    }
    return [...wanted.values()].map(({ family, weight, style }) => ({
      family,
      weight,
      style,
      loaded: document.fonts.check(`${style} ${weight} 16px "${family}"`),
    }))
  })

export const settled = async (page: Page) => {
  // Fonts first. A measurement taken before the design's own face has loaded
  // is a measurement of a fallback, and every rule in this file is a text
  // measurement.
  await page.evaluate(() => document.fonts.ready).catch(() => {})
  return page
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
}

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
          /**
           * What the box is set in, in the fields the ink model reads.
           *
           * Gathered here rather than derived from the template, because the
           * gate measures what the app DREW: a box whose type the renderer
           * shrank is set in a smaller size than the design states, and the
           * ink it can reach shrinks with it.
           *
           * `cqi` is a percent of the slide's WIDTH, which is the unit the
           * template model measures type in, so the conversion is against
           * the frame's width and not its height.
           */
          setting: (() => {
            const family = (style.fontFamily.split(',')[0] ?? '')
              .trim()
              .replace(/^["']|["']$/g, '')
              .toLowerCase()
              .replace(/\s+/g, '-')
            const fontSizePx = Number.parseFloat(style.fontSize) || 0
            const lineHeightPx = Number.parseFloat(style.lineHeight) || 0
            const padTopPx = Number.parseFloat(style.paddingTop) || 0
            return {
              family,
              fontSize: (fontSizePx / frame.width) * 100,
              fontWeight: Number.parseInt(style.fontWeight, 10) || 400,
              lineHeight: fontSizePx ? lineHeightPx / fontSizePx : 0,
              caps: style.textTransform === 'uppercase',
              vAlign:
                style.justifyContent === 'center'
                  ? 'center'
                  : style.justifyContent === 'flex-end'
                    ? 'end'
                    : 'start',
              paddingEm: fontSizePx ? padTopPx / fontSizePx : 0,
            }
          })(),
          /**
           * How many line boxes the browser actually drew.
           *
           * Counted by CLUSTERING the rect tops, not by taking the distinct
           * ones. A Range yields a rect per fragment, and fragments on the
           * same line do not share a top: a two-line title reported tops of
           * 195, 207 and 283, which is two lines and three distinct values.
           * Counting the distinct ones gave three, and a line count one too
           * high pushes the modelled ink a whole line below where the glyphs
           * are — which turned a design with one fault into a design with
           * seven overlapping pairs.
           *
           * Tops within half a line of each other are the same line. Half is
           * the only threshold that cannot be wrong in either direction: two
           * real lines are a full line-height apart, and fragments of one
           * line differ by at most the tallest inline box on it.
           */
          lines: (() => {
            const range = document.createRange()
            range.selectNodeContents(node)
            const tops = [...range.getClientRects()]
              .filter(rect => rect.height > 0)
              .map(rect => rect.top)
              .sort((a, b) => a - b)
            range.detach()
            const step = (Number.parseFloat(style.lineHeight) || 0) / 2
            if (!tops.length) return 0
            if (!step) return 1
            let count = 1
            let last = tops[0]!
            for (const top of tops)
              if (top - last > step) {
                count++
                last = top
              }
            return count
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

  // A box with no measurable text extent cannot collide with anything.
  const worded = boxes.filter(box => box.hasText && box.textBox)
  for (let a = 0; a < worded.length; a++)
    for (let b = a + 1; b < worded.length; b++) {
      const inkA = inkOf(worded[a]!)
      const inkB = inkOf(worded[b]!)
      const shared = inkA && inkB ? overlapArea(inkA, inkB) : 0
      if (shared > 0)
        faults.push(
          `${where} "${worded[a]!.id}" and "${worded[b]!.id}" overlap over ` +
            `${(shared * 100).toFixed(1)}% of the slide — both are showing text`,
        )
    }
  return faults
}

/** One measured box, as `boxesOf` reports it. */
export type Box = Awaited<ReturnType<typeof boxesOf>>[number]

/**
 * Compared on the INK, which is the only version a reader can see.
 *
 * This rule used to compare `textBox`, and its comment claimed that was
 * "where the GLYPHS actually are". It was not. `Range.getBoundingClientRect`
 * returns the LINE BOX, and the two differ by exactly the amount that
 * matters here: a box led tighter than its face's natural box hangs ink
 * OUTSIDE its line boxes, one led looser leaves empty room INSIDE them. So
 * the rule was wrong in both directions at once, and the docstring asserted
 * the property the code lacked — which is why nobody checked the
 * implementation.
 *
 * The correction is not a loosened threshold, and the difference is
 * demonstrable rather than argued: on NYU Bold's divider the two boxes
 * overlap over 6.1% of the slide while their glyphs clear by 0.062 of its
 * height. A relaxed tolerance cannot produce a case where the two answers
 * diverge like that; only a different measurement can. And it needs no
 * appeal to the face at all on `big-number`, whose title bottom and caption
 * top are the same number to five decimals: boxes that abut exactly have
 * zero rectangle overlap, so anything reported for them is line-box
 * overrun by construction, whatever the platform resolves the stack to.
 *
 * `inkBoxOf` is the same model the template audit uses, from the same
 * table, so the two cannot drift apart — the argument that put `SLACK_EM`
 * in `shared`. Its inputs here come off the DOM rather than the template:
 * the box as drawn, and the line count the browser actually produced.
 *
 * A face we ship no metrics for keeps the line box, which is what this rule
 * compared before. That is deliberate: the audit falls back to the whole
 * rectangle, which is conservative for a static check, but doing that here
 * would newly fault every design that names no typeface — a change in
 * behaviour dressed as a correction, on designs this has nothing to say
 * about.
 */
export const inkOf = (box: Box) =>
  inkBoxOf(
    { x: box.x, y: box.y, w: box.w, h: box.h },
    {
      fontSize: box.setting.fontSize,
      fontFamily: box.setting.family,
      fontWeight: box.setting.fontWeight,
      lineHeight: box.setting.lineHeight,
      caps: box.setting.caps,
      vAlign: box.setting.vAlign as 'start' | 'center' | 'end',
      // Left undefined where the padding IS the renderer's own overhang
      // allowance, so the model recomputes the same number instead of
      // being handed it twice.
      ...(box.setting.paddingEm > 0 &&
      Math.abs(
        box.setting.paddingEm - (NATURAL_LINE_BOX - box.setting.lineHeight) / 2,
      ) > 0.001
        ? { paddingY: box.setting.paddingEm }
        : {}),
    },
    Math.max(1, box.lines),
  ) ?? box.textBox

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
 * ## It asks about ink, and it used to measure the line box
 *
 * The rule is named for a quantity — glyph ink below the baseline — and it
 * compared `scrollHeight` against `clientHeight`, which is a statement about
 * LINE boxes. That is not a wrong threshold, it is the wrong quantity, and it
 * is the same defect the overlap rule carried: a box led tighter than its
 * face's natural box overflows its line boxes at every type size, whether or
 * not a single glyph is cut.
 *
 * The old version needed a leading test to tell those apart, because it could
 * not see the difference directly. Asking `inkBoxOf` where the ink actually
 * reaches makes the leading test unnecessary: a box whose reachable ink lies
 * inside its own rectangle is not cutting anything, at any leading.
 *
 * ## What "reachable" means, and the hazard it does not report
 *
 * The model gives the worst case over the characters a box could hold, not
 * the ones it holds now — the same assumption the audit makes, and the same
 * limit. A box that clips nothing today because its content happens to have
 * no descenders is reported clean, and stays clean until somebody types a
 * `g`.
 *
 * NYU Bold's section numeral is exactly that box and it is worth naming here
 * rather than leaving to be rediscovered: its reachable ink bottom is 1.0580
 * of the slide against a box bottom of 1.0000, so 31.9px of ink would be cut
 * — and the box's bottom IS the slide's bottom, so unlike the overlap on the
 * same slide there is no geometry that closes it. It reports nothing because
 * the slot holds digits, which is an assumption nothing enforces. TMPL-16.
 *
 * ## The upper bound
 *
 * Ink outside the box by a whole line or more is a line that did not fit,
 * which is the generic clip check's business. Reporting it here too would say
 * the same fault twice in different words.
 */
export const descenderFaultsOn = async (
  slide: Locator,
  where: string,
): Promise<string[]> => {
  const boxes = await boxesOf(slide)
  const faults: string[] = []
  for (const box of boxes) {
    if (!box.hasText || !box.clips) continue
    const ink = inkOf(box)
    // A face we have no metrics for cannot be asked this question. The old
    // line-box test is not a weaker answer to it, it is an answer to a
    // different question, so there is nothing to fall back to.
    if (!ink || ink === box.textBox) continue
    const frameH = box.h ? box.heightPx / box.h : 0
    if (!frameH) continue
    const below = (ink.y + ink.h - (box.y + box.h)) * frameH
    const above = (box.y - ink.y) * frameH
    const hidden = Math.max(below, above)
    // Cut, but by less than a line: the tails of the letters on the last
    // line rather than a line that did not fit, which is the clip rule's.
    const line = box.fontSizePx * (box.leading || 1)
    if (hidden <= NOISE_PX || hidden >= line) continue
    faults.push(
      `${where} "${box.id}" cuts ${below >= above ? 'the descenders off its last line' : 'the ascenders off its first line'} ` +
        `(${hidden.toFixed(0)}px of reachable ink outside the box, leading ` +
        `${box.leading.toFixed(2)} at ${box.fontSizePx.toFixed(1)}px)`,
    )
  }
  return faults
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
