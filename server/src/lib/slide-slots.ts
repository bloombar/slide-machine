/**
 * The slide slot map (docs/plans/extensible-templates-plan.md, Phase 1).
 *
 * A slide's content is a map keyed by the slot names its layout declares, so a
 * layout with three code samples and two images is representable — which the
 * five fixed fields (`title`, `body`, `bullets`, `caption`, `imageRef`) never
 * could be.
 *
 * The map is the store; the five fields are DERIVED from it by conventional
 * name. That is the migration lever: the many readers written against those
 * fields — deck-structure, rolling context, quiz generation, speakable text,
 * the text index — keep working unchanged while storage moves underneath.
 * Documents written before the map existed are normalized from their fields on
 * read, the same way `toAttributionDto` tolerates legacy attribution.
 */
import { z } from 'zod'
import type {
  ImageAttribution,
  ImageSource,
  SlotValue,
} from '@slide-machine/shared'

/** A ceiling on how many track sizes a table may carry. A table with more
 * columns than this is not a table anyone reads, and the bound keeps a stored
 * slot from growing without limit. */
const MAX_TRACKS = 64

const attributionSchema = z.object({
  caption: z.string().optional(),
  title: z.string().optional(),
  creator: z.string().optional(),
  creatorUrl: z.string().optional(),
  sourceUrl: z.string().optional(),
  sourceName: z.string().optional(),
  license: z.string().optional(),
  licenseUrl: z.string().optional(),
})

/**
 * One slot's content on the wire, validated by kind. The kind is explicit
 * rather than inferred so a text slot can never be mistaken for a caption-less
 * image, and so a new kind is a new branch here rather than a guess.
 */
export const slotValueSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.union([z.literal('text'), z.literal('preformatted')]),
    value: z.string(),
  }),
  z.object({ kind: z.literal('bullets'), items: z.array(z.string()) }),
  z.object({
    kind: z.literal('image'),
    ref: z.string().optional(),
    source: z.enum(['seeded', 'stock', 'generated']).optional(),
    keywords: z.array(z.string()).optional(),
    attribution: attributionSchema.optional(),
  }),
  z.object({
    kind: z.literal('code'),
    source: z.string(),
    language: z.string().max(40).optional(),
  }),
  z.object({
    kind: z.literal('math'),
    tex: z.string(),
    display: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('table'),
    header: z.array(z.string()).optional(),
    rows: z.array(z.array(z.string())),
    // How the table divides its box (EDIT-7). Fractions of its own width and
    // height, so the same table draws in proportion on screen, in a PDF and in
    // a PowerPoint. Bounded, but not required to be the right length or to sum
    // to one: `tableTracks` normalises on the way out, so a list left stale by
    // an added column is drawn rather than rejected.
    colWidths: z.array(z.number().positive().max(1)).max(MAX_TRACKS).optional(),
    rowHeights: z
      .array(z.number().positive().max(1))
      .max(MAX_TRACKS)
      .optional(),
  }),
])

/** What a slide's five conventional fields hold, derived from the map. */
export interface LegacyContent {
  title?: string
  body?: string
  bullets?: string[]
  caption?: string
  imageRef?: string
  imageSource?: ImageSource
  imageKeywords?: string[]
  attribution?: ImageAttribution
}

/** A document (or plain object) carrying the legacy fields and maybe a map. */
interface SlideLike extends LegacyContent {
  slots?: Record<string, SlotValue> | null
}

/** True when the value is a usable slot map rather than an empty/absent one. */
const hasMap = (slots: unknown): slots is Record<string, SlotValue> =>
  Boolean(slots) && typeof slots === 'object' && Object.keys(slots!).length > 0

/**
 * The slot map for a slide, synthesized from the conventional fields when the
 * slide predates the map. Only slots that actually hold something appear, so
 * an empty slide has an empty map rather than five blank entries.
 */
export const slotsOf = (slide: SlideLike): Record<string, SlotValue> => {
  if (hasMap(slide.slots)) return slide.slots
  const map: Record<string, SlotValue> = {}
  if (slide.title) map.title = { kind: 'text', value: slide.title }
  if (slide.body) map.body = { kind: 'text', value: slide.body }
  if (slide.bullets?.length)
    map.bullets = { kind: 'bullets', items: slide.bullets }
  if (slide.caption) map.caption = { kind: 'text', value: slide.caption }
  if (slide.imageRef || slide.attribution || slide.imageKeywords?.length) {
    map.image = {
      kind: 'image',
      ref: slide.imageRef,
      source: slide.imageSource,
      keywords: slide.imageKeywords,
      attribution: slide.attribution,
    }
  }
  return map
}

