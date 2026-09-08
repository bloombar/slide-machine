/**
 * Unit tests for the reading-depth tracker (EVAL-7 depth).
 *
 * `reportReadingDepth` is mocked so these assert on what the hook decides to
 * report and when, not on how the beacon reaches the network (that is
 * `decks.test.ts`'s job). The properties under test are the ones the design
 * leans on: visible time only accrues while the tab is actually visible, a
 * close/hide/flush reports what has accrued so far, and the furthest slide
 * reached never shrinks even when the reader navigates back.
 *
 * The last block is about the seam rather than the hook. A reading longer
 * than the flush interval sends several reports under one key, and only the
 * last is accurate — so the server must accept that key repeatedly and keep
 * the largest values. Those tests state the half of the contract this side
 * owns; `deck-views.test.ts` states the other half. Neither file can see the
 * defect alone, which is where it lived.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
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
  // Unmount *before* clearing, not after. The hook reports on unmount now, so
  // Testing Library's own automatic cleanup — which runs after this hook —
  // would otherwise file that report into the next test's tally.
  cleanup()
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

  it('reports again on every flush of a long reading, always under the same key', () => {
    vi.useFakeTimers()
    const { rerender } = render(
      <Harness slug="waves" completionKey="key1" slideIndex={0} />,
    )

    // Two minutes of reading, advancing a slide a minute — four flushes.
    vi.advanceTimersByTime(30_000)
    vi.advanceTimersByTime(30_000)
    rerender(<Harness slug="waves" completionKey="key1" slideIndex={1} />)
    vi.advanceTimersByTime(30_000)
    vi.advanceTimersByTime(30_000)
    rerender(<Harness slug="waves" completionKey="key1" slideIndex={2} />)
    window.dispatchEvent(new Event('pagehide'))

    // Not one report: the reader is not finished at the first flush, and the
    // hook has no way to know which report will turn out to be the last.
    expect(reports().length).toBeGreaterThan(4)
    // Every one of them carries the same key, so a server that retired the
    // key on first use would keep only the first — the one describing the
    // first thirty seconds.
    expect(reports().every(r => r.completionKey === 'key1')).toBe(true)
  })

  it('makes the last report of a long reading the complete one', () => {
    vi.useFakeTimers()
    const { rerender } = render(
      <Harness slug="waves" completionKey="key1" slideIndex={0} />,
    )

    // The first flush fires thirty seconds in, one slide read. If this were
    // the report that stuck, the study would record a two-minute, five-slide
    // reading as a thirty-second, one-slide one.
    vi.advanceTimersByTime(30_000)
    const first = reports()[0]!
    expect(first.slidesReached).toBe(1)
    expect(first.activeMs).toBe(30_000)

    rerender(<Harness slug="waves" completionKey="key1" slideIndex={4} />)
    vi.advanceTimersByTime(90_000)
    window.dispatchEvent(new Event('pagehide'))

    const last = reports().at(-1)!
    expect(last.slidesReached).toBe(5)
    expect(last.activeMs).toBe(120_000)
    // Monotone throughout: whichever report the server sees last, keeping the
    // maximum of what it holds and what arrives gives the right answer.
    for (let i = 1; i < reports().length; i += 1) {
      expect(reports()[i]!.slidesReached).toBeGreaterThanOrEqual(
        reports()[i - 1]!.slidesReached,
      )
      expect(reports()[i]!.activeMs).toBeGreaterThanOrEqual(
        reports()[i - 1]!.activeMs,
      )
    }
  })

  it('reports on unmount, so leaving the lecture inside the app still counts', () => {
    vi.useFakeTimers()
    const { unmount } = render(
      <Harness slug="waves" completionKey="key1" slideIndex={2} />,
    )
    vi.advanceTimersByTime(4_000)
    // A click through to another route inside the app: the page never
    // unloads, so neither `pagehide` nor `visibilitychange` fires and the
    // flush has not come round yet. Without a report here the whole reading
    // goes unrecorded.
    expect(reports()).toHaveLength(0)

    unmount()

    expect(reports()).toHaveLength(1)
    expect(reports()[0]).toMatchObject({
      slug: 'waves',
      completionKey: 'key1',
      slidesReached: 3,
      activeMs: 4_000,
    })
  })

  it('stays quiet while nothing can change, so an idle tab does not flood', () => {
    vi.useFakeTimers()
    render(<Harness slug="waves" completionKey="key1" slideIndex={0} />)

    vi.advanceTimersByTime(30_000)
    setVisibility('hidden')
    const afterHide = reports().length

    // Backgrounded for an hour: visible time is frozen and the reader is not
    // turning slides, so every flush in that hour would repeat the report the
    // hide already sent. A lecture hall shares one address with the
    // completion route's rate limiter; idle tabs must not spend it.
    vi.advanceTimersByTime(60 * 60_000)
    expect(reports()).toHaveLength(afterHide)

    // Coming back and reading on resumes reporting.
    setVisibility('visible')
    vi.advanceTimersByTime(30_000)
    expect(reports().length).toBeGreaterThan(afterHide)
  })
})
