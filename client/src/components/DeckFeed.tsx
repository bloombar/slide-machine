/**
 * The Discover sidebar on the home page (SOC-2/SOC-3). A light card holding the
 * shared discover controls and results: a "Latest"/"Top" toggle, a search box,
 * and the list beneath. With the box empty it shows the public-lecture feed;
 * typing a query switches to global search across public lectures, projects and
 * people. The chosen sort applies either way, and pages load as you scroll.
 *
 * All the behaviour lives in `components/discover`, so the planned full
 * Discover page can reuse it and only bring its own frame.
 */
import { useTranslation } from 'react-i18next'
import DiscoverControls from './discover/DiscoverControls'
import DiscoverResults from './discover/DiscoverResults'
import { useDiscover } from './discover/useDiscover'

export default function DeckFeed() {
  const { t } = useTranslation()
  const discover = useDiscover()

  return (
    <aside
      className="flex max-h-[calc(100vh-15rem)] w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
      aria-label={t('discover.regionLabel')}
    >
      <DiscoverControls
        heading={t('discover.title')}
        sort={discover.sort}
        onSortChange={discover.setSort}
        query={discover.query}
        onQueryChange={discover.setQuery}
        className="shrink-0 border-b border-slate-200"
      />
      {/* The card is a fixed-height flex column, so the list scrolls inside it
          rather than growing the page. */}
      <DiscoverResults
        discover={discover}
        className="min-h-0 flex-1 overflow-y-auto"
      />
    </aside>
  )
}
