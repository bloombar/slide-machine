/**
 * The Discover sidebar on the home page (SOC-2/SOC-3). A light square-edged
 * panel, one viewport tall, holding the shared discover controls and results:
 * a "Latest"/"Top" toggle, a search box,
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
      className="flex h-[calc(100vh-8rem)] w-full flex-col overflow-hidden border border-slate-200 bg-slate-100"
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
      {/* The card is one viewport tall whatever it holds — a short feed leaves
          the space empty rather than shrinking, so the page beside it does not
          reflow as results load. Anything longer scrolls inside this list
          rather than growing the page. The 8rem is what the panel cannot
          have: the sticky header above it (3.5rem) and the page's own top
          padding (2rem), then the sticky health footer below (2rem) and a
          gap clear of it. The home page sticks it at exactly that top
          offset, so the panel holds still as the column beside it scrolls
          and never runs under the footer. */}
      <DiscoverResults
        discover={discover}
        className="min-h-0 flex-1 overflow-y-auto"
      />
    </aside>
  )
}
