/**
 * Image/layout reconciliation (GEN-6/GEN-7). The model chooses a layout
 * and image guidance independently, so it can ask for a photo on a layout
 * that has nowhere to show one. We never let that stand: an image fetched
 * for a layout with no image slot would be stored and rendered
 * invisibly — wasted enrichment and orphaned data on the slide.
 *
 * When a slide has image intent but its layout has no image slot, we
 * UPGRADE it to an image-capable layout that still displays every
 * populated content slot. If none can (e.g. the content has bullets and
 * no image layout offers a bullets slot), we DROP the image intent, so
 * nothing is enriched and no orphaned image is stored.
 *
 * A slot holds a picture because its KIND says so, not because it is called
 * `image`: a template author names their own slots (TMPL-9), so a layout with
 * `photo-left` and `photo-right` is image-capable and must not be swapped out
 * from under them.
 */
import type {
  ImageGuidance,
  LayoutDescriptor,
  SlideGenerationResult,
} from '@slide-machine/shared'

/** Every slot of a layout that holds a picture, whatever the author named it. */
const imageSlots = (descriptor: LayoutDescriptor | undefined): string[] =>
  descriptor?.slots.filter(s => s.kind === 'image').map(s => s.name) ?? []

/**
 * Whether one picture box on a slide already holds something.
 *
 * Reads the slot map, and falls back to the legacy top-level `imageRef` for
 * the conventional `image` box — slides saved before content moved into the
 * map still keep their picture there, and treating those as empty would
 * source a second picture over one the slide already shows.
 */
export const slotHasImage = (
  slide: { slots?: Record<string, unknown>; imageRef?: string | null },
  name: string,
): boolean => {
  const value = slide.slots?.[name] as { ref?: string } | undefined
  if (value?.ref) return true
  return name === 'image' && Boolean(slide.imageRef)
}

/** The image slots of one layout type, in declaration order (IMG-6). */
export const imageSlotNames = (
  type: string,
  descriptors: LayoutDescriptor[],
): string[] => imageSlots(descriptors.find(d => d.type === type))

/** True when a layout type exposes an image slot the client can render. */
export const layoutHasImageSlot = (
  type: string,
  descriptors: LayoutDescriptor[],
): boolean => imageSlots(descriptors.find(d => d.type === type)).length > 0

/** The model wants an image on this slide — keywords to search or a
 * specific seeded image — and it isn't an explicit text-only slide. */
const hasImageIntent = (guidance: ImageGuidance | undefined): boolean =>
  !!guidance &&
  !guidance.none &&
  ((guidance.keywords?.length ?? 0) > 0 || Boolean(guidance.seededImageId))

/** The content slots the result actually fills, by name. */
const populatedSlots = (slots: SlideGenerationResult['slots']): Set<string> => {
  const names = new Set<string>()
  if (slots.title?.trim()) names.add('title')
  if (slots.body?.trim()) names.add('body')
  if (slots.bullets?.length) names.add('bullets')
  if (slots.caption?.trim()) names.add('caption')
  return names
}

/**
 * Reconciles a generation result whose image guidance and layout
 * disagree (see file header). No-op when there is no image intent or the
 * chosen layout already has an image slot.
 */
export const reconcileImageLayout = (
  result: SlideGenerationResult,
  descriptors: LayoutDescriptor[],
): SlideGenerationResult => {
  if (!hasImageIntent(result.imageGuidance)) return result
  if (layoutHasImageSlot(result.layoutType, descriptors)) return result

  const needed = populatedSlots(result.slots)
  // Prefer the tightest image-capable layout that strands no content:
  // one whose slots cover every populated slot; fewest slots wins.
  const upgrade = descriptors
    .filter(d => imageSlots(d).length > 0)
    .filter(d => {
      const names = new Set(d.slots.map(s => s.name))
      return [...needed].every(name => names.has(name))
    })
    .sort((a, b) => a.slots.length - b.slots.length)[0]

  if (upgrade) return { ...result, layoutType: upgrade.type }
  // No image layout can hold this content: abandon the image rather than
  // strand a content slot or store an invisible image.
  return { ...result, imageGuidance: undefined }
}
