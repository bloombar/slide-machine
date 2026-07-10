/**
 * Permalink slug generation (SHARE-1): readable prefix from the title
 * plus a random suffix for uniqueness.
 */
import { randomBytes } from 'node:crypto'

export const permalinkSlug = (title: string): string => {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'deck'
  return `${base}-${randomBytes(4).toString('hex')}`
}
