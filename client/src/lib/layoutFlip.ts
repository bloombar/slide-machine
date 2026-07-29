/**
 * Animated layout transitions (GEN-9): a FLIP over the slide's slots,
 * tweened with GSAP.
 *
 * A layout switch swaps one layout component's DOM for another, so the
 * slots (title/body/image/…) jump to new places. This module makes the
 * swap read as a morph by animating the real elements:
 *
 * - Text slots translate from where they were and scale UNIFORMLY by
 *   the ratio of the old and new font sizes — deliberately not by the
 *   ratio of the old and new boxes, which is what a stock FLIP animates.
 *   A title going from 7cqi bold to 5.5cqi semibold (title -> section)
 *   changes width and height by different factors, because weight and
 *   line wrapping move the width only; scaling the box by those factors
 *   stretches the letters. Matching glyph size keeps the text in
 *   proportion for the whole flight, however the box changed shape.
 *   Text that also broke into different lines is the exception — no
 *   scale reproduces that, so it dissolves between the two renderings
 *   along the same path instead.
 * - The image slot is different: its crop comes from object-fit: cover,
 *   so only animating its REAL width/height re-crops the photo each
 *   frame. The wrapper can't be animated in place (image containers are
 *   overflow-hidden and would clip it mid-flight, and GSAP shouldn't
 *   fight React for the element's geometry), so a fixed-position clone
 *   morphs across the screen while the real wrapper hides.
 * - Slots present in only one layout fade in (real element) or fade out
 *   (a static clone left at the old spot, with its computed styles frozen
 *   inline so it keeps the slide's look outside the slide).
 *
 * Slot wrappers are tagged by the slot system (slide/slots): every slot
 * carries data-flip-slot (its name) and data-flip-id (slide-scoped
 * identity used to match a slot to itself across the swap).
 */
import { flushSync } from 'react-dom'
import { gsap } from 'gsap'

const DURATION = 0.25
const EASE = 'power2.inOut'
/** Above slide content, below modal dialogs. */
const CLONE_Z = 40

/** True when the user asked for less motion — transitions apply instantly. */
const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

/** A slot captured just before the layout swap. */
interface BeforeSlot {
  id: string
  slot: string
  rect: DOMRect
  /** On-screen font size, the size text morphs are matched on. */
  font: number
  /** Deep copy taken pre-swap, styles frozen inline, so a leaving slot
   * can fade out looking exactly as it did inside the slide. */
  clone: HTMLElement
  radius: string
}

/** The in-flight image clone per slide, so a rapid second layout switch
 * retargets from the clone's current position instead of jumping. */
const activeImageFlips = new Map<string, { clone: HTMLElement }>()

const slotsIn = (container: Element): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-flip-slot]'))

/** The corner rounding a slot inherits from its layout container. */
const radiusOf = (el: HTMLElement): string =>
  el.parentElement ? getComputedStyle(el.parentElement).borderRadius : '0px'

/**
 * Copies the computed styles of `source`'s subtree onto `clone` as
 * inline styles. A leaving slot's clone fades out from document.body,
 * where it loses everything it had inside the slide: inherited styling
 * (a title's font and accent color live on the layout's heading, not
 * the slot wrapper) and container-query sizing (cqi units stop
 * resolving against the slide), so an unfrozen title clone would flash
 * as small unstyled text. Copying element by element covers both, and
 * freezing every computed property keeps spacing, borders, and
 * backgrounds too. Must run while `source` is still mounted in the
 * layout being left.
 */
const freezeStyles = (source: HTMLElement, clone: HTMLElement) => {
  const sourceEls = [source, ...source.querySelectorAll<HTMLElement>('*')]
  const cloneEls = [clone, ...clone.querySelectorAll<HTMLElement>('*')]
  sourceEls.forEach((el, i) => {
    const copy = cloneEls[i]
    if (!copy) return
    const computed = getComputedStyle(el)
    for (let p = 0; p < computed.length; p++) {
      const prop = computed.item(p)
      copy.style.setProperty(prop, computed.getPropertyValue(prop))
    }
    // The freeze copies any CSS transition/animation too, which would
    // then fight the fade-out tween for the same properties.
    copy.style.transition = 'none'
    copy.style.animation = 'none'
  })
}

