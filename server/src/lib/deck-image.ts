/**
 * Fetches slide images for the deck exports (PDF, Google Slides). Both renderers
 * embed the same images, so this is shared.
 *
 * Slide images are external URLs (Wikimedia, Openverse, …). Fetching them all at
 * once rate-limits (HTTP 429) and silently drops images, so this fetches with
 * bounded concurrency and retries transient 429/503s with a short backoff, and
 * sends a descriptive User-Agent (Wikimedia's policy). Best-effort: an image
 * that still fails is simply omitted rather than failing the whole export.
 */
const USER_AGENT = 'SlideMachine/1.0 (lecture slide export)'
const MAX_CONCURRENCY = 3
const MAX_RETRIES = 2

/** A fetched image's bytes and format (only the types both renderers support). */
export interface SlideImage {
  data: Uint8Array
  kind: 'png' | 'jpeg'
}

const delay = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

/** Fetches one image URL, retrying transient rate-limit/overload responses. */
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
    const type = res.headers.get('content-type') ?? ''
    const data = new Uint8Array(await res.arrayBuffer())
    if (/png/i.test(type)) return { data, kind: 'png' }
    if (/jpe?g/i.test(type)) return { data, kind: 'jpeg' }
    return undefined
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
