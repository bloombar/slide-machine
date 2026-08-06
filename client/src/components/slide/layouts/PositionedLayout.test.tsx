/**
 * Unit tests for the two renderers a layout falls back to when it has no
 * tree: PositionedLayout, which draws absolute geometry (what a design
 * imported from Google Slides is), and the generic fallback for a layout that
 * says nothing about itself at all.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Layout, Slide, Template } from '@slide-machine/shared'
import SlideView from '../../SlideView'
import { rendererFor } from './index'
import PositionedLayout from './PositionedLayout'
import FlowLayout from './FlowLayout'
import GenericLayout from './GenericLayout'
import WhiteboardLayout from './WhiteboardLayout'
import { DEFAULT_TEXT_STYLES } from '../theme'

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

const template = (l: Layout): Template => ({
  id: 't1',
  permalinkSlug: 't1',
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
  slots: {
    title: { kind: 'text', value: 'A title' },
    body: { kind: 'text', value: 'Some body text' },
  },
}

const props = (l: Layout, colors: object = {}) => ({
  slide,
  colors: colors as never,
  textStyles: DEFAULT_TEXT_STYLES,
  metrics: { marginX: 0.06, marginY: 0.06, gap: 0.03, padding: 0.02 },
  layout: l,
  slot: ((name: string) => <span>{`slot:${name}`}</span>) as never,
})

describe('choosing a renderer', () => {
  it('draws from the tree when the layout has one', () => {
    const withTree = layout({ tree: { id: 'root', slot: 'title' } })
    expect(rendererFor('content', withTree)).toBe(FlowLayout)
  })

  it('prefers the tree over geometry, since geometry is derived from it', () => {
    const both = layout({
      tree: { id: 'root', slot: 'title' },
      elementPositions: arranged.elementPositions,
    })
    expect(rendererFor('content', both)).toBe(FlowLayout)
  })

  it('falls back to geometry for an imported design with no tree', () => {
    expect(rendererFor('content', arranged)).toBe(PositionedLayout)
  })

  it('falls back to the generic renderer when a layout says nothing', () => {
    expect(rendererFor('content', layout())).toBe(GenericLayout)
    expect(rendererFor('content', undefined)).toBe(GenericLayout)
  })

  it('always keeps the whiteboard a blank slate', () => {
    // It has no slots, and the generic fallback would offer editors for
    // content it must never hold (WB-1).
    expect(rendererFor('whiteboard', undefined)).toBe(WhiteboardLayout)
    expect(rendererFor('whiteboard', arranged)).toBe(WhiteboardLayout)
  })
})

describe('PositionedLayout', () => {
  it('places each positioned slot at its own box', () => {
    const { container } = render(<PositionedLayout {...props(arranged)} />)
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
    const { container } = render(<PositionedLayout {...props(styled)} />)
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
      <PositionedLayout {...props(themed, { accent: '#ff0000' })} />,
    )
    expect(container.querySelector('div[style]')).toHaveStyle({
      color: '#ff0000',
    })
  })

  it('takes a box style from the named text style it follows', () => {
    const named = layout({
      elementPositions: {
        title: { x: 0, y: 0, w: 1, h: 0.5, textStyle: 'title' },
      },
    })
    const { container } = render(<PositionedLayout {...props(named)} />)
    expect(container.querySelector('div[style]')).toHaveStyle({
      fontSize: '7cqi',
      fontWeight: '700',
    })
  })

  it('lets a box override one field of the style it follows', () => {
    const named = layout({
      elementPositions: {
        title: { x: 0, y: 0, w: 1, h: 0.5, textStyle: 'title', fontSize: 3 },
      },
    })
    const { container } = render(<PositionedLayout {...props(named)} />)
    // The override wins; the weight still comes from the role.
    expect(container.querySelector('div[style]')).toHaveStyle({
      fontSize: '3cqi',
      fontWeight: '700',
    })
  })

  it('renders every positioned slot through the slot system', () => {
    render(<PositionedLayout {...props(arranged)} />)
    expect(screen.getByText('slot:title')).toBeInTheDocument()
    expect(screen.getByText('slot:body')).toBeInTheDocument()
  })

  it('leaves out a slot the arrangement does not place', () => {
    const partial = layout({
      elementPositions: { title: { x: 0, y: 0, w: 1, h: 0.5 } },
    })
    render(<PositionedLayout {...props(partial)} />)
    expect(screen.getByText('slot:title')).toBeInTheDocument()
    expect(screen.queryByText('slot:body')).toBeNull()
  })
})

describe('a slide rendered from arrangement data', () => {
  it('draws the arranged layout end to end', () => {
    render(<SlideView slide={slide} template={template(arranged)} />)
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
