/**
 * The box-to-box pairing a layout switch runs on (GEN-9).
 *
 * The cases that matter are the conventional layouts, so most of these build
 * their layouts from the real default trees rather than from fixtures — a
 * change to a built-in's typography that would break the pairing should break
 * these tests too.
 */
import { describe, it, expect } from 'vitest'
import { defaultLayoutTree, treeFromSlots } from './layout-trees'
import {
  pairSlots,
  tierOf,
  tieredSlots,
  textStylesBySlot,
} from './slot-pairing'
import type { Layout, SlotKind, SlotSpec } from './template'

/** A layout of the given conventional type, carrying its real tree. */
const conventional = (type: string, names: [string, SlotKind][]): Layout =>
  ({
    type,
    label: type,
    purpose: '',
    slots: names.map(([name, kind]) => ({ name, kind, label: name })),
    tree: defaultLayoutTree(type),
    elementPositions: {},
  }) as Layout

const title = () =>
  conventional('title', [
    ['title', 'text'],
    ['caption', 'text'],
  ])
const section = () => conventional('section', [['title', 'text']])
const content = () =>
  conventional('content', [
    ['title', 'text'],
    ['body', 'text'],
  ])
const list = () =>
  conventional('list', [
    ['title', 'text'],
    ['bullets', 'bullets'],
  ])
const imageHeavy = () =>
  conventional('image-heavy', [
    ['image', 'image'],
    ['caption', 'text'],
  ])
const twoColumn = () =>
  conventional('two-column', [
    ['title', 'text'],
    ['body', 'text'],
    ['image', 'image'],
  ])
const quote = () =>
  conventional('quote', [
    ['body', 'text'],
    ['caption', 'text'],
  ])

/** A layout an author built: own slot names, tree inferred from them. */
const authored = (slots: SlotSpec[]): Layout =>
  ({
    type: 'custom',
    label: 'Custom',
    purpose: '',
    slots,
    tree: treeFromSlots(slots),
    elementPositions: {},
  }) as Layout

describe('tierOf', () => {
  it('puts every headline style in one tier, whatever its size', () => {
    expect(tierOf('text', 'title')).toBe('headline')
    expect(tierOf('text', 'sectionTitle')).toBe('headline')
    expect(tierOf('text', 'heading')).toBe('headline')
  })

  it('reads kind before style for pictures and lists', () => {
    expect(tierOf('image', undefined)).toBe('image')
    expect(tierOf('bullets', 'body')).toBe('list')
  })

  it('files a quote with prose, and unstyled text with it too', () => {
    expect(tierOf('text', 'quote')).toBe('prose')
    expect(tierOf('text', 'body')).toBe('prose')
    expect(tierOf('text', undefined)).toBe('prose')
    expect(tierOf('text', 'somethingUnknown')).toBe('prose')
  })
})

describe('textStylesBySlot', () => {
  it('reads styles out of the tree', () => {
    expect(textStylesBySlot(content())).toEqual({
      title: 'heading',
      body: 'body',
    })
  })

  it('falls back to bare geometry when there is no tree', () => {
    const styles = textStylesBySlot({
      elementPositions: {
        headline: { x: 0, y: 0, w: 1, h: 0.3, textStyle: 'title' },
      },
    } as unknown as Layout)
    expect(styles.headline).toBe('title')
  })
})

