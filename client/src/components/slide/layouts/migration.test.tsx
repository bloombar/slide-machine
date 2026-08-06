/**
 * The migration guard.
 *
 * Every conventional layout used to be a React component whose Tailwind
 * classes decided the design. Those components are gone — layouts are data
 * now — and this pins each default tree to what its component drew, class for
 * class, so the conversion cannot drift and a later edit to a built-in cannot
 * silently move a slide in a deck someone already made.
 *
 * The expectations below are transcribed from the deleted components; the
 * originals are in git at 663dbad if one needs checking. Writing them out
 * rather than importing them is the point: this file is the record of what
 * those layouts were.
 *
 * jsdom does not lay anything out, so this proves the CSS is right, not that
 * the pixels are. The geometry itself is asserted against a real browser in
 * e2e/tests/builtin-layouts.spec.ts.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import type { Layout, LayoutNode, Slide } from '@slide-machine/shared'
import { defaultLayoutTree } from '@slide-machine/shared'
import FlowLayout from './FlowLayout'
import { DEFAULT_TEXT_STYLES, type ThemeColors } from '../theme'

const metrics = { marginX: 0.06, marginY: 0.06, gap: 0.03, padding: 0.02 }

const colors: ThemeColors = {
  background: '#000000',
  surface: '#111111',
  text: '#ffffff',
  muted: '#888888',
  accent: '#00ffff',
  penColor: '#000000',
  highlighterColor: '#ffff00',
}

/** Every slot filled, so nothing is skipped for being empty. */
const slide: Slide = {
  id: 's1',
  deckId: 'd1',
  index: 0,
  layoutType: 'content',
  slots: {
    title: { kind: 'text', value: 'Title' },
    body: { kind: 'text', value: 'Body' },
    bullets: { kind: 'bullets', items: ['one'] },
    caption: { kind: 'text', value: 'Caption' },
    image: { kind: 'image', ref: 'http://img/x.jpg' },
  },
}

const SLOTS = [
  { name: 'title', kind: 'text' as const, label: 'Slide title' },
  { name: 'body', kind: 'text' as const, label: 'Slide body' },
  { name: 'bullets', kind: 'bullets' as const, label: 'Slide bullets' },
  { name: 'caption', kind: 'text' as const, label: 'Slide caption' },
  { name: 'image', kind: 'image' as const, label: 'Slide image' },
]

/** Renders a conventional layout's default tree and hands back a lookup by
 * node id, which is how the trees name their parts. */
const draw = (type: string) => {
  const tree = defaultLayoutTree(type)
  if (!tree) throw new Error(`no default tree for "${type}"`)
  const layout = {
    type,
    label: type,
    purpose: type,
    slots: SLOTS,
    tree,
    elementPositions: {},
  } as unknown as Layout
  const { container } = render(
    <FlowLayout
      slide={{ ...slide, layoutType: type }}
      colors={colors}
      textStyles={DEFAULT_TEXT_STYLES}
      metrics={metrics}
      layout={layout}
      slot={name => <span>{`slot:${name}`}</span>}
    />,
  )
  return (id: string): HTMLElement => {
    const el = container.querySelector<HTMLElement>(`[data-node-id="${id}"]`)
    if (!el) throw new Error(`no node "${id}" in the ${type} tree`)
    return el
  }
}

describe('content — was: flex h-full flex-col justify-center gap-[3cqi] px-[6cqi]', () => {
  it('stacks its boxes down the middle with the side margins the component had', () => {
    const at = draw('content')
    expect(at('root').className).toContain('flex-col')
    expect(at('root').className).toContain('justify-center')
    expect(at('root')).toHaveStyle({
      gap: '3cqi',
      paddingLeft: '6cqi',
      paddingRight: '6cqi',
    })
  })

  it('marks the title up as a heading, as the h2 did', () => {
    // Losing this would leave a screen reader a wall of undifferentiated text
    // and no way to skim a deck.
    expect(draw('content')('title').tagName).toBe('H2')
  })

  it('keeps the title accent and the relaxed body leading', () => {
    const at = draw('content')
    // h2 was text-[4cqi] font-semibold, coloured by the accent
    expect(at('title')).toHaveStyle({
      fontSize: '4cqi',
      fontWeight: '600',
      color: colors.accent,
    })
    // body was text-[2.75cqi] leading-relaxed
    expect(at('body')).toHaveStyle({ fontSize: '2.75cqi', lineHeight: '1.625' })
  })

  it('states its own side margins rather than inheriting the template’s', () => {
    // `px-[6cqi]`, not `p-[6cqi]`: the layout decides its sides, and a
    // uniform pad would have moved every box on the slide.
    const root = draw('content')('root')
    expect(root.style.paddingLeft).toBe('6cqi')
  })

  it('is not padded top and bottom, because it centres its contents', () => {
    // The template's safe area only reaches a container that pushes toward
    // an edge. Padding a centred column would shorten the room its boxes
    // divide up and move every slide already made with it.
    const root = draw('content')('root')
    expect(root.style.paddingTop).toBe('')
    expect(root.style.paddingBottom).toBe('')
  })
})

