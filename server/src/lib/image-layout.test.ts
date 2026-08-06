/**
 * Unit tests for image/layout reconciliation: image intent is only kept
 * when the slide's layout can actually show the image, either by
 * upgrading to a fitting image-capable layout or by dropping the intent.
 */
import { describe, it, expect } from 'vitest'
import type {
  LayoutDescriptor,
  SlideGenerationResult,
} from '@slide-machine/shared'
import { layoutHasImageSlot, reconcileImageLayout } from './image-layout'

/** The built-in template's layouts, trimmed to the slots each renders. A
 * slot holds a picture because of its kind, so the conventional `image` name
 * carries `kind: 'image'` here exactly as a real template does. */
const layout = (type: string, slots: string[]): LayoutDescriptor => ({
  type: type as LayoutDescriptor['type'],
  label: type,
  purpose: type,
  slots: slots.map(name => ({
    name,
    kind: name === 'image' ? ('image' as const) : ('text' as const),
    label: name,
  })),
})

/** A layout an author built themselves: two pictures, named their way. */
const authored: LayoutDescriptor = {
  type: 'two-photos' as LayoutDescriptor['type'],
  label: 'Two photos',
  purpose: 'Two pictures side by side',
  slots: [
    { name: 'title', kind: 'text', label: 'Slide title' },
    { name: 'photo-left', kind: 'image', label: 'Photo left' },
    { name: 'photo-right', kind: 'image', label: 'Photo right' },
  ],
}

const DESCRIPTORS: LayoutDescriptor[] = [
  layout('title', ['title', 'caption']),
  layout('section', ['title']),
  layout('content', ['title', 'body']),
  layout('list', ['title', 'bullets']),
  layout('quote', ['body', 'caption']),
  layout('image-heavy', ['image', 'caption']),
  layout('two-column', ['title', 'body', 'image']),
]

const result = (
  overrides: Partial<SlideGenerationResult>,
): SlideGenerationResult => ({
  action: 'new',
  layoutType: 'content',
  slots: {},
  ...overrides,
})

describe('layoutHasImageSlot', () => {
  it('is true only for layouts with an image slot', () => {
    expect(layoutHasImageSlot('two-column', DESCRIPTORS)).toBe(true)
    expect(layoutHasImageSlot('image-heavy', DESCRIPTORS)).toBe(true)
    expect(layoutHasImageSlot('content', DESCRIPTORS)).toBe(false)
    expect(layoutHasImageSlot('list', DESCRIPTORS)).toBe(false)
  })

  it('recognizes an image slot the author named themselves (TMPL-9)', () => {
    // A slot holds a picture because of its kind, not because it is called
    // 'image' — otherwise an author's layout would be swapped out from
    // under them the moment the model asked for a picture.
    expect(layoutHasImageSlot('two-photos', [...DESCRIPTORS, authored])).toBe(
      true,
    )
    expect(layoutHasImageSlot('unknown', DESCRIPTORS)).toBe(false)
  })
})

describe('reconcileImageLayout', () => {
  it('leaves a text-only slide (none) untouched', () => {
    const r = result({
      layoutType: 'content',
      slots: { title: 'T', body: 'B' },
      imageGuidance: { keywords: [], none: true },
    })
    expect(reconcileImageLayout(r, DESCRIPTORS)).toBe(r)
  })

  it('leaves a slide with no image guidance untouched', () => {
    const r = result({ layoutType: 'content', slots: { title: 'T' } })
    expect(reconcileImageLayout(r, DESCRIPTORS)).toBe(r)
  })

  it('leaves an already image-capable layout untouched', () => {
    const r = result({
      layoutType: 'image-heavy',
      slots: { caption: 'C' },
      imageGuidance: { keywords: ['leaf'] },
    })
    expect(reconcileImageLayout(r, DESCRIPTORS)).toBe(r)
  })

  it('upgrades content+keywords to two-column (preserves title/body)', () => {
    const r = result({
      layoutType: 'content',
      slots: { title: 'Photosynthesis', body: 'Light reactions' },
      imageGuidance: { keywords: ['photosynthesis'] },
    })
    const out = reconcileImageLayout(r, DESCRIPTORS)
    expect(out.layoutType).toBe('two-column')
    expect(out.imageGuidance?.keywords).toEqual(['photosynthesis'])
  })

  it('prefers the tightest image layout when several fit', () => {
    // No populated content slots, so both image layouts qualify;
    // image-heavy (2 slots) beats two-column (3 slots).
    const r = result({
      layoutType: 'section',
      slots: {},
      imageGuidance: { keywords: ['aurora'] },
    })
    expect(reconcileImageLayout(r, DESCRIPTORS).layoutType).toBe('image-heavy')
  })

  it('upgrades for a seeded-image intent too', () => {
    const r = result({
      layoutType: 'content',
      slots: { title: 'T', body: 'B' },
      imageGuidance: { keywords: [], seededImageId: 'abc' },
    })
    expect(reconcileImageLayout(r, DESCRIPTORS).layoutType).toBe('two-column')
  })

  it('drops image intent when no image layout can hold the content', () => {
    // bullets have no home in any image-capable built-in layout.
    const r = result({
      layoutType: 'list',
      slots: { title: 'Steps', bullets: ['a', 'b'] },
      imageGuidance: { keywords: ['diagram'] },
    })
    const out = reconcileImageLayout(r, DESCRIPTORS)
    expect(out.layoutType).toBe('list')
    expect(out.imageGuidance).toBeUndefined()
  })
})
