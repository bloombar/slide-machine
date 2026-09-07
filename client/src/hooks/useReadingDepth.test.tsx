/**
 * Unit tests for the reading-depth tracker (EVAL-7 depth).
 *
 * `reportReadingDepth` is mocked so these assert on what the hook decides to
 * report and when, not on how the beacon reaches the network (that is
 * `decks.test.ts`'s job). The three properties under test are the ones the
 * design leans on: visible time only accrues while the tab is actually
 * visible, a close/hide/flush reports what has accrued so far, and the
 * furthest slide reached never shrinks even when the reader navigates back.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { useReadingDepth } from './useReadingDepth'
import * as decksApi from '../api/decks'

vi.mock('../api/decks', () => ({ reportReadingDepth: vi.fn() }))

/** Mounts the hook so its effects run under a real render lifecycle. */
function Harness({
  slug,
  completionKey,
  slideIndex,
}: {
  slug: string | undefined
  completionKey: string | null
  slideIndex: number
}) {
  useReadingDepth(slug, completionKey, slideIndex)
  return null
}

/** Flips `document.visibilityState` and fires the event the hook listens
 * for — jsdom's property is read-only otherwise. */
const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

const reports = () =>
  vi.mocked(decksApi.reportReadingDepth).mock.calls.map(([slug, body]) => ({
    slug,
    ...body,
  }))

afterEach(() => {
  vi.useRealTimers()
  vi.mocked(decksApi.reportReadingDepth).mockClear()
  setVisibility('visible')
})

describe('useReadingDepth', () => {
  it('accrues visible time but not hidden time, and reports it on hide', () => {
    vi.useFakeTimers()
    setVisibility('visible')
    render(<Harness slug="waves" completionKey="key1" slideIndex={0} />)

    vi.advanceTimersByTime(5_000)
    setVisibility('hidden')

    expect(reports()).toHaveLength(1)
    expect(reports()[0]!.activeMs).toBe(5_000)

    // Backgrounded: this time must not count.
    vi.advanceTimersByTime(20_000)
    setVisibility('visible')
    vi.advanceTimersByTime(2_000)
    window.dispatchEvent(new Event('pagehide'))

    const last = reports().at(-1)!
    // 5s + 2s visible, never the 20s spent hidden in between.
    expect(last.activeMs).toBe(7_000)
  })

  it('fires a report on pagehide', () => {
    vi.useFakeTimers()
    render(<Harness slug="waves" completionKey="key1" slideIndex={0} />)
    vi.advanceTimersByTime(1_000)

    expect(reports()).toHaveLength(0)
    window.dispatchEvent(new Event('pagehide'))

    expect(reports()).toHaveLength(1)
    expect(reports()[0]).toMatchObject({
      slug: 'waves',
      completionKey: 'key1',
    })
  })

  it('flushes periodically so a hard close still leaves a floor', () => {
    vi.useFakeTimers()
    render(<Harness slug="waves" completionKey="key1" slideIndex={0} />)

    vi.advanceTimersByTime(30_000)
    expect(reports()).toHaveLength(1)

    vi.advanceTimersByTime(30_000)
    expect(reports()).toHaveLength(2)
  })

  it('never shrinks the furthest slide reached, even after navigating back', () => {
    vi.useFakeTimers()
    const { rerender } = render(
      <Harness slug="waves" completionKey="key1" slideIndex={0} />,
    )
    rerender(<Harness slug="waves" completionKey="key1" slideIndex={3} />)
    rerender(<Harness slug="waves" completionKey="key1" slideIndex={1} />)

    window.dispatchEvent(new Event('pagehide'))

    // Furthest index reached was 3 (slide 4 of the deck), not the index the
    // reader ends up back on.
    expect(reports().at(-1)!.slidesReached).toBe(4)
  })

  it('reports nothing when there is no completion key yet', () => {
    vi.useFakeTimers()
    render(<Harness slug="waves" completionKey={null} slideIndex={2} />)
    vi.advanceTimersByTime(60_000)
    window.dispatchEvent(new Event('pagehide'))

    expect(reports()).toHaveLength(0)
  })

  it('reports nothing when there is no lecture open', () => {
    vi.useFakeTimers()
    render(<Harness slug={undefined} completionKey={null} slideIndex={0} />)
    vi.advanceTimersByTime(60_000)
    window.dispatchEvent(new Event('pagehide'))

    expect(reports()).toHaveLength(0)
  })

  it('starts a fresh clock and slide count for a new lecture', () => {
    vi.useFakeTimers()
    const { rerender } = render(
      <Harness slug="waves" completionKey="key1" slideIndex={9} />,
    )
    vi.advanceTimersByTime(5_000)

    // A different slug is a different opening — its own key, its own count.
    rerender(<Harness slug="tides" completionKey="key2" slideIndex={0} />)
    vi.advanceTimersByTime(1_000)
    window.dispatchEvent(new Event('pagehide'))

    const last = reports().at(-1)!
    expect(last.slug).toBe('tides')
    expect(last.slidesReached).toBe(1)
    expect(last.activeMs).toBe(1_000)
  })
})
