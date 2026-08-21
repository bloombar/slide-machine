/**
 * Bringing a presentation's pictures with it (TMPL-8, docs/TEMPLATES.md §11).
 *
 * Google's image URLs are short-lived — a `contentUrl` read today is a 404
 * tomorrow — so a template that merely remembered them would look right for an
 * hour and then be full of holes. Every picture is fetched during the import
 * and stored under the template's own prefix.
 *
 * ## A picture that will not come is not an error
 *
 * One unreachable image must not cost an instructor the whole import. A fetch
 * that fails, times out, or returns something that is not an image leaves that
 * box empty, is counted, and appears in the report — which is the honest
 * outcome, and one the author can fix by dropping a file in.
 */
import { createHash } from 'node:crypto'
import { getStorage } from '../storage'

/** How long to wait for one picture. Generous enough for a large photo on a
 * slow link, short enough that a hung host cannot stall an import. */
export const ASSET_TIMEOUT_MS = 15_000

/** The largest picture worth storing. Past this it is someone's uncropped
 * camera original, and it would be downscaled for display anyway. */
export const MAX_ASSET_BYTES = 12 * 1024 * 1024

/** What Google serves that we are willing to store. */
const ALLOWED = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
])

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

/** One picture, once it is somewhere durable. */
export interface StoredAsset {
  /** The URL the presentation gave, which is how callers match it back. */
  sourceUrl: string
  /** Where it now lives, for the template to point at. */
  url: string
}

/**
 * What a picture is filed under: what it IS, not when it arrived.
 *
 * Named by position, a re-import of the same deck overwrote `0.png`, `1.png`
 * and the rest with DIFFERENT pictures. The prefix is the owner and the
 * presentation, so it is the same on every import; the order is not, because
 * Google's image URLs are short-lived and the order they are met in follows
 * consolidation, which can group a deck differently from one run to the next.
 *
 * So every template imported earlier kept pointing at those paths and silently
 * started showing whatever now sat at that index — a crest replaced by a
 * photograph of a building.
 *
 * Content-addressed instead: the same picture always lands in the same place,
 * so a re-import rewrites a file with its own bytes and nothing else moves. A
 * different picture gets a different name and cannot displace one in use.
 */
const keyFor = (body: Buffer, contentType: string): string =>
  `${createHash('sha256').update(body).digest('hex').slice(0, 32)}.${EXTENSIONS[contentType]}`

/**
 * Fetches one picture into storage under `prefix`.
 *
 * Returns null rather than throwing: the caller counts the failures and the
 * report names them.
 */
export const fetchAsset = async (
  sourceUrl: string,
  prefix: string,
): Promise<StoredAsset | null> => {
  try {
    const res = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(ASSET_TIMEOUT_MS),
    })
    if (!res.ok) return null

    const contentType = (res.headers.get('content-type') ?? '')
      .split(';')[0]!
      .trim()
      .toLowerCase()
    // A host that answers a picture request with an HTML error page is the
    // common case here, and storing that would give the author a broken box
    // that looks filled.
    if (!ALLOWED.has(contentType)) return null

    const declared = Number(res.headers.get('content-length') ?? 0)
    if (declared > MAX_ASSET_BYTES) return null

    const body = Buffer.from(await res.arrayBuffer())
    // Checked again: `content-length` is a claim, not a measurement.
    if (body.byteLength === 0 || body.byteLength > MAX_ASSET_BYTES) return null

    const key = `${prefix}/${keyFor(body, contentType)}`
    await getStorage().put(key, body, contentType)
    return { sourceUrl, url: getStorage().publicUrl(key) }
  } catch {
    // Timeout, DNS, a socket closed mid-body — all the same to the author.
    return null
  }
}

/**
 * Fetches every distinct picture a presentation refers to.
 *
 * Deduplicated by URL, because a logo on every slide is one file however many
 * slides show it, and fetched a few at a time so a picture-heavy deck does not
 * open sixty sockets at once.
 */
export const fetchAssets = async (
  urls: string[],
  prefix: string,
  concurrency = 4,
): Promise<{ stored: Map<string, string>; failed: number }> => {
  const distinct = [...new Set(urls.filter(Boolean))]
  const stored = new Map<string, string>()
  let failed = 0

  for (let i = 0; i < distinct.length; i += concurrency) {
    const batch = distinct.slice(i, i + concurrency)
    const results = await Promise.all(batch.map(url => fetchAsset(url, prefix)))
    for (const result of results) {
      if (result) stored.set(result.sourceUrl, result.url)
      else failed++
    }
  }

  return { stored, failed }
}
