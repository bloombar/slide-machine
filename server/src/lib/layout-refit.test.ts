/**
 * Unit tests for layout re-fit validation (GEN-8): delta switches may
 * not hide displayed slots, and full refits must demonstrably carry
 * hidden content into the new layout's slots.
 */
import { describe, it, expect } from 'vitest'
import type { SlideGenerationResult } from '@slide-machine/shared'
import { listBuiltinTemplates, layoutDescriptors } from '../templates/builtin'
import {
  layoutDisplaysContent,
  isHeaderLayout,
  refitPreservesContent,
  safeLayoutType,
  type SlideContentSnapshot,
} from './layout-refit'
import { refitOverflows } from './slide-fit'

const descriptors = layoutDescriptors(listBuiltinTemplates()[0]!)

const contentSlide: SlideContentSnapshot = {
  title: 'Cell Membrane Structure',
  body: 'The membrane is a phospholipid bilayer with embedded proteins',
}

const refit = (
  overrides: Partial<SlideGenerationResult>,
): SlideGenerationResult => ({
  action: 'update',
  updateMode: 'refit',
  layoutType: 'list',
  slots: {},
  ...overrides,
})

describe('layoutDisplaysContent (delta layout switches)', () => {
  it('allows switches whose target renders every populated slot', () => {
    // content (title+body) → two-column (title+body+image): safe
    expect(layoutDisplaysContent('two-column', contentSlide, descriptors)).toBe(
      true,
    )
  })

  it('rejects switches that would hide populated slots', () => {
    // content (title+body) → list (title+bullets): body would vanish
    expect(layoutDisplaysContent('list', contentSlide, descriptors)).toBe(false)
    // a slide with an image cannot move to an imageless layout
    expect(
      layoutDisplaysContent(
        'content',
        { title: 'T', body: 'B', hasImage: true },
        descriptors,
      ),
    ).toBe(false)
  })

  it('identifies header layouts (title/section) with no body/bullets/image', () => {
    expect(isHeaderLayout('title', descriptors)).toBe(true)
    expect(isHeaderLayout('section', descriptors)).toBe(true)
    // Anything that can hold real content is not a header.
    expect(isHeaderLayout('content', descriptors)).toBe(false)
    expect(isHeaderLayout('list', descriptors)).toBe(false)
    expect(isHeaderLayout('image-heavy', descriptors)).toBe(false)
    // Unknown layouts are not headers.
    expect(isHeaderLayout('hologram', descriptors)).toBe(false)
  })

  it('rejects unknown layout types', () => {
    expect(layoutDisplaysContent('hologram', contentSlide, descriptors)).toBe(
      false,
    )
  })
})

describe('safeLayoutType (never persist a non-selectable layout)', () => {
  it('keeps a layout that is in the pickable set', () => {
    expect(safeLayoutType('list', descriptors, 'content')).toBe('list')
  })

  it('coerces the non-selectable whiteboard layout to the current slide layout', () => {
    // The bug: model echoed the current slide's own "whiteboard" layout.
    expect(safeLayoutType('whiteboard', descriptors, 'list')).toBe('list')
  })

  it('falls back to content when neither candidate nor current is selectable', () => {
    // e.g. an update whose current slide is itself the whiteboard canvas.
    expect(safeLayoutType('whiteboard', descriptors, 'whiteboard')).toBe(
      'content',
    )
    // No current slide (a "new" action): a bad layout still coerces to content.
    expect(safeLayoutType('hologram', descriptors)).toBe('content')
  })

  it('falls back to the first offered layout when there is no content layout', () => {
    const noContent = descriptors.filter(d => d.type !== 'content')
    expect(safeLayoutType('whiteboard', noContent)).toBe(noContent[0]!.type)
  })
})

describe('refitPreservesContent (full refits)', () => {
  it('accepts a refit that migrates hidden body text into bullets', () => {
    const result = refit({
      slots: {
        title: 'Cell Membrane Structure',
        bullets: [
          'Phospholipid bilayer with embedded proteins',
          'Contains cholesterol and glycolipids',
        ],
      },
    })
    expect(refitPreservesContent(result, contentSlide, descriptors)).toBe(true)
  })

  it('rejects a refit that drops the hidden content', () => {
    const result = refit({
      slots: {
        title: 'Cell Membrane Structure',
        bullets: ['Cholesterol', 'Glycolipids'], // body never migrated
      },
    })
    expect(refitPreservesContent(result, contentSlide, descriptors)).toBe(false)
  })

  it('rejects a refit that empties a displayed slot', () => {
    // list renders the title; the refit "lost" it
    const result = refit({
      slots: { bullets: ['Phospholipid bilayer with embedded proteins'] },
    })
    expect(refitPreservesContent(result, contentSlide, descriptors)).toBe(false)
  })

  it('never hides an existing image', () => {
    const withImage = { ...contentSlide, hasImage: true }
    const result = refit({
      layoutType: 'list', // no image slot
      slots: {
        title: 'Cell Membrane Structure',
        bullets: ['Phospholipid bilayer with embedded proteins'],
      },
    })
    expect(refitPreservesContent(result, withImage, descriptors)).toBe(false)
  })

  it('accepts same-slot refits without migration checks', () => {
    // content → content rewrite: displayed slots stay populated, done
    const result = refit({
      layoutType: 'content',
      slots: {
        title: 'Cell Membrane Structure',
        body: 'The membrane is a phospholipid bilayer with embedded proteins and cholesterol',
      },
    })
    expect(refitPreservesContent(result, contentSlide, descriptors)).toBe(true)
  })

  it('rejects unknown target layouts', () => {
    const result = refit({ layoutType: 'hologram' as never })
    expect(refitPreservesContent(result, contentSlide, descriptors)).toBe(false)
  })
})

describe('refitOverflows', () => {
  it('accepts refits within the target budget and rejects overstuffed ones', () => {
    const within = refit({
      slots: { title: 'T', bullets: ['a', 'b', 'c'] },
    })
    expect(refitOverflows(within, descriptors)).toBe(false)

    const over = refit({
      slots: {
        title: 'T',
        bullets: Array.from({ length: 12 }, (_, i) => `b${i}`),
      },
    })
    expect(refitOverflows(over, descriptors)).toBe(true)
  })
})
