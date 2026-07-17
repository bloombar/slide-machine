/**
 * Flickr image search — active only when FLICKR_API_KEY is configured.
 * Any failure (or no key) returns []; the pipeline never notices (IMG-2).
 */
import { env } from '../config/env'
import type { ImageCandidate } from './types'

const ENDPOINT = 'https://api.flickr.com/services/rest/'

interface FlickrPhoto {
  id?: string
  owner?: string
  title?: string
  tags?: string
  url_c?: string
  width_c?: number
  height_c?: number
  ownername?: string
}

export const searchFlickr = async (
  keywords: string[],
  signal: AbortSignal,
): Promise<ImageCandidate[]> => {
  if (!env.FLICKR_API_KEY) return []
  try {
    const params = new URLSearchParams({
      method: 'flickr.photos.search',
      api_key: env.FLICKR_API_KEY,
      text: keywords.join(' '),
      format: 'json',
      nojsoncallback: '1',
      per_page: '8',
      content_type: '1',
      sort: 'relevance',
      license: '1,2,3,4,5,6,9,10',
      extras: 'url_c,tags,owner_name',
    })
    const res = await fetch(`${ENDPOINT}?${params}`, { signal })
    if (!res.ok) return []
    const data = (await res.json()) as { photos?: { photo?: FlickrPhoto[] } }

    return (data.photos?.photo ?? []).flatMap(photo => {
      if (!photo.url_c) return []
      return [
        {
          url: photo.url_c,
          title: photo.title ?? '',
          tags: (photo.tags ?? '').split(/\s+/).filter(Boolean),
          source: 'flickr' as const,
          width: photo.width_c,
          height: photo.height_c,
          attribution: photo.ownername
            ? `${photo.ownername} (Flickr)`
            : 'Flickr',
          sourceUrl:
            photo.owner && photo.id
              ? `https://www.flickr.com/photos/${photo.owner}/${photo.id}`
              : undefined,
        },
      ]
    })
  } catch {
    return []
  }
}
