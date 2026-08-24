/**
 * The type scale an imported deck turns out to have been set on (TMPL-9).
 *
 * Written to what the derivation PROMISES rather than to where it happens to
 * put a value. The refactor this covers moves a box's type out of the box and
 * onto a named role, so any test that reads `fontSize` off the box is testing
 * the half of the cascade the scale is free to keep changing. What must hold
 * is what a box RESOLVES to — `resolveStyle` over `themeTextStyles`, exactly
 * as the server and the renderer read it — and that is what `resolved()`
 * below asserts on.
 */
import { describe, it, expect } from 'vitest'
import { themeTextStyles } from '@slide-machine/shared'
import { resolveStyle } from '../lib/tree-boxes'
import type { CandidateSlot } from './candidate'
import type { DerivedLayout } from './consolidate'
import { deriveTypeScale, typeOfBox, type TypeScale } from './type-scale'

const slot = (
  name: string,
  over: Partial<CandidateSlot> = {},
): CandidateSlot => ({
  name,
  kind: 'text',
  box: { x: 0.1, y: 0.1, w: 0.8, h: 0.2 },
  ...over,
})

const layouts = (slots: CandidateSlot[]): DerivedLayout[] => [
  { slots, decoration: [], members: ['s1'] },
]

/** A box's type as everything that draws it sees it: the theme the import
 * would store, the role the box names, and the box's own fields over the top. */
const resolved = (s: CandidateSlot, scale: TypeScale) =>
  resolveStyle(
    typeOfBox(s, scale),
    themeTextStyles({ textStyles: scale.styles }),
  )

/** Several boxes set the same way, so a size has enough weight to anchor. */
const many = (
  count: number,
  name: string,
  over: Partial<CandidateSlot> = {},
): CandidateSlot[] =>
  Array.from({ length: count }, (_, i) => slot(`${name}-${i + 1}`, over))

describe('the sizes a deck was set in', () => {
  it('are not derived at all from a deck that states none', () => {
    // A deck of pictures has no typography to state once, and inventing one
    // would put styles in front of an author their deck never asked for
    const scale = deriveTypeScale(
      layouts([slot('picture', { kind: 'image' }), slot('untyped')]),
    )
    expect(scale.styles).toBeUndefined()
    expect(scale.roleOf.size).toBe(0)
  })

  it('keeps a box the scale could not place exactly as it was measured', () => {
    const untyped = slot('untyped', { bold: true, color: '#333333' })
    const scale = deriveTypeScale(layouts([untyped]))
    expect(typeOfBox(untyped, scale)).toEqual({
      fontWeight: 700,
      color: '#333333',
    })
  })

  it('collapse onto one when the deck only varied them by accident', () => {
    // 40 and 38 are one title an author nudged, not two kinds of title
    const nudged = slot('title-2', { fontSize: 38 })
    const scale = deriveTypeScale(
      layouts([
        ...many(4, 'body', { fontSize: 20 }),
        slot('title-1', { fontSize: 40 }),
        nudged,
      ]),
    )
    expect(scale.roleOf.get(nudged)).toBe('title')
    // and the nudged box is drawn at the size the deck actually used
    expect(resolved(nudged, scale).fontSize).toBe(40)
  })

  it('stay apart when a run of near neighbours would otherwise chain', () => {
    // 40/37/34/31 each sit within 8% of the LAST one, so comparing against a
    // running edge would swallow all four into a single role in which nothing
    // is within tolerance of anything else. Measured against the size that
    // opened the cluster, 40 and 37 merge and 34 and 31 do not.
    const scale = deriveTypeScale(
      layouts([
        ...many(6, 'body', { fontSize: 12 }),
        slot('a', { fontSize: 40 }),
        slot('b', { fontSize: 37 }),
        slot('c', { fontSize: 34 }),
        slot('d', { fontSize: 31 }),
      ]),
    )
    expect(scale.styles!.title!.fontSize).toBe(40)
    expect(scale.styles!.sectionTitle!.fontSize).toBe(34)
    expect(scale.styles!.heading!.fontSize).toBe(31)
  })

  it('resolve a tie in favour of the larger, so a role never drifts down', () => {
    // One box at 40 and one at 37 is a tie; the scale takes the size that
    // opened the cluster rather than whichever the map happened to hold first
    const scale = deriveTypeScale(
      layouts([
        ...many(6, 'body', { fontSize: 12 }),
        slot('a', { fontSize: 40 }),
        slot('b', { fontSize: 37 }),
      ]),
    )
    expect(scale.styles!.title!.fontSize).toBe(40)
  })
})

