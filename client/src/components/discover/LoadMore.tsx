/**
 * The end-of-list trigger that makes a browsable list load lazily (SOC-2). An
 * IntersectionObserver fires `onLoadMore` as the button scrolls into view, so
 * reading down the list pulls the next page in without a click. The button is
 * real rather than an invisible sentinel: keyboard users, screen readers, and
 * anything without an observer still have a way to go on.
 */
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

export default function LoadMore({
  onLoadMore,
  loading,
}: {
  /** Should be stable between renders — the observer is rebuilt when it changes. */
  onLoadMore: () => void
  loading: boolean
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const el = ref.current
    // jsdom and older browsers have no observer; the button still works.
    if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) onLoadMore()
      },
      // Start fetching just before the button is reached, so the next page is
      // usually there by the time the reader gets to it.
      { rootMargin: '120px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [onLoadMore])

  return (
    <button
      ref={ref}
      type="button"
      onClick={onLoadMore}
      disabled={loading}
      className="w-full px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-900 disabled:opacity-60"
    >
      {loading ? t('common.loading') : t('discover.loadMore')}
    </button>
  )
}
