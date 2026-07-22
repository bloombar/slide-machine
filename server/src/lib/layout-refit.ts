/**
 * Layout re-fit validation (GEN-8 "re-fit the layout on update",
 * GENERATION_LAYOUT_REFIT). The model may switch an updated slide's
 * layout, but is never trusted with the audience's content: a switch
 * must not make committed content vanish from the displayed slide.
 *
 * Two levels of scrutiny:
 * - delta updates may switch layout only when the new layout still
 *   DISPLAYS every slot the slide already uses (layoutDisplaysContent)
 * - full refits (complete re-mapped slots) must keep every displayed
 *   slot populated and demonstrably carry over content the new layout
 *   hides (refitPreservesContent)
 */
import type {
  LayoutDescriptor,
  LayoutType,
  SlideGenerationResult,
} from '@slide-machine/shared'

/** What the current slide holds, for coverage/preservation checks. */
export interface SlideContentSnapshot {
  title?: string
  body?: string
  bullets?: string[]
  caption?: string
  hasImage?: boolean
}

const slotNames = (
  type: LayoutType | string,
  descriptors: LayoutDescriptor[],
): Set<string> =>
  new Set(descriptors.find(d => d.type === type)?.slots.map(s => s.name) ?? [])

/**
 * True when the layout type renders every populated slot of the slide —
 * the requirement for switching layout on a plain delta update.
 */
export const layoutDisplaysContent = (
  type: LayoutType | string,
  current: SlideContentSnapshot,
  descriptors: LayoutDescriptor[],
): boolean => {
  const names = slotNames(type, descriptors)
  if (names.size === 0) return false
  if (current.title && !names.has('title')) return false
  if (current.body && !names.has('body')) return false
  if (current.bullets?.length && !names.has('bullets')) return false
  if (current.caption && !names.has('caption')) return false
  if (current.hasImage && !names.has('image')) return false
  return true
}

/**
 * A "header" layout introduces rather than accumulates: it has a title (and
 * maybe a caption) but no body, bullets, or image slot — the title and section
 * layouts. Real content the model tries to add to one can't be displayed, so
 * it belongs on a NEW slide rather than folded in invisibly.
 */
export const isHeaderLayout = (
  type: LayoutType | string,
  descriptors: LayoutDescriptor[],
): boolean => {
  const names = slotNames(type, descriptors)
  return (
    names.size > 0 &&
    !names.has('body') &&
    !names.has('bullets') &&
    !names.has('image')
  )
}

/** Words that carry meaning, for the migration-overlap heuristic. */
const significantWords = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4)

/**
 * True when a full refit plausibly preserves the slide's content:
 * - the target layout is a known one
 * - an existing image is never hidden (its slot must survive)
 * - every populated slot the new layout DISPLAYS stays populated
 * - content the new layout HIDES (e.g. body on a list layout) must
 *   reappear in the refit's slots — at least half its significant
 *   words, a cheap proxy for "the model actually migrated it"
 *
 * Old slot data is retained on the document either way; this guards
 * what the audience sees, not what the database keeps.
 */
export const refitPreservesContent = (
  result: SlideGenerationResult,
  current: SlideContentSnapshot,
  descriptors: LayoutDescriptor[],
): boolean => {
  const names = slotNames(result.layoutType, descriptors)
  if (names.size === 0) return false
  if (current.hasImage && !names.has('image')) return false

  const textSlots: Array<[string, string | undefined]> = [
    ['title', current.title],
    ['body', current.body],
    [
      'bullets',
      current.bullets?.length ? current.bullets.join(' ') : undefined,
    ],
    ['caption', current.caption],
  ]
  const resultSlotText = (name: string): string | undefined => {
    if (name === 'title') return result.slots.title
    if (name === 'body') return result.slots.body
    if (name === 'bullets') return result.slots.bullets?.join(' ')
    if (name === 'caption') return result.slots.caption
    return undefined
  }

  const hidden: string[] = []
  for (const [name, text] of textSlots) {
    if (!text) continue
    if (names.has(name)) {
      // Displayed by the new layout: must not come back empty
      if (!resultSlotText(name)?.trim()) return false
    } else {
      hidden.push(text)
    }
  }
  if (!hidden.length) return true

  // Hidden content must have migrated somewhere visible
  const migrated = new Set(
    significantWords(
      [result.slots.title, result.slots.body, result.slots.caption]
        .concat(result.slots.bullets ?? [])
        .filter(Boolean)
        .join(' '),
    ),
  )
  const words = significantWords(hidden.join(' '))
  if (!words.length) return true
  const kept = words.filter(w => migrated.has(w)).length
  return kept / words.length >= 0.5
}
