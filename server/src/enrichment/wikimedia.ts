/**
 * Wikimedia Commons image search (keyless). Maps the File page's
 * imageinfo + extmetadata onto the shared ImageAttribution shape (IMG-5);
 * any failure returns [] — enrichment is never allowed to break the
 * pipeline (IMG-2).
 */
import type { ImageAttribution } from '@slide-machine/shared'
import type { ImageCandidate } from './types'

const ENDPOINT = 'https://commons.wikimedia.org/w/api.php'

interface WikimediaPage {
  title?: string
  imageinfo?: Array<{
    thumburl?: string
    url?: string
    descriptionurl?: string
    thumbwidth?: number
    width?: number
    height?: number
    extmetadata?: {
      ImageDescription?: { value?: string }
      LicenseShortName?: { value?: string }
      LicenseUrl?: { value?: string }
      Artist?: { value?: string }
      Categories?: { value?: string }
    }
  }>
}

const stripHtml = (html: string): string => html.replace(/<[^>]+>/g, '').trim()

/** Wikimedia's Artist/description fields are HTML; pull the first link out
 * for a creator URL, normalizing Commons' protocol-relative/relative hrefs. */
const extractHref = (html: string): string | undefined => {
  const href = html.match(/href="([^"]+)"/i)?.[1]
  if (!href) return undefined
  if (href.startsWith('//')) return `https:${href}`
  if (href.startsWith('/')) return `https://commons.wikimedia.org${href}`
  return href
}

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
      const artistHtml = meta?.Artist?.value
      const title = (page.title ?? '')
        .replace(/^File:/, '')
        .replace(/\.[a-z]+$/i, '')
      const attribution: ImageAttribution = {
        caption: meta?.ImageDescription?.value
          ? stripHtml(meta.ImageDescription.value)
          : undefined,
        title,
        creator: artistHtml ? stripHtml(artistHtml) : undefined,
        creatorUrl: artistHtml ? extractHref(artistHtml) : undefined,
        sourceUrl: info?.descriptionurl,
        sourceName: 'Wikimedia Commons',
        license: meta?.LicenseShortName?.value,
        licenseUrl: meta?.LicenseUrl?.value,
      }
      return [
        {
          url,
          title,
          tags: meta?.Categories?.value
            ? stripHtml(meta.Categories.value).split('|')
            : [],
          source: 'wikimedia' as const,
          width: info?.thumbwidth ?? info?.width,
          height: info?.height,
          attribution,
        },
      ]
    })
  } catch {
    return []
  }
}
