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
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DISCOVER_PAGE_SIZE,
  type DeckFeedResponse,
  type FeedDeck,
  type FeedSort,
  type SearchProject,
  type SearchResults,
  type SearchUser,
  type TemplateFeedSort,
} from '@slide-machine/shared'
import { dispatchAction } from '../../api/actions'

/** How long typing settles before a search is sent, in milliseconds. */
const SEARCH_DEBOUNCE_MS = 250

/**
 * Which actions back a browsable list, and what a search answer's rows look
 * like. Named rather than hardcoded so a second kind of content reuses this
 * hook by naming its own trio, instead of forking it — style templates
 * (TMPL-28) are the first to.
 */
export interface DiscoverSource<T extends { id: string } = FeedDeck> {
  /** Serves the unfiltered feed: `{ sort, offset, limit }` -> `{items, hasMore}`. */
  feedAction: string
  /** Searches the same content: `{ q, sort, offset, limit }` -> a response
   * `normalizeSearch` can read rows out of. */
  searchAction: string
  /** Pulls the row list out of a search response. Defaults to a lecture
   * search's own shape (`SearchResults.lectures`); a template search answers
   * `{items, hasMore}` like its feed does, so its source supplies its own. */
  normalizeSearch?: (res: unknown) => T[]
}

/** Lectures, the only browsable content today (SOC-2/SOC-3). */
export const LECTURE_SOURCE: DiscoverSource<FeedDeck> = {
  feedAction: 'deck.feed',
  searchAction: 'social.search',
}

const defaultNormalizeSearch = <T extends { id: string }>(res: unknown): T[] =>
  (res as SearchResults).lectures as unknown as T[]

/** One page of results, tagged with the sort and query it answers so a stale
 * response from a superseded request is never rendered.
 *
 * `Sort` is generic, not hardcoded to `TemplateFeedSort`, so a caller whose
 * sort vocabulary is narrower — a lecture list has no "Mine" — is held to
 * that narrower type by the compiler rather than merely by nobody wiring a
 * "Mine" tab up. */
interface LoadedPage<T extends { id: string }, Sort extends TemplateFeedSort> {
  sort: Sort
  q: string
  lectures: T[]
  projects: SearchProject[]
  users: SearchUser[]
  hasMore: boolean
}

/** Fetches one page from whichever action the current query calls for. */
const fetchPage = async <
  T extends { id: string },
  Sort extends TemplateFeedSort,
>(
  source: DiscoverSource<T>,
  sort: Sort,
  q: string,
  offset: number,
): Promise<Omit<LoadedPage<T, Sort>, 'sort' | 'q'>> => {
  if (q) {
    const res = await dispatchAction<unknown>(source.searchAction, {
      q,
      sort,
      offset,
      limit: DISCOVER_PAGE_SIZE,
    })
    const normalize = source.normalizeSearch ?? defaultNormalizeSearch<T>
    const withGroups = res as Partial<SearchResults>
    return {
      lectures: normalize(res),
      // Only a lecture search groups matching projects and people; a source
      // with no such groups (a template search) simply has none to show.
      projects: withGroups.projects ?? [],
      users: withGroups.users ?? [],
      hasMore: (res as { hasMore: boolean }).hasMore,
    }
  }
  const res = await dispatchAction<DeckFeedResponse>(source.feedAction, {
    sort,
    offset,
    limit: DISCOVER_PAGE_SIZE,
  })
  return {
    lectures: res.items as unknown as T[],
    projects: [],
    users: [],
    hasMore: res.hasMore,
  }
}

export interface Discover<
  T extends { id: string } = FeedDeck,
  Sort extends TemplateFeedSort = FeedSort,
