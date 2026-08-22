/**
 * Fetches slide images for the deck exports (PDF, Google Slides). Both renderers
 * embed the same images, so this is shared.
 *
 * Robustness matters here — slide images are arbitrary external URLs (Wikimedia,
 * Openverse, …) and several things go wrong in bulk:
 *  - Rate limiting: fetching all at once returns 429s or 200-status HTML block
 *    pages, silently dropping images. We fetch with bounded concurrency, send a
 *    descriptive User-Agent (Wikimedia policy), and retry transient failures.
 *  - Unreliable content-types: many hosts mislabel images, so we detect the
 *    real format from the file's magic bytes, not the Content-Type header.
 *  - Unsupported formats: pdf-lib embeds only PNG/JPEG, but sources increasingly
 *    serve WebP (and GIF, etc.), so those are converted to PNG with `sharp`.
 * A URL that still can't produce a usable image is skipped (best-effort).
 */
import sharp from 'sharp'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { getStorage } from '../storage'
import { env } from '../config/env'

const USER_AGENT = 'SlideMachine/1.0 (lecture slide export)'
const MAX_CONCURRENCY = 3
const MAX_RETRIES = 2

/** A fetched image's bytes and format (only the types pdf-lib embeds). */
export interface SlideImage {
  data: Uint8Array
  kind: 'png' | 'jpeg'
}

const delay = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

/** Identifies a file from its leading bytes (Content-Type headers lie). */
const sniff = (
  b: Uint8Array,
): 'png' | 'jpeg' | 'gif' | 'webp' | 'html' | 'other' => {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return 'png'
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif'
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45
  )
    return 'webp'
  // A leading '<' means HTML/XML — almost always a rate-limit or error page.
  if (b[0] === 0x3c) return 'html'
  return 'other'
}

/** Converts non-PNG/JPEG raster bytes (WebP, GIF, …) to PNG; undefined if the
 * bytes aren't a decodable image. */
const toPng = async (bytes: Uint8Array): Promise<SlideImage | undefined> => {
  try {
    const png = await sharp(Buffer.from(bytes)).png().toBuffer()
    return { data: new Uint8Array(png), kind: 'png' }
  } catch {
    return undefined
  }
}

/** Bytes that came from somewhere, turned into the PNG/JPEG the exporters
 * draw. Shared by the two ways a picture arrives: over HTTP, and off our own
 * storage. */
const imageFrom = async (
  bytes: Uint8Array,
): Promise<SlideImage | undefined> => {
  switch (sniff(bytes)) {
    case 'png':
      return { data: bytes, kind: 'png' }
    case 'jpeg':
      return { data: bytes, kind: 'jpeg' }
    case 'html':
      return undefined
    default:
      // WebP, GIF, or anything else sharp can decode → PNG for pdf-lib.
      return toPng(bytes)
  }
}

/** What a locally stored file's public URL looks like (`storage`'s local
 * driver). Everything after it is the storage key. */
const LOCAL_FILES = '/api/files/'

/**
 * A picture belonging to a built-in template's design (`templates/assets.ts`).
 *
 * Read off disk rather than fetched, for the same reason `/api/files/` is read
 * from storage: it is ours, and it has no absolute URL. Giving it one would
 * mean writing this deployment's origin into a template — and a template is
 * snapshotted when a deck pins it, so a development origin would be frozen
 * into decks and travel with them.
 */
const TEMPLATE_ASSETS = '/templates/'

const fromTemplateAssets = async (
  url: string,
): Promise<SlideImage | undefined> => {
  try {
    // Confined to the assets directory: the path comes from a template, and
    // a `..` in it must not reach the rest of the disk.
    const rel = path.normalize(
      decodeURIComponent(url.slice(TEMPLATE_ASSETS.length)),
    )
    if (rel.startsWith('..') || path.isAbsolute(rel)) return undefined
    const dir = path.join(env.TEMPLATES_DIR, 'assets')
    const file = path.join(dir, rel)
    if (!file.startsWith(dir)) return undefined
    return imageFrom(new Uint8Array(await readFile(file)))
  } catch {
    return undefined
  }
}

