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

/**
 * What to look for when the caller has nothing better.
 *
 * Several subjects rather than one, because a preview picture has one job: to
 * show where the pictures go. A single query returns one room from a dozen
 * angles, and a layout filled with them reads as a wall of the same grey
 * photograph — the boxes stop being legible as separate boxes, which is the
 * one thing the preview exists to show.
 *
 * What a lecture is ABOUT, not where it happens. Rooms and blackboards are
 * the furniture around a lecture; a slide holds its subject — a leaf, an
 * orbit, a circuit, a chart. Filling a design's picture boxes with lecture
 * halls previews a deck nobody would make.
 *
 * Chosen to differ in kind as well as subject — a photograph, a diagram, a
 * map, a chart — because a box is being shown, and two pictures of the same
 * sort of thing read as one picture repeated.
 */
const DEFAULT_QUERIES = [
  'photosynthesis leaf closeup',
  'solar system planets',
  'human anatomy diagram',
  'circuit board electronics',
  'ancient roman architecture',
  'statistics chart graph',
  'world map continents',
  'crystal mineral macro',
]

/** The cache key for the default set. Fixed, so every caller that asks for
 * "whatever you have" shares one entry. */
const DEFAULT_KEY = 'default:mixed'

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

/** How many results to ask for. Generous: a collage layout can hold half a
 * dozen picture boxes, and running out means showing one of them twice. */
const POOL = 16

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

/** How many to keep from any one subject. A commons search returns whole
 * shoots — the same leaf photographed eight times — so a handful from each of
 * several subjects beats many from one. */
const PER_SUBJECT = 3

/**
 * Pictures for the preview: each subject searched on its own, then taken in
 * turn.
 *
 * Searching every subject at once and keeping the best few gave a set that
 * was distinct by URL and identical to the eye — the top two results were two
 * frames of the same leaf, from the same shoot, under sequential filenames. A
 * design showing those in consecutive boxes looks like it is showing one
 * picture twice, which is the thing the pool exists to prevent.
 *
 * Taking them in turn — leaf, orbit, diagram, board, leaf, orbit — puts a
 * different subject in every consecutive box and pushes any near-duplicate a
 * whole round away.
 */
const search = async (queries: string[]): Promise<string[]> => {
  try {
    // Wikimedia and Openverse need no credentials, so this works on a
    // deployment that has configured nothing. A subject that finds nothing
    // simply contributes nothing.
    const bySubject = await Promise.all(
      queries.map(query =>
        runUnmetered(() => searchImageCandidates([query], PER_SUBJECT)).catch(
          () => [],
        ),
      ),
    )

    const urls: string[] = []
    const seen = new Set<string>()
    for (let rank = 0; rank < PER_SUBJECT; rank++) {
      for (const subject of bySubject) {
        const url = subject[rank]?.url
        // Distinct pictures, not merely distinct results: two subjects can
        // land on the same file.
        if (url && !seen.has(url)) {
          seen.add(url)
          urls.push(url)
        }
      }
    }
    return urls.slice(0, POOL)
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
  query?: string,
  count = 1,
): Promise<string[]> => {
  const asked = query?.trim().toLowerCase()
  const key = asked || DEFAULT_KEY
  const queries = asked ? [asked] : DEFAULT_QUERIES
  const hit = cache.get(key)
  if (hit && fresh(hit)) return hit.urls.slice(0, count)

  const pending =
    inFlight.get(key) ??
    search(queries)
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