describe('the roles it hands out', () => {
  it('calls the commonest prose size the body, and ranks around it', () => {
    const scale = deriveTypeScale(
      layouts([
        ...many(5, 'text', { fontSize: 20 }),
        slot('big', { fontSize: 40 }),
        slot('small', { fontSize: 12 }),
      ]),
    )
    expect(scale.styles!.body!.fontSize).toBe(20)
    expect(scale.styles!.title!.fontSize).toBe(40)
    expect(scale.styles!.caption!.fontSize).toBe(12)
  })

  it('never ranks a role above a larger one', () => {
    // A deck whose text boxes are all called `title` must not take the word
    // from the cluster that is actually largest — that would come out
    // inverted, a `sectionTitle` set bigger than the `title` above it
    const scale = deriveTypeScale(
      layouts([
        ...many(3, 'title', { fontSize: 40 }),
        slot('big', { fontSize: 60 }),
      ]),
    )
    const { title, sectionTitle, heading, body } = scale.styles!
    expect(title!.fontSize).toBe(60)
    for (const lesser of [sectionTitle, heading, body])
      if (lesser?.fontSize)
        expect(title!.fontSize).toBeGreaterThan(lesser.fontSize)
  })

  it('reads the anchor’s own name when there is no order to read', () => {
    // A deck with one type size, and every box of it called a title, is a
    // deck of titles — calling that size `body` would be the app's word
    const scale = deriveTypeScale(layouts(many(3, 'title', { fontSize: 40 })))
    expect(Object.keys(scale.styles!)).toEqual(['title'])
  })

  it('gives every rank it hands out to exactly one size', () => {
    // Two clusters sharing a role would make the smaller unreachable
    const scale = deriveTypeScale(
      layouts([
        ...many(6, 'body', { fontSize: 12 }),
        ...many(3, 'a', { fontSize: 60 }),
        ...many(3, 'b', { fontSize: 40 }),
        ...many(3, 'c', { fontSize: 28 }),
        ...many(2, 'd', { fontSize: 9 }),
      ]),
    )
    const roles = [...scale.roleOf.values()]
    const sizes = new Map<string, number>()
    for (const [s, role] of scale.roleOf) {
      const seen = sizes.get(role)
      if (seen !== undefined) expect(s.fontSize).toBe(seen)
      sizes.set(role, s.fontSize!)
    }
    expect(new Set(roles).size).toBe(5)
  })

  it('never lets a one-off figure take the title from a size the deck uses', () => {
    // REGRESSION. Ranking above the body by box count is what keeps a
    // one-off from taking `title` — but taking the top three by count and no
    // more filled the spare ranks from a field of singletons, and the size
    // sort that follows then crowned the largest of THEM. This deck is the
    // shape that exposes it: one well-used heading size, one well-used
    // sub-heading, and a single enormous figure on one slide.
    const figure = slot('figure', { fontSize: 90 })
    const scale = deriveTypeScale(
      layouts([
        ...many(6, 'body', { fontSize: 12 }),
        ...many(6, 'heading', { fontSize: 28 }),
        ...many(2, 'sub', { fontSize: 20 }),
        figure,
      ]),
    )
    expect(scale.styles!.title!.fontSize).toBe(28)
    // And the figure follows no role at all rather than defining one, so its
    // own size stays on the box.
    expect(scale.roleOf.get(figure)).toBeUndefined()
  })

  it('still names a title in a deck where every heading size is a one-off', () => {
    // The other half of that rule, and the load-bearing half: a deck of five
    // slides may genuinely use each of its heading sizes once. Preferring
    // well-used sizes must not leave such a deck with no heading role at all.
    const scale = deriveTypeScale(
      layouts([
        ...many(4, 'body', { fontSize: 12 }),
        slot('big', { fontSize: 44 }),
        slot('medium', { fontSize: 30 }),
      ]),
    )
    expect(scale.styles!.title!.fontSize).toBe(44)
  })

  it('still finds a middle to rank from in a deck that is all lists', () => {
    const scale = deriveTypeScale(
      layouts([
        ...many(4, 'points', { kind: 'bullets', fontSize: 20 }),
        slot('lead', { kind: 'bullets', fontSize: 40 }),
      ]),
    )
    expect(scale.styles!.bullet!.fontSize).toBe(20)
    expect(scale.styles!.title!.fontSize).toBe(40)
  })

  it('lets prose and lists at one size be two things said about it', () => {
    const points = slot('points', { kind: 'bullets', fontSize: 20 })
    const prose = slot('text-1', { fontSize: 20 })
    const scale = deriveTypeScale(
      layouts([
        points,
        prose,
        ...many(2, 'text', { fontSize: 20 }),
        slot('t', { fontSize: 40 }),
      ]),
    )
    expect(scale.roleOf.get(points)).toBe('bullet')
    expect(scale.roleOf.get(prose)).toBe('body')
    expect(scale.styles!.bullet!.maxItems).toBeGreaterThan(0)
    // a run of prose is not a list and takes no point count
    expect(scale.styles!.body!.maxItems).toBeUndefined()
  })
})