describe('tieredSlots', () => {
  it('tags each built-in box with what it holds', () => {
    expect(tieredSlots(twoColumn())).toEqual([
      { name: 'title', kind: 'text', tier: 'headline' },
      { name: 'body', kind: 'text', tier: 'prose' },
      { name: 'image', kind: 'image', tier: 'image' },
    ])
  })

  it('gives every built-in layout at most one box per tier', () => {
    for (const layout of [
      title(),
      section(),
      content(),
      list(),
      imageHeavy(),
      twoColumn(),
      quote(),
    ]) {
      const keys = tieredSlots(layout).map(s => `${s.kind}:${s.tier}`)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })
})

describe('pairSlots', () => {
  it('pairs the same name in both layouts', () => {
    const { pairs, unmatchedTo, unmatchedFrom } = pairSlots(content(), list())
    expect(pairs.title).toBe('title')
    // body (prose) and bullets (list) are different tiers: no partner.
    expect(unmatchedFrom).toEqual(['body'])
    expect(unmatchedTo).toEqual(['bullets'])
  })

  it('pairs a title across layouts that style it differently', () => {
    // The morph this whole mechanism exists for: title -> section changes the
    // text style, so a pairing keyed on style would refuse to match them.
    expect(pairSlots(title(), section()).pairs.title).toBe('title')
    expect(pairSlots(title(), content()).pairs.title).toBe('title')
  })

  it('pairs boxes whose names differ but which hold the same thing', () => {
    const custom = authored([
      { name: 'headline', kind: 'text', label: 'Headline' },
      { name: 'prose', kind: 'text', label: 'Prose' },
    ])
    const { pairs, unmatchedTo, unmatchedFrom } = pairSlots(content(), custom)
    // treeFromSlots styles the first text box as the heading it usually is.
    expect(pairs).toEqual({ title: 'headline', body: 'prose' })
    expect(unmatchedTo).toEqual([])
    expect(unmatchedFrom).toEqual([])
  })

  it('pairs the picture even when the layouts name it differently', () => {
    const custom = authored([
      { name: 'photo', kind: 'image', label: 'Photo' },
      { name: 'credit', kind: 'text', label: 'Credit' },
    ])
    expect(pairSlots(imageHeavy(), custom).pairs.image).toBe('photo')
  })

  it('never pairs one old box with two new ones', () => {
    const custom = authored([
      { name: 'a', kind: 'text', label: 'A' },
      { name: 'b', kind: 'text', label: 'B' },
      { name: 'c', kind: 'text', label: 'C' },
    ])
    const { pairs } = pairSlots(content(), custom)
    const targets = Object.values(pairs)
    expect(new Set(targets).size).toBe(targets.length)
  })

  it('breaks a tie between same-tier boxes by declaration order', () => {
    const from = authored([
      { name: 'left', kind: 'text', label: 'Left' },
      { name: 'right', kind: 'text', label: 'Right' },
    ])
    const to = authored([
      { name: 'first', kind: 'text', label: 'First' },
      { name: 'second', kind: 'text', label: 'Second' },
    ])
    expect(pairSlots(from, to).pairs).toEqual({
      left: 'first',
      right: 'second',
    })
  })

  it('reports the holes when the new layout wants more boxes', () => {
    const { unmatchedTo } = pairSlots(section(), twoColumn())
    expect(unmatchedTo).toEqual(['body', 'image'])
  })

  it('reports content with nowhere to go', () => {
    const { unmatchedFrom } = pairSlots(twoColumn(), section())
    expect(unmatchedFrom).toEqual(['body', 'image'])
  })

  it('is stable when a layout is paired with itself', () => {
    const { pairs, unmatchedTo, unmatchedFrom } = pairSlots(
      twoColumn(),
      twoColumn(),
    )
    expect(pairs).toEqual({ title: 'title', body: 'body', image: 'image' })
    expect(unmatchedTo).toEqual([])
    expect(unmatchedFrom).toEqual([])
  })

  it('does not pair a shared name that changed medium', () => {
    // Both call a box `body`, but one is a paragraph and the other a list:
    // carrying the value over would put text in a box that cannot show it.
    const from = authored([{ name: 'body', kind: 'text', label: 'Body' }])
    const to = authored([{ name: 'body', kind: 'bullets', label: 'Body' }])
    const { pairs, unmatchedTo, unmatchedFrom } = pairSlots(from, to)
    expect(pairs).toEqual({})
    expect(unmatchedTo).toEqual(['body'])
    expect(unmatchedFrom).toEqual(['body'])
  })

  it('does not pair a picture with a text box', () => {
    const { pairs } = pairSlots(
      authored([{ name: 'photo', kind: 'image', label: 'Photo' }]),
      authored([{ name: 'words', kind: 'text', label: 'Words' }]),
    )
    expect(pairs).toEqual({})
  })

  it('handles a layout with no slots at all (whiteboard)', () => {
    const blank = { slots: [], elementPositions: {} } as unknown as Layout
    expect(pairSlots(content(), blank)).toEqual({
      pairs: {},
      unmatchedTo: [],
      unmatchedFrom: ['title', 'body'],
    })
    expect(pairSlots(blank, content()).unmatchedTo).toEqual(['title', 'body'])
  })
})