/**
 * A picture the app stores itself, read straight off storage.
 *
 * The local storage driver hands out a app-relative URL — `/api/files/<key>`
 * — because that is what a browser needs. `fetch` cannot use one: it wants an
 * absolute URL, and the export ran on the server with no origin to resolve
 * against. So every picture on an imported deck was skipped, silently, and
 * the deck exported with holes where its images had been. An imported lecture
 * is the case where every picture is one of these.
 *
 * Read rather than fetched even where an origin could be worked out: the
 * bytes are on this machine, and asking ourselves for them over HTTP is a
 * round trip that can fail for reasons the picture has nothing to do with.
 */
const fromStorage = async (url: string): Promise<SlideImage | undefined> => {
  try {
    const bytes = await getStorage().get(
      decodeURIComponent(url.slice(LOCAL_FILES.length)),
    )
    return bytes ? imageFrom(new Uint8Array(bytes)) : undefined
  } catch {
    return undefined
  }
}

/** Fetches one image URL, retrying transient rate-limit responses (429/503, or
 * a 200-status HTML block page), and normalizing the result to PNG/JPEG. */
const fetchOne = async (
  url: string | undefined,
  attempt = 0,
): Promise<SlideImage | undefined> => {
  if (!url) return undefined
  // A picture of our own, which has no absolute URL to fetch.
  if (url.startsWith(LOCAL_FILES)) return fromStorage(url)
  if (url.startsWith(TEMPLATE_ASSETS)) return fromTemplateAssets(url)
  if (!/^https?:\/\//i.test(url)) return undefined
  try {
    const res = await fetch(url, {
      // `image/*` alone is refused by hosts that serve pictures from an API
      // path rather than a file one — Openverse answers 406 and the picture
      // vanished from the export with nothing said. Preferring images while
      // accepting anything gets the bytes and still says what we want.
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'image/*,*/*;q=0.8',
      },
    })
    if ((res.status === 429 || res.status === 503) && attempt < MAX_RETRIES) {
      await delay(300 * (attempt + 1))
      return fetchOne(url, attempt + 1)
    }
    if (!res.ok) return undefined
    const bytes = new Uint8Array(await res.arrayBuffer())
    // A block/error page served with a 200 — retry, then give up.
    if (sniff(bytes) === 'html' && attempt < MAX_RETRIES) {
      await delay(300 * (attempt + 1))
      return fetchOne(url, attempt + 1)
    }
    return imageFrom(bytes)
  } catch {
    return undefined
  }
}

/**
 * Fetches the given image URLs (one per slide; undefined where a slide has no
 * image), preserving order, with bounded concurrency so bulk exports don't
 * rate-limit the image hosts. Failed/absent images come back as undefined.
 */
export const fetchSlideImages = async (
  urls: Array<string | undefined>,
): Promise<Array<SlideImage | undefined>> => {
  const results: Array<SlideImage | undefined> = new Array(urls.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < urls.length) {
      const index = next++
      results[index] = await fetchOne(urls[index])
    }
  }
  const workers = Math.min(MAX_CONCURRENCY, urls.length)
  await Promise.all(Array.from({ length: workers }, worker))
  return results
}

/** A `data:` URI for a fetched image, for pptxgenjs's addImage. */
export const toDataUri = (image: SlideImage): string =>
  `data:image/${image.kind};base64,${Buffer.from(image.data).toString('base64')}`

/**
 * The pictures a design draws, by the reference each box names (TMPL-8).
 *
 * Keyed by reference rather than indexed by slide, because that is what a
 * design's picture IS: one crest drawn on forty slides is one file, and
 * fetching it per slide would cost forty requests for one answer.
 *
 * A picture that will not come is simply absent from the map, and the box is
 * left unpainted — the same bargain the import makes. One unreachable logo
 * must not cost an instructor their file.
 */
export const fetchDecorationImages = async (
  boxes: Array<{ kind: string; ref?: string }>,
): Promise<Map<string, SlideImage>> => {
  const refs = [
    ...new Set(
      boxes.filter(box => box.kind === 'image' && box.ref).map(box => box.ref!),
    ),
  ]
  const fetched = await fetchSlideImages(refs)
  const found = new Map<string, SlideImage>()
  refs.forEach((ref, i) => {
    const image = fetched[i]
    if (image) found.set(ref, image)
  })
  return found
}
