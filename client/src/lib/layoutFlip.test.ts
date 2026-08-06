/**
 * Unit tests for the GEN-9 layout-flip helper: it captures the old slot
 * arrangement, commits the swap, then animates — text by translating and
 * scaling uniformly to match glyph size (dissolving instead when it
 * re-wrapped), the image via a fixed clone whose real size change
 * re-crops the photo — falling back to an instant swap under reduced
 * motion or when the slide isn't on screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[] = []
/** The scale an in-flight morph has left on an element, as
 * gsap.getProperty would report it — until clearProps drops it. */
let liveScale = 1
const cleared = new WeakSet<object>()

vi.mock('gsap', () => {
  const gsap = {
    registerPlugin: vi.fn(),
    fromTo: vi.fn(() => calls.push('fromTo') && {}),
    to: vi.fn(() => calls.push('to') && {}),
    set: vi.fn((el: object, vars: { clearProps?: string }) => {
      if (vars.clearProps) cleared.add(el)
    }),
    killTweensOf: vi.fn(),
    getProperty: vi.fn((el: object) => (cleared.has(el) ? 1 : liveScale)),
  }
  return { gsap, default: gsap }
})

import { gsap } from 'gsap'
import { runLayoutFlip } from './layoutFlip'

const mockReducedMotion = (reduce: boolean) => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: reduce }) as never
}

/** A minimal on-screen slide with tagged slot wrappers. */
const mountSlide = (inner: string) => {
  document.body.innerHTML = `<div data-slide-id="s1">${inner}</div>`
  return document.querySelector('[data-slide-id="s1"]') as HTMLElement
}

/** jsdom has no layout, so slot geometry is stubbed per element. */
const stubRect = (
  el: HTMLElement,
  box: { left: number; top: number; width: number; height: number },
  onMeasure?: () => void,
) => {
  el.getBoundingClientRect = () => {
    onMeasure?.()
    return {
      ...box,
      right: box.left + box.width,
      bottom: box.top + box.height,
      x: box.left,
      y: box.top,
      toJSON: () => '',
    } as DOMRect
  }
}

const slotIn = (root: ParentNode, slot: string) =>
  root.querySelector<HTMLElement>(`[data-flip-slot="${slot}"]`)!

const titleSlot =
  '<span data-flip-slot="title" data-flip-id="s1:title">Cells</span>'
const captionSlot =
  '<span data-flip-slot="caption" data-flip-id="s1:caption">A cell</span>'
const imageSlot =
  '<div data-flip-slot="image" data-flip-id="s1:image"><img src="x.jpg"/></div>'

/** The title/section case: one line of 7cqi bold -> one line of 5.5cqi
 * semibold. The box shrinks by a different factor across (800->630, the
 * lighter weight taking extra) than down (80->63); only the font sizes
 * say how much the letters really changed. */
const bigTitle =
  '<span data-flip-slot="title" data-flip-id="s1:title" style="font-size: 70px">Cells</span>'
const smallTitle =
  '<span data-flip-slot="title" data-flip-id="s1:title" style="font-size: 55px">Cells</span>'
const BIG_BOX = { left: 100, top: 100, width: 800, height: 80 }
const SMALL_BOX = { left: 300, top: 200, width: 630, height: 63 }
/** Same font sizes, but the title now needs two lines in a box the old
 * rendering would not fit — no scale can reproduce that. */
const REWRAPPED_BOX = { left: 300, top: 200, width: 500, height: 120 }
/** BIG_BOX as it is drawn while a morph still has it at twice its size. */
const FLYING_BOX = { left: 100, top: 100, width: 1600, height: 160 }

/** Mounts bigTitle, swaps it for smallTitle, and returns the text tween's
 * from-vars (both boxes stubbed as given). */
const morphTitleSizes = async (after = SMALL_BOX, before = BIG_BOX) => {
  const container = mountSlide(bigTitle)
  stubRect(slotIn(container, 'title'), before, () => calls.push('measure'))
  await runLayoutFlip('s1', () => {
    calls.push('update')
    container.innerHTML = `<div>${smallTitle}</div>`
    stubRect(slotIn(container, 'title'), after)
  })
  return vi.mocked(gsap.fromTo).mock.calls[0]![1] as unknown as Record<
    string,
    number
  >
}

