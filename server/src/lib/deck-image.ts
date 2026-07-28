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

/** Fetches one image URL, retrying transient rate-limit responses (429/503, or
 * a 200-status HTML block page), and normalizing the result to PNG/JPEG. */
const fetchOne = async (
  url: string | undefined,
  attempt = 0,
): Promise<SlideImage | undefined> => {
  if (!url || !/^https?:\/\//i.test(url)) return undefined
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'image/*' },
    })
    if ((res.status === 429 || res.status === 503) && attempt < MAX_RETRIES) {
      await delay(300 * (attempt + 1))
      return fetchOne(url, attempt + 1)
    }
    if (!res.ok) return undefined
    const bytes = new Uint8Array(await res.arrayBuffer())
    switch (sniff(bytes)) {
      case 'png':
        return { data: bytes, kind: 'png' }
      case 'jpeg':
        return { data: bytes, kind: 'jpeg' }
      case 'html':
        // A block/error page served with a 200 — retry, then give up.
        if (attempt < MAX_RETRIES) {
          await delay(300 * (attempt + 1))
          return fetchOne(url, attempt + 1)
        }
        return undefined
      default:
        // WebP, GIF, or anything else sharp can decode → PNG for pdf-lib.
        return toPng(bytes)
    }
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
