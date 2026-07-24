/**
 * Compact deck-structure context for live generation (options A+B): a running
 * outline of the deck's heading (title/section) slides plus positional signals,
 * so the windowed model can judge title/section decisions from the deck's shape
 * without being sent every slide. Pure and DB-free so it unit-tests directly;
 * the caller supplies the heading slides and the deck's slide order.
 */
import type {
  LayoutDescriptor,
  LayoutType,
  SlideGenerationRequest,
} from '@slide-machine/shared'
import { isHeaderLayout } from './layout-refit'

export type DeckStructure = NonNullable<SlideGenerationRequest['deckStructure']>

/** The template's heading layout types (title/section) — those with no body,
 * bullets, or image slot. Derived from the descriptors so custom templates with
 * differently-named heading layouts work automatically. */
export const headerLayoutTypes = (
  descriptors: LayoutDescriptor[],
): LayoutType[] =>
  descriptors.filter(d => isHeaderLayout(d.type, descriptors)).map(d => d.type)

/**
 * Builds the outline + signals from the deck's heading slides and its slide
 * order. `headings` may be unordered; each slide's position comes from
 * `slideOrder` (the authoritative order), so reordering is handled and a
 * heading not present in the order is dropped. `slidesSinceHeader` counts the
 * slides after the last heading; `hasTitleSlide` means the deck opens with a
 * heading (position 0).
 */
export const buildDeckStructure = (
  headings: { id: string; layoutType: LayoutType; title?: string }[],
  slideOrder: string[],
): DeckStructure => {
  const placed = headings
    .map(h => ({
      layoutType: h.layoutType,
      title: h.title ?? '',
      pos: slideOrder.indexOf(h.id),
    }))
    .filter(h => h.pos >= 0)
    .sort((a, b) => a.pos - b.pos)
  const lastPos = placed.length ? placed[placed.length - 1]!.pos : -1
  return {
    totalSlides: slideOrder.length,
    slidesSinceHeader:
      lastPos >= 0 ? slideOrder.length - 1 - lastPos : slideOrder.length,
    hasTitleSlide: placed.some(h => h.pos === 0),
    outline: placed.map(h => ({
      position: h.pos + 1,
      layoutType: h.layoutType,
      title: h.title,
    })),
  }
}
