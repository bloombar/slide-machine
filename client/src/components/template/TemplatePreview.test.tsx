/**
 * Unit tests for the design preview's stand-in pictures (TMPL-4).
 *
 * `sampleSlide` decides what goes in each box and is tested on its own; what
 * is proved here is the thing only the component knows — where in the shared
 * run of pictures a layout starts. Every layout began at the first one, so
 * flicking between tabs showed the same photographs over and over: distinct
 * within a slide, repeated across the design.
 *
 * Tested through the component rather than through `sampleSlide`, because the
 * offset is the component's to work out, and a test below it would pass just
 * as well with the wiring missing.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import type { Layout, Template } from '@slide-machine/shared'
import TemplatePreview from './TemplatePreview'

/** A layout holding `count` picture boxes and nothing else. */
const withPictures = (type: string, count = 1): Layout =>
  ({
    type,
    label: type,
    purpose: `use for ${type}`,
    slots: Array.from({ length: count }, (_, i) => ({
      name: `picture${i}`,
      kind: 'image',
      label: `Picture ${i}`,
    })),
    tree: {
      id: 'root',
      container: { mode: 'flex', direction: 'column', gap: 3 },
      children: Array.from({ length: count }, (_, i) => ({
        id: `picture${i}`,
        slot: `picture${i}`,
      })),
    },
    elementPositions: {},
  }) as Layout

const template = (layouts: Layout[]): Template => ({
  id: 't1',
  permalinkSlug: 't1',
  ownerId: 'u1',
  name: 'A design',
  theme: { background: '#ffffff', text: '#000000', accent: '#ff0000' },
  layouts,
  visibility: 'private',
  voteScore: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
})

const pool = Array.from({ length: 8 }, (_, i) => `http://img/${i}.jpg`)

/** Every picture the preview draws for one layout, however it draws it. */
const picturesIn = (tpl: Template, layout: Layout): string[] => {
  const { container, unmount } = render(
    <TemplatePreview template={tpl} layout={layout} images={pool} />,
  )
  const found = [
    ...Array.from(container.querySelectorAll('img'), img =>
      img.getAttribute('src'),
    ),
    ...Array.from(container.querySelectorAll<HTMLElement>('*'), el =>
      el.style?.backgroundImage && el.style.backgroundImage !== 'none'
        ? el.style.backgroundImage
        : null,
    ),
  ].filter((src): src is string => Boolean(src))
  unmount()
  return found
}

describe('the pictures a design previews with', () => {
  it('gives two layouts two different pictures', () => {
    const layouts = [withPictures('two-column'), withPictures('image-heavy')]
    const tpl = template(layouts)
    const first = picturesIn(tpl, layouts[0]!)
    const second = picturesIn(tpl, layouts[1]!)
    expect(first).not.toEqual(second)
  })

  it('carries the run on past every box that came before', () => {
    // The third layout starts after the first two have taken three between
    // them, not back at the beginning.
    const layouts = [
      withPictures('a', 2),
      withPictures('b', 1),
      withPictures('c', 1),
    ]
    const tpl = template(layouts)
    const drawn = layouts.flatMap(l => picturesIn(tpl, l))
    expect(new Set(drawn).size).toBe(drawn.length)
  })

  it('draws nothing when no picture came back', () => {
    const layouts = [withPictures('a')]
    const { container } = render(
      <TemplatePreview template={template(layouts)} layout={layouts[0]!} />,
    )
    expect(container.querySelectorAll('img')).toHaveLength(0)
  })
})
