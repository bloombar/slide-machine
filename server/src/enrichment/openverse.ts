/**
 * Openverse image search (keyless, CC-licensed aggregate incl. Flickr).
 * Maps Openverse's structured license fields onto the shared
 * ImageAttribution shape (IMG-5). Any failure returns [] — enrichment
 * never breaks the pipeline (IMG-2).
 */
import type { ImageAttribution } from '@slide-machine/shared'
import type { ImageCandidate } from './types'
import { BROWSER_USER_AGENT } from './user-agent'
import { env } from '../config/env'

const ENDPOINT = 'https://api.openverse.org/v1/images/'

/**
 * Openverse's `thumbnail` proxy serves at most 600px wide and never
 * upscales, so the effective dimensions of the thumbnail we attach are
 * the original's clamped to this width. The API only reports the
 * full-size `width`/`height`, so we clamp them ourselves — otherwise
 * scoring would judge the size of an image we never serve.
 */
const THUMB_WIDTH = 600

const thumbnailDimensions = (
  width?: number,
  height?: number,
): { width?: number; height?: number } => {
  if (!width || width <= THUMB_WIDTH) return { width, height }
  return {
    width: THUMB_WIDTH,
    height: height ? Math.round((height * THUMB_WIDTH) / width) : undefined,
  }
}

/** Openverse reports the license as a short code (e.g. "by-sa") plus a
 * version; render the familiar "CC BY-SA 4.0" form. Public-domain marks
 * are labeled without the "CC" prefix. */
const formatLicense = (code?: string, version?: string): string | undefined => {
  if (!code) return undefined
  const suffix = version ? ` ${version}` : ''
  if (code === 'cc0') return `CC0${suffix}`
  if (code === 'pdm') return 'Public Domain Mark'
  return `CC ${code.toUpperCase()}${suffix}`
}

interface OpenverseResult {
  url?: string
  thumbnail?: string
  title?: string
  creator?: string
  creator_url?: string
  foreign_landing_url?: string
  tags?: Array<{ name?: string }>
  license?: string
  license_version?: string
  license_url?: string
  width?: number
  height?: number
}

export const searchOpenverse = async (
  keywords: string[],
  signal: AbortSignal,
): Promise<ImageCandidate[]> => {
  try {
    const params = new URLSearchParams({
      q: keywords.join(' '),
      page_size: String(env.IMAGE_SOURCE_RESULTS),
    })
    const res = await fetch(`${ENDPOINT}?${params}`, {
      signal,
      headers: { 'User-Agent': BROWSER_USER_AGENT },
    })
    if (!res.ok) return []
    const data = (await res.json()) as { results?: OpenverseResult[] }

    return (data.results ?? []).flatMap(item => {
      const url = item.thumbnail ?? item.url
      if (!url) return []
      // Report dimensions that match the URL we attach: the clamped
      // thumbnail size when serving the thumbnail, the full size only
      // when falling back to the original.
      const { width, height } = item.thumbnail
        ? thumbnailDimensions(item.width, item.height)
        : { width: item.width, height: item.height }
      const title = item.title ?? ''
      const attribution: ImageAttribution = {
        title: title || undefined,
        creator: item.creator,
        creatorUrl: item.creator_url,
        sourceUrl: item.foreign_landing_url,
        sourceName: 'Openverse',
        license: formatLicense(item.license, item.license_version),
        licenseUrl: item.license_url,
      }
      return [
        {
          url,
          title,
          tags: (item.tags ?? []).map(t => t.name ?? '').filter(Boolean),
          source: 'openverse' as const,
          width,
          height,
          attribution,
        },
      ]
    })
  } catch {
    return []
  }
}