describe('what a role is allowed to carry', () => {
  it('takes a colour only when every box that follows it already had one', () => {
    const bare = slot('title-2', { fontSize: 40 })
    const coloured = slot('title-1', { fontSize: 40, color: '#b45309' })
    const scale = deriveTypeScale(
      layouts([...many(4, 'body', { fontSize: 20 }), coloured, bare]),
    )
    // The role stays out of it, and each box keeps what it had: the one that
    // stated a colour, and the one that was drawn in the page's own text
    // colour and still is
    expect(resolved(coloured, scale).color).toBe('#b45309')
    expect(resolved(bare, scale).color).toBe('text')
  })

  it('does not embolden the boxes of a role that were not bold', () => {
    const plain = slot('title-2', { fontSize: 40 })
    const heavy = slot('title-1', { fontSize: 40, bold: true })
    const scale = deriveTypeScale(
      layouts([...many(4, 'body', { fontSize: 20 }), heavy, plain]),
    )
    // Ordinary weight is what the plain box was drawn at, and the role says so
    // rather than staying silent — silence would be filled in by the app's
    // default 700 and the box would come back bold
    expect(resolved(plain, scale).fontWeight).toBe(400)
    // and the box that really is bold still is
    expect(resolved(heavy, scale).fontWeight).toBe(700)
  })

  it('does not give a caption a colour the deck never set on it', () => {
    const bare = slot('caption-2', { fontSize: 12 })
    const scale = deriveTypeScale(
      layouts([
        ...many(3, 'body', { fontSize: 20, color: '#111111' }),
        slot('caption-1', { fontSize: 12, color: '#111111' }),
        bare,
      ]),
    )
    // `text`, not `muted`: an uncoloured caption inherited the page's text
    // colour, and the app's default caption style would otherwise grey it
    expect(resolved(bare, scale).color).toBe('text')
  })

  it('stores a colour by the palette’s name for it, so one edit recolours all', () => {
    const heading = slot('title-1', { fontSize: 40, color: '#57068c' })
    const scale = deriveTypeScale(
      layouts([
        ...many(4, 'body', { fontSize: 20 }),
        heading,
        slot('title-2', { fontSize: 40, color: '#57068c' }),
      ]),
      { accent: '#57068c', text: '#1c2230' },
    )
    expect(scale.styles!.title!.color).toBe('accent')
    // the literal behind the name is kept, so a box can tell its colour is
    // already the role's and need not restate it
    expect(scale.colorOf.get('title')).toBe('#57068c')
    expect(typeOfBox(heading, scale).color).toBeUndefined()
  })

  it('lets a box that disagrees with its role keep its own value', () => {
    const odd = slot('title-3', { fontSize: 40, color: '#ff0000' })
    const scale = deriveTypeScale(
      layouts([
        ...many(4, 'body', { fontSize: 20 }),
        ...many(2, 'title', { fontSize: 40, color: '#ffffff' }),
        odd,
      ]),
    )
    expect(resolved(odd, scale).color).toBe('#ff0000')
  })

  it('states a family once, in the terms the app can actually draw', () => {
    // The role is the one place the family should be said, and it has to be
    // said as a bundled stack — a source family name reaches the renderer as
    // a font nothing has
    const scale = deriveTypeScale(
      layouts([
        ...many(4, 'body', { fontSize: 20 }),
        ...many(2, 'title', { fontSize: 40, fontFamily: 'Times New Roman' }),
      ]),
    )
    expect(scale.styles!.title!.fontFamily).toBe('serif')
  })
})

describe('a box read the way anything that draws it reads it', () => {
  it('resolves to the type it was measured in', () => {
    // The whole refactor moves WHERE the type is stored, not what it is
    const title = slot('title-1', {
      fontSize: 40,
      bold: true,
      color: '#ffffff',
      fontFamily: 'Times New Roman',
    })
    const scale = deriveTypeScale(
      layouts([
        ...many(4, 'body', { fontSize: 20 }),
        title,
        slot('title-2', {
          fontSize: 40,
          bold: true,
          color: '#ffffff',
          fontFamily: 'Times New Roman',
        }),
      ]),
    )
    expect(resolved(title, scale)).toMatchObject({
      fontSize: 40,
      fontWeight: 700,
      color: '#ffffff',
      fontFamily: 'serif',
    })
  })

  it('says its type once rather than restating what its role already says', () => {
    // The point of a scale: an instructor who wants the headings a shade
    // darker makes one edit, not one per box
    const title = slot('title-1', {
      fontSize: 40,
      bold: true,
      color: '#ffffff',
      fontFamily: 'Times New Roman',
    })
    const scale = deriveTypeScale(
      layouts([
        ...many(4, 'body', { fontSize: 20 }),
        title,
        slot('title-2', {
          fontSize: 40,
          bold: true,
          color: '#ffffff',
          fontFamily: 'Times New Roman',
        }),
      ]),
    )
    expect(typeOfBox(title, scale)).toEqual({ textStyle: 'title' })
  })
})

