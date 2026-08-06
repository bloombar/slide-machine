/**
 * Pictures to fill the preview's image slots with.
 *
 * Fetched once per editor session and shared by every layout tab, because the
 * server caches the search anyway and a template with several picture boxes
 * should not ask several times. Failure is silent: the preview falls back to
 * the quiet empty block it has always shown, which is a fair picture of a
 * layout even without a picture in it.
 */
import { useEffect, useState } from 'react'
import { dispatchAction } from '../../api/actions'

/** Enough to fill a layout with several picture boxes without repeating. */
const COUNT = 4

/** Shared across mounts, so reopening the editor is instant. */
let cached: Promise<string[]> | undefined

const load = (): Promise<string[]> => {
  cached ??= dispatchAction<{ urls: string[] }>('template.previewImage', {
    count: COUNT,
  })
    .then(r => r.urls)
    .catch(() => [])
  return cached
}

export const usePreviewImages = (): string[] => {
  const [images, setImages] = useState<string[]>([])
  useEffect(() => {
    let live = true
    void load().then(urls => {
      if (live) setImages(urls)
    })
    return () => {
      live = false
    }
  }, [])
  return images
}

/** Test hook: forget the shared fetch. */
export const resetPreviewImages = (): void => {
  cached = undefined
}
