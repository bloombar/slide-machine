/**
 * Unit tests for the arrangement engine (TMPL-4). A template that declares
 * `renderMode: 'positioned'` is drawn from its boxes — one renderer, any
 * arrangement — while one that declares nothing keeps its hand-tuned
 * components, which is what every built-in relies on.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Layout, Slide, Template } from '@slide-machine/shared'
import SlideView from '../../SlideView'
import { rendererFor, getLayoutRenderer } from './index'
import PositionedLayout from './PositionedLayout'

const layout = (over: Partial<Layout> = {}): Layout =>
  ({
    type: 'content',
    label: 'Content',
    purpose: 'body text',
    slots: [
      { name: 'title', kind: 'text', label: 'Slide title' },
      { name: 'body', kind: 'text', label: 'Slide body', multiline: true },
    ],
    elementPositions: {},
    ...over,
  }) as Layout

// Boxes are fractions of the slide, 0-1 (docs/TEMPLATES.md §4)
const arranged = layout({
  elementPositions: {
    title: { x: 0.1, y: 0.05, w: 0.8, h: 0.2 },
    body: { x: 0.1, y: 0.3, w: 0.8, h: 0.6 },
  },
})

const template = (
  l: Layout,
  renderMode?: Template['renderMode'],
): Template => ({
  id: 't1',
  ownerId: 'u1',
  name: 'Mine',
  renderMode,
  theme: { background: '#ffffff', text: '#111111' },
  layouts: [l],
  visibility: 'private',
  voteScore: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
})

const slide: Slide = {
  id: 's1',
  deckId: 'd1',
  index: 0,
  layoutType: 'content',
  slots: {},
  title: 'A title',
  body: 'Some body text',
}

describe('choosing a renderer', () => {
  it('uses the engine when the template asks to be positioned', () => {
    expect(rendererFor('content', 'positioned', arranged)).toBe(
      PositionedLayout,
    )
  })

  it('keeps the hand-tuned component when the template declares nothing', () => {
    expect(rendererFor('content', undefined, arranged)).toBe(
      getLayoutRenderer('content'),
    )
  })

  it('keeps the hand-tuned component in components mode', () => {
    expect(rendererFor('content', 'components', arranged)).toBe(
      getLayoutRenderer('content'),
    )
  })

  it('keeps the hand-tuned component for a layout nobody arranged yet', () => {
    // Positioned mode plus no boxes would be an empty slide
    expect(rendererFor('content', 'positioned', layout())).toBe(
      getLayoutRenderer('content'),
    )
  })
})

describe('PositionedLayout', () => {
  const slotOf = (name: string) => <span>{`slot:${name}`}</span>

  it('places each positioned slot at its own box', () => {
    const { container } = render(
      <PositionedLayout
        slide={slide}
        colors={{} as never}
        layout={arranged}
        slot={slotOf as never}
      />,
    )
    const boxes = container.querySelectorAll('div[style]')
    expect(boxes).toHaveLength(2)
    expect(boxes[0]).toHaveStyle({ left: '10%', top: '5%', width: '80%' })
    expect(boxes[1]).toHaveStyle({ top: '30%', height: '60%' })
  })

  it('styles a box the way the template asked', () => {
    const styled = layout({
      elementPositions: {
        title: {
          x: 0,
          y: 0,
          w: 1,
          h: 0.5,
          align: 'center',
          vAlign: 'end',
          fontSize: 8,
          fontWeight: 700,
          color: '#123456',
        },
      },
    })
    const { container } = render(
      <PositionedLayout
        slide={slide}
        colors={{} as never}
        layout={styled}
        slot={slotOf as never}
      />,
    )
    expect(container.querySelector('div[style]')).toHaveStyle({
      justifyContent: 'flex-end',
      alignItems: 'center',
      fontSize: '8cqi',
      fontWeight: '700',
      color: '#123456',
    })
  })

  it('reads a colour named as a theme key from the theme', () => {
    const themed = layout({
      elementPositions: {
        title: { x: 0, y: 0, w: 1, h: 0.5, color: 'accent' },
      },
    })
    const { container } = render(
      <PositionedLayout
        slide={slide}
        colors={{ accent: '#ff0000' } as never}
        layout={themed}
        slot={slotOf as never}
      />,
    )
    expect(container.querySelector('div[style]')).toHaveStyle({
      color: '#ff0000',
    })
  })

  it('renders every positioned slot through the slot system', () => {
    render(
      <PositionedLayout
        slide={slide}
        colors={{} as never}
        layout={arranged}
        slot={slotOf as never}
      />,
    )
    expect(screen.getByText('slot:title')).toBeInTheDocument()
    expect(screen.getByText('slot:body')).toBeInTheDocument()
  })

  it('leaves out a slot the arrangement does not place', () => {
    const partial = layout({
      elementPositions: { title: { x: 0, y: 0, w: 1, h: 0.5 } },
    })
    render(
      <PositionedLayout
        slide={slide}
        colors={{} as never}
        layout={partial}
        slot={slotOf as never}
      />,
    )
    expect(screen.getByText('slot:title')).toBeInTheDocument()
    expect(screen.queryByText('slot:body')).toBeNull()
  })
})

describe('a slide rendered from arrangement data', () => {
  it('draws the arranged layout end to end', () => {
    render(
      <SlideView slide={slide} template={template(arranged, 'positioned')} />,
    )
    // The content is on the slide, positioned rather than hand-arranged
    expect(screen.getByText('A title')).toBeInTheDocument()
    expect(screen.getByText('Some body text')).toBeInTheDocument()
  })

  it('still draws a template that positions nothing', () => {
    render(
      <SlideView slide={slide} template={template(layout(), 'positioned')} />,
    )
    expect(screen.getByText('A title')).toBeInTheDocument()
  })

  it('keeps the slide editable when arranged', () => {
    const onEdit = vi.fn()
    render(
      <SlideView
        slide={slide}
        template={template(arranged, 'positioned')}
        editable
        onEdit={onEdit}
      />,
    )
    expect(screen.getByText('A title')).toBeInTheDocument()
  })
})