/**
 * How big the element's text looks right now: its font size times any
 * scale a still-running morph has applied. Reading the on-screen size
 * (rather than the CSS one) lets a second layout switch mid-flight
 * continue from the size actually on screen.
 */
const visualFontSize = (el: HTMLElement): number => {
  const size = parseFloat(getComputedStyle(el).fontSize)
  const scale = Number(gsap.getProperty(el, 'scaleY'))
  if (!Number.isFinite(size) || size <= 0) return 0
  return Number.isFinite(scale) && scale > 0 ? size * scale : size
}

/** A rect's viewport center. Text morphs align centers, so a uniformly
 * scaled box still lands over the old one however its edges moved. */
const centerOf = (rect: DOMRect) => ({
  x: rect.left + rect.width / 2,
  y: rect.top + rect.height / 2,
})

/** How far the scaled new box may sit from the old one and still count
 * as the same text at another size. Well above what a weight change
 * adds to the width (a few percent), well below what a changed line
 * break costs (tens). */
const SAME_WRAP_TOLERANCE = 0.15

const near = (a: number, b: number) =>
  Math.abs(a - b) <= Math.abs(b) * SAME_WRAP_TOLERANCE + 1

/**
 * Pins an element to a viewport rect as a fixed overlay box. Every element
 * pinned this way is a throwaway clone of real slide content, so it is marked
 * decorative: without that, assistive tech reads the departing copy alongside
 * the real one for the length of the animation.
 */
const pinToRect = (el: HTMLElement, rect: DOMRect, radius: string) => {
  el.setAttribute('aria-hidden', 'true')
  el.style.position = 'fixed'
  el.style.left = `${rect.left}px`
  el.style.top = `${rect.top}px`
  el.style.width = `${rect.width}px`
  el.style.height = `${rect.height}px`
  el.style.margin = '0'
  el.style.zIndex = String(CLONE_Z)
  el.style.pointerEvents = 'none'
  el.style.overflow = 'hidden'
  el.style.borderRadius = radius
  // The rect already includes any in-flight transform the source
  // element carried, so a copied transform would offset it twice.
  el.style.transform = 'none'
}

/**
 * Applies `update` (a React state change that swaps the slide's layout)
 * with the slide's slots animating from their old arrangement to the new
 * one. Falls back to an instant swap when the slide isn't on screen or
 * the user prefers reduced motion. Resolves when the motion has finished.
 */
