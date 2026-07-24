/**
 * Animated layout transitions (GEN-9) built on GSAP's Flip plugin.
 *
 * A layout switch swaps one layout component's DOM for another, so the
 * slots (title/body/image/…) jump to new places. This module makes the
 * swap read as a morph by animating the real elements:
 *
 * - Text slots FLIP via transforms (Flip.from with scale) — the new text
 *   glides and rescales from the old box to the new one.
 * - The image slot is different: its crop comes from object-fit: cover,
 *   so only animating its REAL width/height re-crops the photo each
 *   frame. The wrapper can't be animated in place (image containers are
 *   overflow-hidden and would clip it mid-flight, and GSAP shouldn't
 *   fight React for the element's geometry), so a fixed-position clone
 *   morphs across the screen while the real wrapper hides.
 * - Slots present in only one layout fade in (real element) or fade out
 *   (a static clone left at the old spot).
 *
 * Slot wrappers are tagged by the slot system (slide/slots): every slot
 * carries data-flip-slot (its name) and data-flip-id (slide-scoped
 * identity used to match a slot to itself across the swap).
 */
import { flushSync } from 'react-dom'
import { gsap } from 'gsap'
import { Flip } from 'gsap/Flip'

gsap.registerPlugin(Flip)

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
  /** Deep copy taken pre-swap so leaving slots can still fade out. */
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

/** Pins an element to a viewport rect as a fixed overlay box. */
const pinToRect = (el: HTMLElement, rect: DOMRect, radius: string) => {
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

  // Capture the old arrangement before React commits the new one
  const beforeEls = slotsIn(container)
  const before = new Map<string, BeforeSlot>()
  for (const el of beforeEls) {
    const id = el.dataset.flipId
    if (!id) continue
    before.set(id, {
      id,
      slot: el.dataset.flipSlot ?? '',
      rect: el.getBoundingClientRect(),
      clone: el.cloneNode(true) as HTMLElement,
      radius: radiusOf(el),
    })
  }
  const textEls = beforeEls.filter(el => el.dataset.flipSlot !== 'image')
  const textState = Flip.getState(textEls)

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

  // Text slots morph via transform FLIP; brand-new ones fade in
  const textAfter = afterEls.filter(el => el.dataset.flipSlot !== 'image')
  if (textAfter.length)
    animations.push(
      Flip.from(textState, {
        targets: textAfter,
        scale: true,
        duration: DURATION,
        ease: EASE,
        onEnter: fadeIn,
      }),
    )

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