/**
 * Promises that came out of fixing two defects, plus the one rule my own
 * fixtures could not test. Merged from the coder session's handoff.
 */
describe('the rules a later change is most likely to break', () => {
  it('measures the room a size fills, not the boxes it fills', () => {
    // Three title STRIPS against two body BLOCKS: more title boxes than body
    // boxes, and far less of the slide given to them. A rule that counted
    // boxes would call 7 the reading size and push the real body down into a
    // caption. Deliberately the one shape that tells the two rules apart —
    // fixtures built from uniform boxes cannot.
    const strip = { x: 0.08, y: 0.1, w: 0.84, h: 0.15 }
    const block = { x: 0.08, y: 0.34, w: 0.84, h: 0.5 }
    const scale = deriveTypeScale(
      layouts([
        slot('title', { fontSize: 7, box: strip }),
        slot('title-2', { fontSize: 7, box: strip }),
        slot('title-3', { fontSize: 6.8, box: strip }),
        slot('body', { fontSize: 2.5, box: block }),
        slot('body-2', { fontSize: 2.5, box: block }),
      ]),
    )
    expect(Object.keys(scale.styles!).sort()).toEqual(['body', 'title'])
    // and the nudged 6.8 collapsed onto the size the deck used most
    expect(scale.styles!.title!.fontSize).toBe(7)
  })

  it('calls two heading sizes a title and a heading', () => {
    // `sectionTitle` is the middle rank and only exists once there are three
    const scale = deriveTypeScale(
      layouts([
        slot('a', { fontSize: 9 }),
        slot('b', { fontSize: 5 }),
        ...many(3, 'body', { fontSize: 2.5 }),
      ]),
    )
    expect(scale.styles!.title!.fontSize).toBe(9)
    expect(scale.styles!.heading!.fontSize).toBe(5)
    expect(scale.styles!.sectionTitle).toBeUndefined()
  })

  it('takes the weight when the whole role is bold', () => {
    const heavy = slot('title-1', { fontSize: 7, bold: true })
    const scale = deriveTypeScale(
      layouts([
        heavy,
        slot('title-2', { fontSize: 7, bold: true }),
        ...many(3, 'body', { fontSize: 2.5 }),
      ]),
    )
    expect(scale.styles!.title!.fontWeight).toBe(700)
    // and the box itself says nothing, because the role already says it
    expect(typeOfBox(heavy, scale).fontWeight).toBeUndefined()
  })

  it('states every property, so no app default can speak for the design', () => {
    // REGRESSION. `themeTextStyles` merges field by field over
    // DEFAULT_TEXT_STYLES, so any property a role leaves out is supplied on
    // its behalf — a silent role is one the app finishes writing, and an
    // imported design comes back subtly restyled rather than broken.
    const scale = deriveTypeScale(
      layouts([
        slot('title-1', { fontSize: 7 }),
        ...many(3, 'body', { fontSize: 2.5 }),
      ]),
    )
    for (const spec of Object.values(scale.styles!)) {
      expect(spec.fontFamily).toBeDefined()
      expect(spec.fontWeight).toBeDefined()
      expect(spec.italic).toBeDefined()
      expect(spec.lineHeight).toBeDefined()
      expect(spec.color).toBeDefined()
    }
  })

  it('counts two families that become one stack as agreement', () => {
    // REGRESSION. Helvetica and Arial are the same bundled stack, so the role
    // states it once. Agreement is judged on what a family BECOMES, not on
    // what the deck happened to call it — otherwise no two boxes ever agree
    // and every one of them restates the family.
    const arial = slot('title-2', { fontSize: 7, fontFamily: 'Arial' })
    const scale = deriveTypeScale(
      layouts([
        slot('title-1', { fontSize: 7, fontFamily: 'Helvetica' }),
        arial,
        ...many(3, 'body', { fontSize: 2.5 }),
      ]),
    )
    expect(scale.styles!.title!.fontFamily).toBe('sans')
    expect(typeOfBox(arial, scale).fontFamily).toBeUndefined()
  })
})
