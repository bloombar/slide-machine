/**
 * Placeholder pictures for the template editor's preview.
 *
 * A layout with an empty picture-shaped hole says very little about how it
 * looks, so the editor fills its image slots while an author works. These are
 * not a slide's pictures — nobody chose them and nothing keeps them — so this
 * differs from real enrichment in two ways that matter:
 *
 *   - **Unmetered.** `gatherCandidates` meters an image lookup, rightly, since
 *     it cannot know who asked. Browsing your own template is not spending a
 *     lookup, so the search runs outside any usage attribution.
 *   - **Cached.** Real enrichment must never be cached: two slides asking the
 *     same question deserve their own answers, and a stale one would be wrong
 *     for months. A generic placeholder is the opposite — the same picture
 *     every time is exactly right, and it means clicking between layout tabs
 *     costs nothing.
 *
 * Kept in its own module rather than added to `search.ts` so that difference
 * stays deliberate and visible.
 */
import { runUnmetered } from '../billing/usage-context'
import { searchImageCandidates } from './search'

/** What to look for when the caller has nothing better. Broad and neutral: a
 * placeholder should read as "a picture goes here", not as a subject. */
const DEFAULT_QUERY = 'lecture hall classroom'

/** A found set is good for hours — nothing about it goes stale. */
const TTL_MS = 6 * 60 * 60 * 1000

/**
 * A failed search is remembered too, but briefly. Without this, an offline or
 * blocked provider means a fresh round trip on every tab click; with it, the
 * cost is one attempt every few minutes and the editor stays responsive.
 */
const MISS_TTL_MS = 5 * 60 * 1000

/** Enough for any plausible set of queries; bounded so a long-lived process
 * cannot grow one entry per typo. */
const MAX_ENTRIES = 32

/** How many results to ask for, so one search can fill a layout with several
 * picture boxes without repeating itself. */
const POOL = 8

interface Entry {
  at: number
  urls: string[]
}

const cache = new Map<string, Entry>()
/** In-flight searches, so several layout tabs opening at once share one
 * request rather than racing to make the same one. */
const inFlight = new Map<string, Promise<string[]>>()

const fresh = (entry: Entry): boolean => {
  const ttl = entry.urls.length ? TTL_MS : MISS_TTL_MS
  return Date.now() - entry.at < ttl
}

const remember = (key: string, urls: string[]): string[] => {
  if (cache.size >= MAX_ENTRIES) {
    // Oldest first: the entries most likely never to be asked for again.
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) cache.delete(oldest[0])
  }
  cache.set(key, { at: Date.now(), urls })
  return urls
}

const search = async (query: string): Promise<string[]> => {
  try {
    // Wikimedia and Openverse need no credentials, so this works on a
    // deployment that has configured nothing.
    const found = await runUnmetered(() => searchImageCandidates([query], POOL))
    return found.map(c => c.url)
  } catch {
    // A preview picture is never worth an error. The editor renders the empty
    // block it always did.
    return []
  }
}

/**
 * URLs to fill preview image slots with. Returns fewer than asked for, or
 * none at all, rather than failing — an editor that cannot open because an
 * image host is down would be a poor trade.
 */
export const previewImageUrls = async (
  query: string = DEFAULT_QUERY,
  count = 1,
): Promise<string[]> => {
  const key = query.trim().toLowerCase() || DEFAULT_QUERY
  const hit = cache.get(key)
  if (hit && fresh(hit)) return hit.urls.slice(0, count)

  const pending =
    inFlight.get(key) ??
    search(key)
      .then(urls => remember(key, urls))
      .finally(() => inFlight.delete(key))
  inFlight.set(key, pending)
  return (await pending).slice(0, count)
}

/** Test hook: forget everything, so a spec can control what a search returns. */
export const resetPreviewImageCache = (): void => {
  cache.clear()
  inFlight.clear()
}
