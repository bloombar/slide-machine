/**
 * Openverse image search (keyless, CC-licensed aggregate incl. Flickr).
 * Any failure returns [] — enrichment never breaks the pipeline (IMG-2).
 */
import type { ImageCandidate } from './types'

const ENDPOINT = 'https://api.openverse.org/v1/images/'

interface OpenverseResult {
  url?: string
  thumbnail?: string
  title?: string
  tags?: Array<{ name?: string }>
  license?: string
  attribution?: string
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
      page_size: '8',
    })
    const res = await fetch(`${ENDPOINT}?${params}`, { signal })
    if (!res.ok) return []
    const data = (await res.json()) as { results?: OpenverseResult[] }

    return (data.results ?? []).flatMap(item => {
      const url = item.thumbnail ?? item.url
      if (!url) return []
      return [
        {
          url,
          title: item.title ?? '',
          tags: (item.tags ?? []).map(t => t.name ?? '').filter(Boolean),
          source: 'openverse' as const,
          width: item.width,
          height: item.height,
          license: item.license,
          attribution: item.attribution,
        },
      ]
    })
  } catch {
    return []
  }
}
