/**
 * Wikimedia Commons image search (keyless). Returns candidates with
 * license/attribution metadata; any failure returns [] — enrichment is
 * never allowed to break the pipeline (IMG-2).
 */
import type { ImageCandidate } from './types'

const ENDPOINT = 'https://commons.wikimedia.org/w/api.php'

interface WikimediaPage {
  title?: string
  imageinfo?: Array<{
    thumburl?: string
    url?: string
    /** The Commons file page, returned by the 'url' iiprop. */
    descriptionurl?: string
    thumbwidth?: number
    width?: number
    height?: number
    extmetadata?: {
      LicenseShortName?: { value?: string }
      Artist?: { value?: string }
      Categories?: { value?: string }
    }
  }>
}

const stripHtml = (html: string): string => html.replace(/<[^>]+>/g, '').trim()

export const searchWikimedia = async (
  keywords: string[],
  signal: AbortSignal,
): Promise<ImageCandidate[]> => {
  try {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      origin: '*',
      generator: 'search',
      gsrsearch: keywords.join(' '),
      gsrnamespace: '6',
      gsrlimit: '8',
      prop: 'imageinfo',
      iiprop: 'url|size|extmetadata',
      iiurlwidth: '1024',
    })
    const res = await fetch(`${ENDPOINT}?${params}`, { signal })
    if (!res.ok) return []
    const data = (await res.json()) as {
      query?: { pages?: Record<string, WikimediaPage> }
    }

    return Object.values(data.query?.pages ?? {}).flatMap(page => {
      const info = page.imageinfo?.[0]
      const url = info?.thumburl ?? info?.url
      if (!url) return []
      const meta = info?.extmetadata
      const artist = meta?.Artist?.value
        ? stripHtml(meta.Artist.value)
        : undefined
      return [
        {
          url,
          title: (page.title ?? '')
            .replace(/^File:/, '')
            .replace(/\.[a-z]+$/i, ''),
          tags: meta?.Categories?.value
            ? stripHtml(meta.Categories.value).split('|')
            : [],
          source: 'wikimedia' as const,
          width: info?.thumbwidth ?? info?.width,
          height: info?.height,
          license: meta?.LicenseShortName?.value,
          attribution: artist
            ? `${artist} (Wikimedia Commons)`
            : 'Wikimedia Commons',
          sourceUrl:
            info?.descriptionurl ??
            (page.title
              ? `https://commons.wikimedia.org/wiki/${encodeURI(page.title)}`
              : undefined),
        },
      ]
    })
  } catch {
    return []
  }
}
