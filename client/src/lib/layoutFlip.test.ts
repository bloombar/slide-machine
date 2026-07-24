/**
 * Unit tests for the GEN-9 layout-flip helper: it captures the old slot
 * arrangement, commits the swap, then animates — text via GSAP Flip,
 * the image via a fixed clone whose real size change re-crops the
 * photo — falling back to an instant swap under reduced motion or when
 * the slide isn't on screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[] = []

vi.mock('gsap', () => {
  const gsap = {
    registerPlugin: vi.fn(),
    fromTo: vi.fn(() => calls.push('fromTo') && {}),
    to: vi.fn(() => calls.push('to') && {}),
  }
  return { gsap, default: gsap }
})
vi.mock('gsap/Flip', () => ({
  Flip: {
    getState: vi.fn(() => calls.push('getState') && { state: true }),
    from: vi.fn(() => calls.push('from') && {}),
  },
}))

import { gsap } from 'gsap'
import { Flip } from 'gsap/Flip'
import { runLayoutFlip } from './layoutFlip'

const mockReducedMotion = (reduce: boolean) => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: reduce }) as never
}

/** A minimal on-screen slide with tagged slot wrappers. */
const mountSlide = (inner: string) => {
  document.body.innerHTML = `<div data-slide-id="s1">${inner}</div>`
  return document.querySelector('[data-slide-id="s1"]') as HTMLElement
}

const titleSlot =
  '<span data-flip-slot="title" data-flip-id="s1:title">Cells</span>'
const captionSlot =
  '<span data-flip-slot="caption" data-flip-id="s1:caption">A cell</span>'
const imageSlot =
  '<div data-flip-slot="image" data-flip-id="s1:image"><img src="x.jpg"/></div>'

beforeEach(() => {
  calls.length = 0
  mockReducedMotion(false)
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('runLayoutFlip', () => {
  it('applies instantly without animating under reduced motion', async () => {
    const container = mountSlide(titleSlot)
    mockReducedMotion(true)
    const update = vi.fn(() => container && undefined)

    await runLayoutFlip('s1', update)

    expect(update).toHaveBeenCalledTimes(1)
    expect(Flip.getState).not.toHaveBeenCalled()
    expect(Flip.from).not.toHaveBeenCalled()
  })

  it('applies instantly when the slide is not on screen', async () => {
    const update = vi.fn()

    await runLayoutFlip('missing', update)

    expect(update).toHaveBeenCalledTimes(1)
    expect(Flip.getState).not.toHaveBeenCalled()
  })

  it('captures the old arrangement before the update, then flips text', async () => {
    const container = mountSlide(titleSlot)
    const update = vi.fn(() => {
      calls.push('update')
      container.innerHTML = `<div>${titleSlot}</div>`
    })

    await runLayoutFlip('s1', update)

    // Old state must be read before React commits the new layout
    expect(calls.indexOf('getState')).toBeLessThan(calls.indexOf('update'))
    expect(calls.indexOf('update')).toBeLessThan(calls.indexOf('from'))
    const fromArgs = vi.mocked(Flip.from).mock.calls[0]!
    expect(fromArgs[1]).toMatchObject({ scale: true })
    const targets = (fromArgs[1] as { targets: HTMLElement[] }).targets
    expect(targets).toHaveLength(1)
    expect(targets[0]!.dataset.flipSlot).toBe('title')
  })

  it('morphs a matched image via a fixed clone with real size animation', async () => {
    const container = mountSlide(imageSlot)
    const update = vi.fn(() => {
      container.innerHTML = `<div>${imageSlot}</div>`
    })

    await runLayoutFlip('s1', update)

    // The real wrapper hides while a body-level clone flies to the new rect
    const real = container.querySelector<HTMLElement>(
      '[data-flip-slot="image"]',
    )
    expect(real?.style.visibility).toBe('hidden')
    const toArgs = vi.mocked(gsap.to).mock.calls[0]!
    const clone = toArgs[0] as HTMLElement
    expect(clone.parentElement).toBe(document.body)
    expect(clone.style.position).toBe('fixed')
    expect(toArgs[1]).toMatchObject({
      left: expect.any(Number),
      top: expect.any(Number),
      width: expect.any(Number),
      height: expect.any(Number),
    })
    // The image never goes through transform-scale Flip (that would
    // stretch the cover crop instead of re-cropping it)
    for (const call of vi.mocked(Flip.from).mock.calls) {
      const targets = (call[1] as { targets?: HTMLElement[] }).targets ?? []
      expect(targets.every(t => t.dataset.flipSlot !== 'image')).toBe(true)
    }
  })

  it('fades in slots that only exist in the new layout', async () => {
    const container = mountSlide(titleSlot)
    const update = vi.fn(() => {
      container.innerHTML = `${titleSlot}${imageSlot}`
    })

    await runLayoutFlip('s1', update)

    // The entering image fades in as itself (no old rect to morph from)
    const fromToArgs = vi.mocked(gsap.fromTo).mock.calls[0]!
    expect((fromToArgs[0] as HTMLElement).dataset?.flipSlot).toBe('image')
    expect(fromToArgs[1]).toMatchObject({ opacity: 0 })
    expect(fromToArgs[2]).toMatchObject({ opacity: 1 })
  })

  it('fades out a static clone for slots that left the layout', async () => {
    const container = mountSlide(`${titleSlot}${captionSlot}`)
    const update = vi.fn(() => {
      container.innerHTML = titleSlot
    })

    await runLayoutFlip('s1', update)

    const fadeOut = vi
      .mocked(gsap.to)
      .mock.calls.find(c => (c[1] as { opacity?: number }).opacity === 0)
    expect(fadeOut).toBeDefined()
    const clone = fadeOut?.[0] as HTMLElement
    expect(clone.dataset.flipId).toBe('s1:caption')
    expect(clone.parentElement).toBe(document.body)
    expect(clone.style.position).toBe('fixed')
  })
})
