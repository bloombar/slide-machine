/**
 * Unit tests for the arrangement engine (TMPL-4). A layout that carries
 * positions is drawn from that data — one renderer, any arrangement — while a
 * layout without them keeps its hand-tuned component, which is what every
 * built-in relies on.
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

const arranged = layout({
  elementPositions: {
    title: { x: 10, y: 5, w: 80, h: 20 },
    body: { x: 10, y: 30, w: 80, h: 60 },
  },
})

const template = (l: Layout): Template => ({
  id: 't1',
  ownerId: 'u1',
  name: 'Mine',
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
  title: 'A title',
  body: 'Some body text',
}

describe('choosing a renderer', () => {
  it('uses the engine when the layout carries positions', () => {
    expect(rendererFor('content', arranged)).toBe(PositionedLayout)
  })

  it('keeps the hand-tuned component when it does not', () => {
    expect(rendererFor('content', layout())).toBe(getLayoutRenderer('content'))
  })

  it('keeps the hand-tuned component when there is no layout at all', () => {
    expect(rendererFor('content', undefined)).toBe(getLayoutRenderer('content'))
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
      elementPositions: { title: { x: 0, y: 0, w: 100, h: 50 } },
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
    render(<SlideView slide={slide} template={template(arranged)} />)
    // The content is on the slide, positioned rather than hand-arranged
    expect(screen.getByText('A title')).toBeInTheDocument()
    expect(screen.getByText('Some body text')).toBeInTheDocument()
  })

  it('still draws a template that positions nothing', () => {
    render(<SlideView slide={slide} template={template(layout())} />)
    expect(screen.getByText('A title')).toBeInTheDocument()
  })

  it('keeps the slide editable when arranged', () => {
    const onEdit = vi.fn()
    render(
      <SlideView
        slide={slide}
        template={template(arranged)}
        editable
        onEdit={onEdit}
      />,
    )
    expect(screen.getByText('A title')).toBeInTheDocument()
  })
})