/** The text a slot holds, or undefined when it holds something else. */
const textOf = (value: SlotValue | undefined): string | undefined =>
  value && (value.kind === 'text' || value.kind === 'preformatted')
    ? value.value
    : undefined

/**
 * The five conventional fields, read out of the map. Every reader written
 * against `slide.title` keeps working because of this.
 */
export const legacyFrom = (slots: Record<string, SlotValue>): LegacyContent => {
  const image = slots.image?.kind === 'image' ? slots.image : undefined
  const bullets = slots.bullets?.kind === 'bullets' ? slots.bullets : undefined
  return {
    title: textOf(slots.title),
    body: textOf(slots.body),
    bullets: bullets?.items,
    caption: textOf(slots.caption),
    imageRef: image?.ref,
    imageSource: image?.source,
    imageKeywords: image?.keywords,
    attribution: image?.attribution,
  }
}

/** Folds a write to the conventional fields back into the map, so code that
 * still assigns `slide.title` keeps working while the map stays the store. */
export const foldLegacy = (
  slots: Record<string, SlotValue>,
  legacy: LegacyContent,
  changed: (field: keyof LegacyContent) => boolean,
): Record<string, SlotValue> => {
  const next = { ...slots }
  /**
   * Whether a legacy field has any business clearing this box.
   *
   * `title`, `body` and `caption` can only ever say "some prose" — they
   * predate the specialized kinds (TMPL-9). A box named `body` that now holds
   * a program listing is not something an empty `body` field has an opinion
   * about, and deleting it because that field is empty throws away content the
   * legacy shape cannot even express.
   */
  const legacyCanClear = (name: string): boolean => {
    const kind = next[name]?.kind
    return kind === undefined || kind === 'text' || kind === 'bullets'
  }
  const setText = (name: string, value: string | undefined) => {
    if (value) next[name] = { kind: 'text', value }
    else if (legacyCanClear(name)) delete next[name]
  }
  if (changed('title')) setText('title', legacy.title)
  if (changed('body')) setText('body', legacy.body)
  if (changed('caption')) setText('caption', legacy.caption)
  if (changed('bullets')) {
    if (legacy.bullets?.length)
      next.bullets = { kind: 'bullets', items: legacy.bullets }
    else if (legacyCanClear('bullets')) delete next.bullets
  }
  const imageChanged =
    changed('imageRef') ||
    changed('imageSource') ||
    changed('imageKeywords') ||
    changed('attribution')
  if (imageChanged) {
    const current = next.image?.kind === 'image' ? next.image : undefined
    const value = {
      kind: 'image' as const,
      ref: changed('imageRef') ? legacy.imageRef : current?.ref,
      source: changed('imageSource') ? legacy.imageSource : current?.source,
      keywords: changed('imageKeywords')
        ? legacy.imageKeywords
        : current?.keywords,
      attribution: changed('attribution')
        ? legacy.attribution
        : current?.attribution,
    }
    // An image slot with nothing in it at all is not a slot the slide holds
    if (value.ref || value.attribution || value.keywords?.length)
      next.image = value
    else delete next.image
  }
  return next
}

/**
 * Moves a slide's content onto another layout's boxes (GEN-9).
 *
 * `pairs` comes from `pairSlots` in shared, so the content lands exactly
 * where the transition animation says it landed. A box that paired keeps its
 * value; a box that did not is left where it is rather than deleted, for two
 * reasons: the refit pass reads it as the source for the holes it fills, and
 * switching back to the old layout finds its own content still there. Slots
 * the current layout does not declare are simply never drawn.
 */
export const remapSlots = (
  slots: Record<string, SlotValue>,
  pairs: Record<string, string>,
): Record<string, SlotValue> => {
  const next = { ...slots }
  for (const [from, to] of Object.entries(pairs)) {
    if (from === to) continue
    const value = slots[from]
    if (value === undefined) continue
    next[to] = value
  }
  return next
}

/** Applies one slot's patch. An empty value takes the slot back to empty. */
export const patchSlot = (
  slots: Record<string, SlotValue>,
  name: string,
  value: SlotValue,
): Record<string, SlotValue> => {
  const next = { ...slots }
  if (value.kind === 'image') {
    const current = next[name]?.kind === 'image' ? next[name] : undefined
    // Merged, so setting a picture does not drop the credit beside it
    next[name] = { ...current, ...value, kind: 'image' }
    return next
  }
  next[name] = value
  return next
}