beforeEach(() => {
  calls.length = 0
  liveScale = 1
  mockReducedMotion(false)
})

afterEach(() => {
  document.body.innerHTML = ''
  document.head.querySelectorAll('style').forEach(s => s.remove())
  vi.clearAllMocks()
})

describe('runLayoutFlip', () => {
  it('applies instantly without animating under reduced motion', async () => {
    const container = mountSlide(titleSlot)
    mockReducedMotion(true)
    const update = vi.fn(() => container && undefined)

    await runLayoutFlip('s1', update)

    expect(update).toHaveBeenCalledTimes(1)
    expect(gsap.fromTo).not.toHaveBeenCalled()
    expect(gsap.to).not.toHaveBeenCalled()
  })

  it('applies instantly when the slide is not on screen', async () => {
    const update = vi.fn()

    await runLayoutFlip('missing', update)

    expect(update).toHaveBeenCalledTimes(1)
    expect(gsap.fromTo).not.toHaveBeenCalled()
  })

  it('captures the old arrangement before the update, then morphs text', async () => {
    await morphTitleSizes()

    // Old geometry must be read before React commits the new layout
    expect(calls.indexOf('measure')).toBeLessThan(calls.indexOf('update'))
    expect(calls.indexOf('update')).toBeLessThan(calls.indexOf('fromTo'))
    const target = vi.mocked(gsap.fromTo).mock.calls[0]![0] as HTMLElement
    expect(target.dataset.flipSlot).toBe('title')
  })

  it('scales text by font size, not by its box, so it never stretches', async () => {
    const fromVars = await morphTitleSizes()

    // One uniform scale from the font-size ratio. Scaling the box
    // instead would squash the letters: 800/630 across vs 80/63 down.
    expect(fromVars.scale).toBeCloseTo(70 / 55, 5)
    expect(fromVars).not.toHaveProperty('scaleX')
    expect(fromVars).not.toHaveProperty('scaleY')
    expect(fromVars).not.toHaveProperty('opacity')
  })

  it('translates text so the old and new centers line up', async () => {
    const fromVars = await morphTitleSizes()

    // Centers: (500, 140) before, (615, 231.5) after
    expect(fromVars.x).toBe(-115)
    expect(fromVars.y).toBe(-91.5)
    const toVars = vi.mocked(gsap.fromTo).mock.calls[0]![2]
    expect(toVars).toMatchObject({ x: 0, y: 0, scale: 1 })
  })

  it('dissolves instead of scaling when the text broke into new lines', async () => {
    const fromVars = await morphTitleSizes(REWRAPPED_BOX)

    // Scaling 500x120 up to the old glyph size would be 636x153 — far
    // wider and taller than the 800x80 it replaces, i.e. other line
    // breaks. The new text fades in along the move instead of scaling,
    // so nothing is stretched or pushed outside the slide.
    expect(fromVars).toMatchObject({ opacity: 0 })
    expect(fromVars).not.toHaveProperty('scale')
    // Centers: (500, 140) before, (550, 260) after
    expect(fromVars).toMatchObject({ x: -50, y: -120 })
    const toVars = vi.mocked(gsap.fromTo).mock.calls[0]![2]
    expect(toVars).toMatchObject({ x: 0, y: 0, opacity: 1 })
    // ...while the old rendering fades out along the same path
    const out = vi
      .mocked(gsap.to)
      .mock.calls.find(c => (c[1] as { opacity?: number }).opacity === 0)!
    expect((out[0] as HTMLElement).dataset.flipId).toBe('s1:title')
    expect(out[1]).toMatchObject({ x: 50, y: 120 })
  })

  it('continues a mid-flight text morph from its on-screen size', async () => {
    // A morph still running has the title drawn at twice its CSS size
    liveScale = 2

    const fromVars = await morphTitleSizes(SMALL_BOX, FLYING_BOX)

    // Measuring clears that transform first, so the new size is its own
    expect(gsap.killTweensOf).toHaveBeenCalled()
    expect(gsap.set).toHaveBeenCalledWith(expect.anything(), {
      clearProps: 'transform',
    })
    expect(fromVars.scale).toBeCloseTo((70 * 2) / 55, 5)
  })

  it('morphs a matched image via a fixed clone with real size animation', async () => {
    const container = mountSlide(imageSlot)
    const update = vi.fn(() => {
      container.innerHTML = `<div>${imageSlot}</div>`
    })

    await runLayoutFlip('s1', update)

    // The real wrapper hides while a body-level clone flies to the new rect
    const real = slotIn(container, 'image')
    expect(real.style.visibility).toBe('hidden')
    const toArgs = vi.mocked(gsap.to).mock.calls[0]!
    const clone = toArgs[0] as HTMLElement
    expect(clone.parentElement).toBe(document.body)
    expect(clone.style.position).toBe('fixed')
    expect(clone.style.transform).toBe('none')
    expect(toArgs[1]).toMatchObject({
      left: expect.any(Number),
      top: expect.any(Number),
      width: expect.any(Number),
      height: expect.any(Number),
    })
    // The image never goes through a transform morph (that would stretch
    // the cover crop instead of re-cropping it)
    for (const call of vi.mocked(gsap.fromTo).mock.calls) {
      expect((call[0] as HTMLElement)?.dataset?.flipSlot).not.toBe('image')
    }
  })

  it('fades in slots that only exist in the new layout', async () => {
    const container = mountSlide(titleSlot)
    const update = vi.fn(() => {
      container.innerHTML = `${titleSlot}${captionSlot}${imageSlot}`
    })

    await runLayoutFlip('s1', update)

    // Entering slots have no old rect to morph from, so they fade in
    const fades = vi
      .mocked(gsap.fromTo)
      .mock.calls.filter(c => (c[1] as { opacity?: number }).opacity === 0)
    const faded = fades.map(c => (c[0] as HTMLElement).dataset.flipSlot)
    expect(faded).toEqual(['caption', 'image'])
    expect(fades[0]![2]).toMatchObject({ opacity: 1 })
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

  it('morphs a box the two layouts name differently but style alike', async () => {
    // The GEN-9 tier match: `title` in one layout, `headline` in the other,
    // both the headline of their slide. Matching on name alone would call
    // this one box leaving and another arriving, and cross-fade.
    const container = mountSlide(
      '<div data-flip-tier="headline">' +
        '<span data-flip-slot="title" data-flip-id="s1:title">Cells</span>' +
        '</div>',
    )
    stubRect(slotIn(container, 'title'), BIG_BOX)

    await runLayoutFlip('s1', () => {
      container.innerHTML =
        '<div data-flip-tier="headline">' +
        '<span data-flip-slot="headline" data-flip-id="s1:headline">Cells</span>' +
        '</div>'
      // Same size in a new place: the text did not re-wrap, so a paired box
      // takes the pure glide rather than the dissolve.
      stubRect(slotIn(container, 'headline'), {
        ...BIG_BOX,
        left: 300,
        top: 200,
      })
    })

    // One morph, and nothing fading out: the box was carried over, not swapped
    const morph = vi
      .mocked(gsap.fromTo)
      .mock.calls.find(
        c => (c[0] as HTMLElement).dataset.flipSlot === 'headline',
      )
    expect(morph).toBeDefined()
    expect((morph![1] as { opacity?: number }).opacity).toBeUndefined()
    const fadeOuts = vi
      .mocked(gsap.to)
      .mock.calls.filter(c => (c[1] as { opacity?: number }).opacity === 0)
    expect(fadeOuts).toHaveLength(0)
  })

  it('does not pair boxes that hold different things', async () => {
    // A headline must not morph into a caption just because both are text.
    const container = mountSlide(
      '<div data-flip-tier="headline">' +
        '<span data-flip-slot="title" data-flip-id="s1:title">Cells</span>' +
        '</div>',
    )

    await runLayoutFlip('s1', () => {
      container.innerHTML =
        '<div data-flip-tier="caption">' +
        '<span data-flip-slot="credit" data-flip-id="s1:credit">A cell</span>' +
        '</div>'
    })

    // The old one leaves, the new one arrives — no morph between them
    const fadeIn = vi
      .mocked(gsap.fromTo)
      .mock.calls.find(c => (c[1] as { opacity?: number }).opacity === 0)
    expect((fadeIn?.[0] as HTMLElement).dataset.flipSlot).toBe('credit')
    const fadeOut = vi
      .mocked(gsap.to)
      .mock.calls.find(c => (c[1] as { opacity?: number }).opacity === 0)
    expect((fadeOut?.[0] as HTMLElement).dataset.flipId).toBe('s1:title')
  })

  it('prefers the same name over a same-tier box elsewhere', async () => {
    const container = mountSlide(
      '<div data-flip-tier="headline">' +
        '<span data-flip-slot="title" data-flip-id="s1:title">Cells</span>' +
        '</div>',
    )

    await runLayoutFlip('s1', () => {
      container.innerHTML =
        '<div data-flip-tier="headline">' +
        '<span data-flip-slot="other" data-flip-id="s1:other">Other</span>' +
        '</div>' +
        '<div data-flip-tier="headline">' +
        '<span data-flip-slot="title" data-flip-id="s1:title">Cells</span>' +
        '</div>'
    })

    // `title` claims `title`; the extra headline has nothing left to pair with
    const fadeIn = vi
      .mocked(gsap.fromTo)
      .mock.calls.find(c => (c[1] as { opacity?: number }).opacity === 0)
    expect((fadeIn?.[0] as HTMLElement).dataset.flipSlot).toBe('other')
  })

  it('morphs a picture whose slot the new layout names differently', async () => {
    // The old gate compared slot NAMES while the wrapper tags pictures by
    // kind, so a renamed picture box animated not at all and left a ghost.
    const container = mountSlide(
      '<div data-flip-tier="image" data-flip-slot="image" data-flip-id="s1:image">' +
        '<img src="x.jpg"/></div>',
    )

    await runLayoutFlip('s1', () => {
      container.innerHTML =
        '<div data-flip-tier="image" data-flip-slot="image" data-flip-id="s1:photo">' +
        '<img src="x.jpg"/></div>'
    })

    const real = container.querySelector<HTMLElement>(
      '[data-flip-id="s1:photo"]',
    )!
    expect(real.style.visibility).toBe('hidden')
    const morph = vi
      .mocked(gsap.to)
      .mock.calls.find(c => (c[1] as { width?: number }).width !== undefined)
    expect(morph).toBeDefined()
    // and no leftover ghost fading out
    const fadeOuts = vi
      .mocked(gsap.to)
      .mock.calls.filter(c => (c[1] as { opacity?: number }).opacity === 0)
    expect(fadeOuts).toHaveLength(0)
  })

  it('morphs every picture box, not just the first', async () => {
    const twoImages = (a: string, b: string) =>
      `<div data-flip-tier="image" data-flip-slot="image" data-flip-id="s1:${a}"><img src="a.jpg"/></div>` +
      `<div data-flip-tier="image" data-flip-slot="image" data-flip-id="s1:${b}"><img src="b.jpg"/></div>`
    const container = mountSlide(twoImages('one', 'two'))

    await runLayoutFlip('s1', () => {
      container.innerHTML = twoImages('one', 'two')
    })

    const morphs = vi
      .mocked(gsap.to)
      .mock.calls.filter(c => (c[1] as { width?: number }).width !== undefined)
    expect(morphs).toHaveLength(2)
    for (const id of ['s1:one', 's1:two']) {
      expect(
        container.querySelector<HTMLElement>(`[data-flip-id="${id}"]`)!.style
          .visibility,
      ).toBe('hidden')
    }
  })

  it('freezes a leaving clone’s text styling so it fades unchanged', async () => {
    const style = document.createElement('style')
    style.textContent =
      '[data-flip-slot="caption"] { color: rgb(1, 2, 3); font-size: 21px }'
    document.head.appendChild(style)
    const container = mountSlide(`${titleSlot}${captionSlot}`)

    await runLayoutFlip('s1', () => {
      container.innerHTML = titleSlot
    })

    // The clone hangs off <body>: the slide's inline colours and its
    // container-relative type sizes stop applying, so the computed
    // values ride along inline
    const clone = vi
      .mocked(gsap.to)
      .mock.calls.find(
        c => (c[1] as { opacity?: number }).opacity === 0,
      )?.[0] as HTMLElement
    expect(clone.style.color).toBe('rgb(1, 2, 3)')
    expect(clone.style.fontSize).toBe('21px')
  })
})