describe('list — was: content, with bullets in place of the paragraph', () => {
  it('matches content and sizes its bullets like body text', () => {
    const at = draw('list')
    expect(at('root')).toHaveStyle({ gap: '3cqi', paddingLeft: '6cqi' })
    expect(at('title')).toHaveStyle({ fontSize: '4cqi', color: colors.accent })
    expect(at('bullets')).toHaveStyle({ fontSize: '2.75cqi' })
  })
})

describe('title — was: flex h-full flex-col items-center justify-center gap-[2cqi] text-center', () => {
  it('centres on both axes with no side margins', () => {
    const at = draw('title')
    expect(at('root').className).toContain('items-center')
    expect(at('root').className).toContain('justify-center')
    expect(at('root')).toHaveStyle({ gap: '2cqi' })
  })

  it('sets the h1 at 7cqi bold and the caption in muted', () => {
    const at = draw('title')
    expect(at('title').tagName).toBe('H1')
    expect(at('title')).toHaveStyle({ fontSize: '7cqi', fontWeight: '700' })
    expect(at('title')).toHaveStyle({ textAlign: 'center' })
    expect(at('caption')).toHaveStyle({ color: colors.muted })
  })
})

describe('section — was: an accent rule above a 5.5cqi heading', () => {
  it('draws the rule as decoration, not as a slot', () => {
    const at = draw('section')
    // h-[0.4cqi] w-[8cqi] rounded, filled with the accent
    expect(at('rule')).toHaveStyle({ backgroundColor: colors.accent })
    expect(at('rule')).toHaveAttribute('aria-hidden')
    expect(at('rule').textContent).toBe('')
  })

  it('sizes the heading as the component did', () => {
    const at = draw('section')
    expect(at('title')).toHaveStyle({ fontSize: '5.5cqi', fontWeight: '600' })
  })

  it('centres the pair', () => {
    const at = draw('section')
    expect(at('root').className).toContain('items-center')
    expect(at('root')).toHaveStyle({ gap: '1.5cqi' })
  })
})

describe('two-column — was: grid h-full grid-cols-2 items-center gap-[4cqi] px-[6cqi]', () => {
  it('is a two-track grid, not two boxes that happen to sit side by side', () => {
    const at = draw('two-column')
    expect(at('root').className).toContain('grid')
    expect(at('root').className).toContain('items-center')
    expect(at('root')).toHaveStyle({
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gap: '4cqi',
      paddingLeft: '6cqi',
    })
  })

  it('keeps the image at three quarters height, as h-3/4 did', () => {
    expect(draw('two-column')('image')).toHaveStyle({ height: '75%' })
  })

  it('stacks the text column with its own 2cqi gap', () => {
    expect(draw('two-column')('text')).toHaveStyle({ gap: '2cqi' })
  })
})

describe('image-heavy — was: flex h-full flex-col gap-[1.5cqi] p-[4cqi]', () => {
  it('pads all four sides, which is the one layout that did', () => {
    const at = draw('image-heavy')
    expect(at('root')).toHaveStyle({
      paddingLeft: '4cqi',
      paddingRight: '4cqi',
      paddingTop: '4cqi',
      paddingBottom: '4cqi',
      gap: '1.5cqi',
    })
  })

  it('lets the picture take the room the caption does not', () => {
    // flex-1 on the image, so the caption is a footnote under it
    expect(draw('image-heavy')('image')).toHaveStyle({ flexGrow: '1' })
  })

  it('centres the caption at 2cqi in muted', () => {
    expect(draw('image-heavy')('caption')).toHaveStyle({
      fontSize: '2cqi',
      textAlign: 'center',
      color: colors.muted,
    })
  })
})

describe('quote — was: text-[4cqi] font-medium italic wrapped in curly quotes', () => {
  it('keeps the quotation marks, which were never content', () => {
    const at = draw('quote')
    expect(at('body').textContent).toBe('“slot:body”')
  })

  it('sets the body italic at medium weight', () => {
    expect(draw('quote')('body')).toHaveStyle({
      fontSize: '4cqi',
      fontWeight: '500',
      fontStyle: 'italic',
    })
  })

  it('uses the wider side margins the component had', () => {
    expect(draw('quote')('root')).toHaveStyle({
      paddingLeft: '8cqi',
      gap: '2cqi',
    })
  })
})

describe('whiteboard', () => {
  it('is a blank slate with nothing in it', () => {
    const tree = defaultLayoutTree('whiteboard') as LayoutNode
    expect(tree.children ?? []).toHaveLength(0)
    expect(tree.slot).toBeUndefined()
  })
})