> {
  sort: Sort
  setSort: (sort: Sort) => void
  query: string
  setQuery: (query: string) => void
  /** The query actually being answered — trimmed, so spaces alone stay in feed
   * mode. Empty means the list is the unfiltered feed. */
  searching: boolean
  /** Results for the current sort and query, or null while the first page of
   * them is still in flight. */
  page: LoadedPage<T, Sort> | null
  /** True when the first page could not be loaded at all. */
  error: boolean
  /** True while a `loadMore()` is in flight. */
  loadingMore: boolean
  /** Appends the next page; a no-op when one is already loading or the list is
   * exhausted. */
  loadMore: () => void
  /**
   * Drops one row from the loaded page, for a caller that deletes something
   * out from under this list (a design's own Delete, TMPL-28).
   *
   * This has to shrink the same array `loadMore`'s offset is computed from
   * (`lectures.length`), not merely hide the row in the caller's own render:
   * deleting a row shifts every row after it, on the server's own ordered
   * list, one position earlier. An offset computed as if the deleted row
   * were still counted would then land one row past where the next page
   * actually starts, silently skipping whatever shifted into the gap.
   * Filtering the row out of this state is what keeps the offset honest.
   */
  remove: (id: string) => void
  /**
   * Rewrites one row in place — a design's own vote count changing, TMPL-27
   * — without waiting for a refetch.
   *
   * This is not merely cosmetic: `page` (and the `current` it is derived
   * into) is reused as-is whenever a sort or query change lands back on one
   * already fetched, before the fresh refetch that change also kicks off
   * has come back — so switching sort away and back quickly shows the
   * *cached* page for an instant. Without patching the row a vote landed
   * on, that instant would flash the pre-vote counts the cached page still
   * holds, even though the control that cast the vote already moved on.
   */
  patch: (id: string, update: (item: T) => T) => void
  /**
   * Refetches page one under the *current* sort and query (TMPL-28), for a
   * caller whose own action added a row this list should now show — an
   * import landing on "Mine", say — where the sort is not changing, so the
   * page-one effect above has nothing to react to on its own.
   */
  refresh: () => void
}

export function useDiscover<
  T extends { id: string } = FeedDeck,
  Sort extends TemplateFeedSort = FeedSort,
>({
  source = LECTURE_SOURCE as unknown as DiscoverSource<T>,
  initialSort = 'latest' as Sort,
}: {
  source?: DiscoverSource<T>
  initialSort?: Sort
} = {}): Discover<T, Sort> {
  const [sort, setSort] = useState<Sort>(initialSort)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState<LoadedPage<T, Sort> | null>(null)
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

  // How many `remove()` calls have landed *since the current `loadMore()`
  // fetch started* — reset when each one starts, and read only when it
  // answers, to tell whether that answer crossed a delete.
  const removedDuringLoad = useRef(0)

  const loadMore = useCallback(() => {
    if (!current || !current.hasMore || loadingMore) return
    setLoadingMore(true)
    removedDuringLoad.current = 0
    const requestedFrom = current.lectures.length
    fetchPage(source, sort, q, requestedFrom)
      .then(res => {
        setPage(prev => {
          // Guard again on arrival: the sort or query may have changed while
          // this page was in flight, and appending it would mix two lists.
          if (!prev || prev.sort !== sort || prev.q !== q) return prev
          // A `remove()` while this fetch was in flight shifted the server's
          // list under it, and which side of the delete the server read this
          // page on is unknowable from here — so no slice of it can be
          // trusted. Discard it: the page keeps `hasMore`, the next trigger
          // asks again from the corrected `prev.lectures.length`, and a
          // de-duplicated refetch is right under either ordering.
          if (removedDuringLoad.current > 0) return prev
          const already = new Set(prev.lectures.map(item => item.id))
          const appended = res.lectures.filter(item => !already.has(item.id))
          // Nothing new came back (every row was already on screen, e.g.
          // after enough newer rows were published ahead of the offset).
          // Stop loading on its own rather than re-asking the same offset
          // forever; a sort or search change starts a fresh list.
          if (appended.length === 0) return { ...prev, hasMore: false }
          return {
            ...prev,
            lectures: [...prev.lectures, ...appended],
            hasMore: res.hasMore,
          }
        })
      })
      .catch(() => {
        // A failed "load more" leaves what is already on screen alone; the
        // button stays for a retry rather than blanking the list.
      })
      .finally(() => setLoadingMore(false))
  }, [source, current, sort, q, loadingMore])

  const remove = useCallback((id: string) => {
    removedDuringLoad.current += 1
    setPage(prev =>
      prev
        ? { ...prev, lectures: prev.lectures.filter(item => item.id !== id) }
        : prev,
    )
  }, [])

  const patch = useCallback((id: string, update: (item: T) => T) => {
    setPage(prev =>
      prev
        ? {
            ...prev,
            lectures: prev.lectures.map(item =>
              item.id === id ? update(item) : item,
            ),
          }
        : prev,
    )
  }, [])

  const refresh = useCallback(() => {
    fetchPage(source, sort, q, 0)
      .then(res => {
        setPage({ sort, q, ...res })
        setError(false)
      })
      .catch(() => setError(true))
  }, [source, sort, q])

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
    remove,
    patch,
    refresh,
  }
}
