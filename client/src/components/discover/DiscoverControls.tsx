/**
 * The header of a browsable list (SOC-2): the recency/rank sort toggle and the
 * search box. The sort sits above the box on purpose — it governs the search
 * results as much as it governs the unfiltered feed, so switching it while a
 * query is typed reorders what is on screen.
 *
 * Layout-light and fully controlled, so the home sidebar and a full Discover
 * page — of lectures, or of style templates (`/app/templates`, TMPL-28),
 * which adds a third "Mine" sort no lecture list has — can present the same
 * controls at different widths.
 */
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import type { FeedSort, TemplateFeedSort } from '@slide-machine/shared'

/** One sort tab: the value it sets, and the message key that labels it.
 * Generic over the sort vocabulary itself (TMPL-28 round 2), so a caller
 * whose sort type is `FeedSort` cannot be handed a "Mine" tab it has no
 * `TemplateFeedSort`-typed state to hold — the compiler catches it, not
 * merely nobody wiring one up. */
export type SortTab<Sort extends TemplateFeedSort = TemplateFeedSort> = {
  value: Sort
  labelKey: string
}

/** The two orders SOC-2 requires, and the message key that labels each. The
 * default; a caller with a third sort (template "Mine") passes its own via
 * `sorts` rather than this component growing a template-specific option of
 * its own. */
const SORT_TABS: SortTab<FeedSort>[] = [
  { value: 'latest', labelKey: 'discover.latest' },
  { value: 'top', labelKey: 'discover.top' },
]

export default function DiscoverControls<
  Sort extends TemplateFeedSort = FeedSort,
>({
  sort,
  onSortChange,
  query,
  onQueryChange,
  heading,
  className = '',
  sorts = SORT_TABS as unknown as SortTab<Sort>[],
  searchLabelKey = 'discover.searchLabel',
  searchPlaceholderKey = 'discover.searchPlaceholder',
}: {
  sort: Sort
  onSortChange: (sort: Sort) => void
  query: string
  onQueryChange: (query: string) => void
  /** Optional title above the controls; omitted when the page has its own. */
  heading?: string
  /** Chrome for the host layout — the sidebar wants a bottom border and no
   * flex growth, a full page will want neither. Kept out of the component so
   * the same controls sit in either. */
  className?: string
  /** Which sort tabs to offer, in order. Defaults to Latest/Top; the Design
   * Templates page (TMPL-28) passes its own with "Mine" appended, rather
   * than this component special-casing a sort no lecture list has. */
  sorts?: SortTab<Sort>[]
  /** Message keys for the search box's label and placeholder. Default to
   * Discover's own lecture-flavoured copy; the Design Templates page passes
   * its own, since "Search lectures, projects, and people" is wrong for a
   * list of designs. */
  searchLabelKey?: string
  searchPlaceholderKey?: string
}) {
  const { t } = useTranslation()

  return (
    <div className={`px-3 py-2 ${className}`}>
      {heading && (
        <h2 className="text-center text-sm font-semibold text-slate-700">
          {heading}
        </h2>
      )}
      <div className="mt-2 flex justify-center gap-1">
        {sorts.map(({ value, labelKey }) => (
          <button
            key={value}
            type="button"
            onClick={() => onSortChange(value)}
            aria-pressed={sort === value}
            className={`rounded-md px-3 py-0.5 text-xs font-medium ${
              sort === value
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>
      <div className="relative mt-2">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          aria-label={t(searchLabelKey)}
          placeholder={t(searchPlaceholderKey)}
          className="w-full rounded-md border border-slate-200 bg-white py-1.5 pr-2 pl-8 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 focus:outline-none"
        />
      </div>
    </div>
  )
}
