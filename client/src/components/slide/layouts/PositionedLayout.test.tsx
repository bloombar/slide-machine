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

describe('the parts of a design that hold no content (TMPL-8)', () => {
  /** A layout with a band, a logo and a page-filling picture. */
  const decorated = layout({
    elementPositions: arranged.elementPositions,
    decoration: [
      { x: 0, y: 0, w: 1, h: 1, imageUrl: 'https://cdn.test/bg.jpg' },
      { x: 0, y: 0.92, w: 1, h: 0.02, fill: '#b45309' },
      {
        x: 0.86,
        y: 0.87,
        w: 0.08,
        h: 0.07,
        imageUrl: 'https://cdn.test/l.png',
      },
    ],
  })

  const pieces = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('[aria-hidden="true"]'))

  it('draws each piece where the design puts it', () => {
    const { container } = render(<PositionedLayout {...props(decorated)} />)
    const band = pieces(container)[1] as HTMLElement
    expect(band.style.top).toBe('92%')
    expect(band.style.height).toBe('2%')
    expect(band.style.width).toBe('100%')
  })

  it('paints a picture from the template’s own stored copy', () => {
    const { container } = render(<PositionedLayout {...props(decorated)} />)
    expect((pieces(container)[0] as HTMLElement).style.backgroundImage).toBe(
      'url("https://cdn.test/bg.jpg")',
    )
  })

  it('quotes the URL, so one with a bracket in it cannot break the CSS', () => {
    const awkward = layout({
      elementPositions: arranged.elementPositions,
      decoration: [
        { x: 0, y: 0, w: 1, h: 1, imageUrl: 'https://cdn.test/a b(1).png' },
      ],
    })
    const { container } = render(<PositionedLayout {...props(awkward)} />)
    expect((pieces(container)[0] as HTMLElement).style.backgroundImage).toBe(
      'url("https://cdn.test/a b(1).png")',
    )
  })

  it('paints a band from its fill', () => {
    const { container } = render(<PositionedLayout {...props(decorated)} />)
    expect((pieces(container)[1] as HTMLElement).style.background).toBe(
      'rgb(180, 83, 9)',
    )
  })

  it('resolves a theme key, so a palette stays the one source of truth', () => {
    const themed = layout({
      elementPositions: arranged.elementPositions,
      decoration: [{ x: 0, y: 0, w: 1, h: 0.1, fill: 'accent' }],
    })
    const { container } = render(
      <PositionedLayout {...props(themed, { accent: '#0066ff' })} />,
    )
    expect((pieces(container)[0] as HTMLElement).style.background).toBe(
      'rgb(0, 102, 255)',
    )
  })

  it('cuts a piece to the shape the deck drew', () => {
    // An arrow imported as a grey rectangle is the most visible way a design
    // stops looking like itself
    const withArrow = layout({
      elementPositions: arranged.elementPositions,
      decoration: [
        {
          x: 0.15,
          y: 0.06,
          w: 0.7,
          h: 0.1,
          fill: 'accent',
          shape: 'RIGHT_ARROW',
        },
      ],
    })
    const { container } = render(<PositionedLayout {...props(withArrow)} />)
    expect((pieces(container)[0] as HTMLElement).style.clipPath).toContain(
      'polygon(',
    )
  })

  it('leaves a band as the rectangle it is', () => {
    const { container } = render(<PositionedLayout {...props(decorated)} />)
    expect((pieces(container)[0] as HTMLElement).style.clipPath).toBe('')
  })

  it('draws it behind the content, not over it', () => {
    // A band painted last would cover the words it was meant to sit under
    const { container } = render(<PositionedLayout {...props(decorated)} />)
    const first = container.querySelector('.relative')!.firstElementChild
    expect(first).toHaveAttribute('aria-hidden', 'true')
  })

  it('is hidden from a screen reader and takes no clicks', () => {
    // A decorative logo announced on every slide is noise, not information
    const { container } = render(<PositionedLayout {...props(decorated)} />)
    for (const piece of pieces(container)) {
      expect(piece).toHaveAttribute('aria-hidden', 'true')
      expect(piece).toHaveClass('pointer-events-none')
    }
  })

  it('still shows every slot the layout declares', () => {
    render(<PositionedLayout {...props(decorated)} />)
    expect(screen.getByText('slot:title')).toBeInTheDocument()
    expect(screen.getByText('slot:body')).toBeInTheDocument()
  })

  it('draws nothing extra for a layout with no decoration', () => {
    const { container } = render(<PositionedLayout {...props(arranged)} />)
    expect(pieces(container)).toHaveLength(0)
  })
})

/**
 * An imported design becomes a tree so it can be built on (TMPL-8), which
 * moves it from the positioned renderer to this one. Its logos and bands
 * have to come with it.
 */
describe('decoration under the tree renderer', () => {
  const decoratedTree = layout({
    tree: {
      id: 'root',
      container: { mode: 'flex', direction: 'column' },
      style: { paddingX: 0, paddingY: 0 },
      children: [
        {
          id: 'title',
          slot: 'title',
          free: true,
          box: { x: 0.1, y: 0.05, w: 0.8, h: 0.2 },
        },
      ],
    },
    decoration: [
      { x: 0, y: 0.92, w: 1, h: 0.02, fill: '#b45309' },
      {
        x: 0.86,
        y: 0.87,
        w: 0.08,
        h: 0.07,
        imageUrl: 'https://cdn.test/l.png',
      },
    ],
  })

  const pieces = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('[aria-hidden="true"]'))

  it('draws the logos and bands a design carries', () => {
    // Without this an import gains an editable structure and loses its logo,
    // which is a poor trade.
    const { container } = render(<FlowLayout {...props(decoratedTree)} />)
    expect(pieces(container)).toHaveLength(2)
  })

  it('puts each piece where the design puts it', () => {
    const { container } = render(<FlowLayout {...props(decoratedTree)} />)
    const band = pieces(container)[0] as HTMLElement
    expect(band.style.top).toBe('92%')
    expect(band.style.height).toBe('2%')
  })

  it('leaves them out of reach: they are the design, not the slide', () => {
    // Not in the tree, so not selectable, draggable or deletable — and not
    // announced to a screen reader either.
    const { container } = render(<FlowLayout {...props(decoratedTree)} />)
    for (const piece of pieces(container)) {
      expect(piece).toHaveClass('pointer-events-none')
      expect(piece).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it('draws nothing extra for a design that carries none', () => {
    const plain = layout({ tree: decoratedTree.tree })
    const { container } = render(<FlowLayout {...props(plain)} />)
    expect(pieces(container)).toHaveLength(0)
  })
})
