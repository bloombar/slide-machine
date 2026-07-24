/**
 * Unit tests for the layout-transition helper: it animates through the
 * View Transitions API when available, and falls back to an instant,
 * name-free update when the API is missing or reduced motion is preferred.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runViewTransition } from './viewTransition'

const origStart = (document as { startViewTransition?: unknown })
  .startViewTransition
const origMatchMedia = window.matchMedia

afterEach(() => {
  ;(document as { startViewTransition?: unknown }).startViewTransition =
    origStart
  window.matchMedia = origMatchMedia
  vi.restoreAllMocks()
})

/** Pretends the browser supports view transitions, running the callback. */
const mockStart = () => {
  const start = vi.fn((cb: () => void) => {
    cb()
    return { finished: Promise.resolve() }
  })
  ;(document as { startViewTransition?: unknown }).startViewTransition = start
  return start
}

/** Forces the reduced-motion media query to a fixed answer. */
const mockReducedMotion = (reduce: boolean) => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: reduce }) as never
}

describe('runViewTransition', () => {
  it('applies the update instantly and skips names when unsupported', async () => {
    ;(document as { startViewTransition?: unknown }).startViewTransition =
      undefined
    mockReducedMotion(false)
    const update = vi.fn()
    const beforeCapture = vi.fn()

    await runViewTransition(update, beforeCapture)

    expect(update).toHaveBeenCalledTimes(1)
    // No transition means no morph, so the shared-element names are never set
    expect(beforeCapture).not.toHaveBeenCalled()
  })

  it('applies instantly when reduced motion is preferred', async () => {
    mockStart()
    mockReducedMotion(true)
    const update = vi.fn()
    const beforeCapture = vi.fn()

    await runViewTransition(update, beforeCapture)

    expect(update).toHaveBeenCalledTimes(1)
    expect(beforeCapture).not.toHaveBeenCalled()
  })

  it('runs a view transition when supported, naming before capture', async () => {
    const start = mockStart()
    mockReducedMotion(false)
    const order: string[] = []
    const update = vi.fn(() => order.push('update'))
    const beforeCapture = vi.fn(() => order.push('beforeCapture'))

    await runViewTransition(update, beforeCapture)

    expect(start).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledTimes(1)
    expect(beforeCapture).toHaveBeenCalledTimes(1)
    // Names must land on the OLD layout before the browser snapshots it
    expect(order).toEqual(['beforeCapture', 'update'])
  })

  it('works without a beforeCapture step', async () => {
    mockStart()
    mockReducedMotion(false)
    const update = vi.fn()

    await runViewTransition(update)

    expect(update).toHaveBeenCalledTimes(1)
  })
})
