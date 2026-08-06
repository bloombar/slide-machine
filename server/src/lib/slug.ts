/**
 * Permalink slug generation (SHARE-1): readable prefix from the title
 * plus a random suffix for uniqueness.
 */
import { randomBytes } from 'node:crypto'

/**
 * A slug for `title`. `fallback` names what is being addressed when the title
 * has nothing sluggable in it — an untitled lecture, a template named only in
 * a script that has no Latin letters.
 */
export const permalinkSlug = (title: string, fallback = 'deck'): string => {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || fallback
  return `${base}-${randomBytes(4).toString('hex')}`
}