export function runLayoutFlip(
  slideId: string,
  update: () => void,
): Promise<void> {
  const container =
    typeof document === 'undefined'
      ? null
      : document.querySelector(`[data-slide-id="${slideId}"]`)
  if (!container || prefersReducedMotion()) {
    update()
    return Promise.resolve()
  }

  // Capture the old arrangement before React commits the new one. The
  // rects are as-seen, so a slot still mid-morph continues from where
  // it currently is rather than snapping back.
  const beforeEls = slotsIn(container)
  const before = new Map<string, BeforeSlot>()
  for (const el of beforeEls) {
    const id = el.dataset.flipId
    if (!id) continue
    const clone = el.cloneNode(true) as HTMLElement
    freezeStyles(el, clone)
    before.set(id, {
      id,
      slot: el.dataset.flipSlot ?? '',
      rect: el.getBoundingClientRect(),
      font: visualFontSize(el),
      clone,
      radius: radiusOf(el),
    })
  }

  // A second switch mid-flight: continue the image from the flying
  // clone's current spot, and clear the previous flight.
  const prior = activeImageFlips.get(slideId)
  const imageBefore = [...before.values()].find(s => s.slot === 'image')
  if (prior && imageBefore) {
    imageBefore.rect = prior.clone.getBoundingClientRect()
    imageBefore.radius = getComputedStyle(prior.clone).borderRadius
  }
  prior?.clone.remove()
  activeImageFlips.delete(slideId)

  flushSync(update)

  const afterEls = slotsIn(container)
  const afterIds = new Set(
    afterEls.map(el => el.dataset.flipId).filter(Boolean),
  )
  const animations: unknown[] = []
  const fadeIn = (els: gsap.TweenTarget) =>
    animations.push(
      gsap.fromTo(
        els,
        { opacity: 0 },
        { opacity: 1, duration: DURATION, ease: 'none', overwrite: true },
      ),
    )

  // Text slots morph to their new place; brand-new ones fade in
  const textAfter = afterEls.filter(el => el.dataset.flipSlot !== 'image')
  // Drop what a still-running morph left on these elements first, so the
  // rects read below are the settled layout and not a mid-flight one.
  for (const el of textAfter) {
    gsap.killTweensOf(el)
    gsap.set(el, { clearProps: 'transform' })
  }
  for (const el of textAfter) {
    const id = el.dataset.flipId
    const from = id ? before.get(id) : undefined
    if (!from) {
      fadeIn(el)
      continue
    }
    const rect = el.getBoundingClientRect()
    const font = visualFontSize(el)
    // One uniform scale, from the font sizes: the letters keep their
    // shape whatever the box did (a weight change or a narrower column
    // move width and height by different amounts). Equal sizes on both
    // sides leave scale at 1, i.e. a pure glide.
    const scale = font > 0 && from.font > 0 ? from.font / font : 1
    const to = centerOf(rect)
    const start = centerOf(from.rect)
    const dx = start.x - to.x
    const dy = start.y - to.y
    if (
      near(rect.width * scale, from.rect.width) &&
      near(rect.height * scale, from.rect.height)
    ) {
      // Scaling reproduces the old rendering: morph it
      animations.push(
        gsap.fromTo(
          el,
          { x: dx, y: dy, scale },
          {
            x: 0,
            y: 0,
            scale: 1,
            duration: DURATION,
            ease: EASE,
            overwrite: true,
            clearProps: 'transform',
          },
        ),
      )
      continue
    }
    // The text broke into different lines here (a wider column, a size
    // the old wrap width can't hold), so no scale reproduces the old
    // rendering: scaling up to match the glyphs would push the longer
    // lines outside the slide, which clips them. Dissolve between the
    // two renderings instead, both travelling the same path so the eye
    // still follows one moving block.
    pinToRect(from.clone, from.rect, from.radius)
    document.body.appendChild(from.clone)
    animations.push(
      gsap.to(from.clone, {
        x: -dx,
        y: -dy,
        opacity: 0,
        duration: DURATION,
        ease: EASE,
        onComplete: () => from.clone.remove(),
        onInterrupt: () => from.clone.remove(),
      }),
      gsap.fromTo(
        el,
        { x: dx, y: dy, opacity: 0 },
        {
          x: 0,
          y: 0,
          opacity: 1,
          duration: DURATION,
          ease: EASE,
          overwrite: true,
          clearProps: 'transform,opacity',
        },
      ),
    )
  }

  // The image slot morphs as a fixed clone so cover re-crops each frame
  const imageAfter = afterEls.find(el => el.dataset.flipSlot === 'image')
  if (imageAfter && imageBefore && afterIds.has(imageBefore.id)) {
    const toRect = imageAfter.getBoundingClientRect()
    const toRadius = radiusOf(imageAfter)
    const clone = imageAfter.cloneNode(true) as HTMLElement
    pinToRect(clone, imageBefore.rect, imageBefore.radius)
    document.body.appendChild(clone)
    imageAfter.style.visibility = 'hidden'
    activeImageFlips.set(slideId, { clone })
    const cleanup = () => {
      clone.remove()
      if (activeImageFlips.get(slideId)?.clone === clone)
        activeImageFlips.delete(slideId)
      // Re-query: React may have replaced the wrapper mid-flight
      const el = container.querySelector<HTMLElement>(
        `[data-flip-id="${imageBefore.id}"]`,
      )
      if (el) el.style.visibility = ''
    }
    animations.push(
      gsap.to(clone, {
        left: toRect.left,
        top: toRect.top,
        width: toRect.width,
        height: toRect.height,
        borderRadius: toRadius,
        duration: DURATION,
        ease: EASE,
        onComplete: cleanup,
        onInterrupt: cleanup,
      }),
    )
  } else if (imageAfter && !imageBefore) {
    fadeIn(imageAfter)
  }

  // Slots that left the layout fade out as static clones in place
  for (const slot of before.values()) {
    if (afterIds.has(slot.id)) continue
    pinToRect(slot.clone, slot.rect, slot.radius)
    document.body.appendChild(slot.clone)
    animations.push(
      gsap.to(slot.clone, {
        opacity: 0,
        duration: DURATION,
        ease: 'none',
        onComplete: () => slot.clone.remove(),
        onInterrupt: () => slot.clone.remove(),
      }),
    )
  }

  return Promise.allSettled(animations).then(() => undefined)
}
