/**
 * State for a browsable public-content list (SOC-2/SOC-3): the sort, the search
 * query, and the pages loaded so far.
 *
 * One hook covers both modes because they are the same list with a filter. With
 * the query empty it pages `deck.feed`; with a query it pages `social.search`,
 * and either way the caller's sort ("latest" or "top") is passed to the server —
 * the chosen order applies to search results exactly as it does to the feed.
 *
 * Pages load lazily: the first arrives on mount and each `loadMore()` appends
 * the next, so nothing fetches a whole list up front. Changing the sort or the
 * query starts over from page one.
 *
 * Deliberately free of layout, so the home sidebar and a future full Discover
 * page can share it.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  DISCOVER_PAGE_SIZE,
  type DeckFeedResponse,
  type FeedDeck,
  type FeedSort,
  type SearchProject,
  type SearchResults,
  type SearchUser,
} from '@slide-machine/shared'
import { dispatchAction } from '../../api/actions'

/** How long typing settles before a search is sent, in milliseconds. */
const SEARCH_DEBOUNCE_MS = 250

/**
 * Which actions back a browsable list. Named rather than hardcoded so a second
 * kind of content — style templates, once TMPL-1/4 gives them an entity — can
 * reuse this hook by naming its own pair, instead of forking it.
 */
export interface DiscoverSource {
  /** Serves the unfiltered feed: `{ sort, offset, limit }` -> `DeckPage`. */
  feedAction: string
  /** Searches the same content: `{ q, sort, offset, limit }` -> `SearchResults`. */
  searchAction: string
}

/** Lectures, the only browsable content today (SOC-2/SOC-3). */
export const LECTURE_SOURCE: DiscoverSource = {
  feedAction: 'deck.feed',
  searchAction: 'social.search',
}

/** One page of results, tagged with the sort and query it answers so a stale
 * response from a superseded request is never rendered. */
interface LoadedPage {
  sort: FeedSort
  q: string
  lectures: FeedDeck[]
  projects: SearchProject[]
  users: SearchUser[]
  hasMore: boolean
}

/** Fetches one page from whichever action the current query calls for. */
const fetchPage = async (
  source: DiscoverSource,
  sort: FeedSort,
  q: string,
  offset: number,
): Promise<Omit<LoadedPage, 'sort' | 'q'>> => {
  if (q) {
    const res = await dispatchAction<SearchResults>(source.searchAction, {
      q,
      sort,
      offset,
      limit: DISCOVER_PAGE_SIZE,
    })
    return {
      lectures: res.lectures,
      projects: res.projects,
      users: res.users,
      hasMore: res.hasMore,
    }
  }
  const res = await dispatchAction<DeckFeedResponse>(source.feedAction, {
    sort,
    offset,
    limit: DISCOVER_PAGE_SIZE,
  })
  return { lectures: res.items, projects: [], users: [], hasMore: res.hasMore }
}

export interface Discover {
  sort: FeedSort
  setSort: (sort: FeedSort) => void
  query: string
  setQuery: (query: string) => void
  /** The query actually being answered — trimmed, so spaces alone stay in feed
   * mode. Empty means the list is the unfiltered feed. */
  searching: boolean
  /** Results for the current sort and query, or null while the first page of
   * them is still in flight. */
  page: LoadedPage | null
  /** True when the first page could not be loaded at all. */
  error: boolean
  /** True while a `loadMore()` is in flight. */
  loadingMore: boolean
  /** Appends the next page; a no-op when one is already loading or the list is
   * exhausted. */
  loadMore: () => void
}

export function useDiscover({
  source = LECTURE_SOURCE,
  initialSort = 'latest',
}: { source?: DiscoverSource; initialSort?: FeedSort } = {}): Discover {
  const [sort, setSort] = useState<FeedSort>(initialSort)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState<LoadedPage | null>(null)
  const [error, setError] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const q = query.trim()

  // Page one, refetched whenever the sort or the query changes. Typing is
  // debounced; changing the sort is not, so a tab click feels immediate.
  useEffect(() => {
    let cancelled = false
    const run = () => {
      fetchPage(source, sort, q, 0)
        .then(res => {
          if (cancelled) return
          setPage({ sort, q, ...res })
          setError(false)
        })
        .catch(() => {
          if (!cancelled) setError(true)
        })
    }
    if (!q) {
      run()
      return () => {
        cancelled = true
      }
    }
    const id = setTimeout(run, SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [source, sort, q])

  // Only a page answering the *current* sort and query counts; while a changed
  // one is in flight the caller sees null and can show a loading state.
  const current = page && page.sort === sort && page.q === q ? page : null

  const loadMore = useCallback(() => {
    if (!current || !current.hasMore || loadingMore) return
    setLoadingMore(true)
    fetchPage(source, sort, q, current.lectures.length)
      .then(res => {
        setPage(prev =>
          // Guard again on arrival: the sort or query may have changed while
          // this page was in flight, and appending it would mix two lists.
          prev && prev.sort === sort && prev.q === q
            ? {
                ...prev,
                lectures: [...prev.lectures, ...res.lectures],
                hasMore: res.hasMore,
              }
            : prev,
        )
      })
      .catch(() => {
        // A failed "load more" leaves what is already on screen alone; the
        // button stays for a retry rather than blanking the list.
      })
      .finally(() => setLoadingMore(false))
  }, [source, current, sort, q, loadingMore])

  return {
    sort,
    setSort,
    query,
    setQuery,
    searching: q.length > 0,
    page: current,
    error,
    loadingMore,
    loadMore,
  }
}
