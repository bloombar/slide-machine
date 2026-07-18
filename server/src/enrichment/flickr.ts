/**
 * Flickr image search — active only when FLICKR_API_KEY is configured.
 * Maps Flickr's photo fields and numeric license ids onto the shared
 * ImageAttribution shape (IMG-5). Any failure (or no key) returns []; the
 * pipeline never notices (IMG-2).
 */
import { env } from '../config/env'
import type { ImageAttribution } from '@slide-machine/shared'
import type { ImageCandidate } from './types'
import { BROWSER_USER_AGENT } from './user-agent'

const ENDPOINT = 'https://api.flickr.com/services/rest/'

/**
 * Flickr encodes the license as a numeric id; map each to a human name
 * and its deed URL so stored credit is license-compliant (IMG-5). Ids
 * per the flickr.photos.licenses.getInfo reference. Id 0 (All Rights
 * Reserved) is excluded from the search below, but mapped for safety.
 */
const LICENSES: Record<string, { name: string; url: string }> = {
  '0': { name: 'All Rights Reserved', url: '' },
  '1': {
    name: 'CC BY-NC-SA 2.0',
    url: 'https://creativecommons.org/licenses/by-nc-sa/2.0/',
  },
  '2': {
    name: 'CC BY-NC 2.0',
    url: 'https://creativecommons.org/licenses/by-nc/2.0/',
  },
  '3': {
    name: 'CC BY-NC-ND 2.0',
    url: 'https://creativecommons.org/licenses/by-nc-nd/2.0/',
  },
  '4': {
    name: 'CC BY 2.0',
    url: 'https://creativecommons.org/licenses/by/2.0/',
  },
  '5': {
    name: 'CC BY-SA 2.0',
    url: 'https://creativecommons.org/licenses/by-sa/2.0/',
  },
  '6': {
    name: 'CC BY-ND 2.0',
    url: 'https://creativecommons.org/licenses/by-nd/2.0/',
  },
  '7': {
    name: 'No known copyright restrictions',
    url: 'https://www.flickr.com/commons/usage/',
  },
  '8': {
    name: 'United States Government Work',
    url: 'https://www.usa.gov/government-works',
  },
  '9': {
    name: 'CC0 1.0',
    url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  },
  '10': {
    name: 'Public Domain Mark 1.0',
    url: 'https://creativecommons.org/publicdomain/mark/1.0/',
  },
}

interface FlickrPhoto {
  id?: string
  owner?: string
  title?: string
  tags?: string
  url_c?: string
  width_c?: number
  height_c?: number
  ownername?: string
  license?: string
  description?: { _content?: string }
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
      extras: 'url_c,tags,owner_name,license,description',
    })
    const res = await fetch(`${ENDPOINT}?${params}`, {
      signal,
      headers: { 'User-Agent': BROWSER_USER_AGENT },
    })
    if (!res.ok) return []
    const data = (await res.json()) as { photos?: { photo?: FlickrPhoto[] } }

    return (data.photos?.photo ?? []).flatMap(photo => {
      if (!photo.url_c) return []
      const license = photo.license ? LICENSES[photo.license] : undefined
      // The photo page and owner page are the canonical source/creator
      // links; both need the owner NSID, present on every search result.
      const photoUrl =
        photo.owner && photo.id
          ? `https://www.flickr.com/photos/${photo.owner}/${photo.id}`
          : undefined
      const ownerUrl = photo.owner
        ? `https://www.flickr.com/photos/${photo.owner}/`
        : undefined
      const attribution: ImageAttribution = {
        caption: photo.description?._content || undefined,
        title: photo.title || undefined,
        creator: photo.ownername,
        creatorUrl: ownerUrl,
        sourceUrl: photoUrl,
        sourceName: 'Flickr',
        license: license?.name,
        licenseUrl: license?.url || undefined,
      }
      return [
        {
          url: photo.url_c,
          title: photo.title ?? '',
          tags: (photo.tags ?? '').split(/\s+/).filter(Boolean),
          source: 'flickr' as const,
          width: photo.width_c,
          height: photo.height_c,
          attribution,
        },
      ]
    })
  } catch {
    return []
  }
}
