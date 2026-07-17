/**
 * Image/layout reconciliation (GEN-6/GEN-7). The model chooses a layout
 * and image guidance independently, so it can ask for a photo on a layout
 * that has nowhere to show one. We never let that stand: an image fetched
 * for a layout with no `image` slot would be stored and rendered
 * invisibly — wasted enrichment and orphaned data on the slide.
 *
 * When a slide has image intent but its layout has no `image` slot, we
 * UPGRADE it to an image-capable layout that still displays every
 * populated content slot. If none can (e.g. the content has bullets and
 * no image layout offers a bullets slot), we DROP the image intent, so
 * nothing is enriched and no orphaned image is stored.
 */
import type {
  ImageGuidance,
  LayoutDescriptor,
  SlideGenerationResult,
} from '@slide-machine/shared'

const IMAGE_SLOT = 'image'

const slotNames = (
  type: string,
  descriptors: LayoutDescriptor[],
): Set<string> =>
  new Set(descriptors.find(d => d.type === type)?.slots.map(s => s.name) ?? [])

/** True when a layout type exposes an image slot the client can render. */
export const layoutHasImageSlot = (
  type: string,
  descriptors: LayoutDescriptor[],
): boolean => slotNames(type, descriptors).has(IMAGE_SLOT)

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
    .filter(d => d.slots.some(s => s.name === IMAGE_SLOT))
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
