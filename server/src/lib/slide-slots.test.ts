/**
 * Unit tests for the slide slot map. The map is the store and the five
 * conventional fields are derived from it, so the two must never disagree —
 * and a slide written before the map existed must read back as one that has
 * it (docs/plans/extensible-templates-plan.md).
 */
import { describe, it, expect } from 'vitest'
import {
  foldLegacy,
  legacyFrom,
  patchSlot,
  remapSlots,
  slotsOf,
} from './slide-slots'

const changedNothing = () => false
const changedEverything = () => true

describe('slotsOf', () => {
  it('reads the map when the slide has one', () => {
    const slots = { title: { kind: 'text' as const, value: 'Osmosis' } }
    expect(slotsOf({ slots, title: 'stale' })).toBe(slots)
  })

  it('builds one from the conventional fields when the slide predates it', () => {
    expect(
      slotsOf({
        title: 'Osmosis',
        bullets: ['water', 'salt'],
        imageRef: 'http://img/x.png',
        imageSource: 'stock',
      }),
    ).toEqual({
      title: { kind: 'text', value: 'Osmosis' },
      bullets: { kind: 'bullets', items: ['water', 'salt'] },
      image: {
        kind: 'image',
        ref: 'http://img/x.png',
        source: 'stock',
        keywords: undefined,
        attribution: undefined,
      },
    })
  })

  it('leaves out what the slide does not hold', () => {
    // Five blank entries would claim the slide has content it does not
    expect(slotsOf({ title: 'Osmosis' })).toEqual({
      title: { kind: 'text', value: 'Osmosis' },
    })
  })
})

describe('legacyFrom', () => {
  it('derives the conventional fields, so old readers still work', () => {
    expect(
      legacyFrom({
        title: { kind: 'text', value: 'Osmosis' },
        bullets: { kind: 'bullets', items: ['water'] },
        image: { kind: 'image', ref: 'http://img/x.png', source: 'seeded' },
      }),
    ).toMatchObject({
      title: 'Osmosis',
      bullets: ['water'],
      imageRef: 'http://img/x.png',
      imageSource: 'seeded',
    })
  })

  it('ignores a slot of a kind those fields cannot hold', () => {
    // A code slot is not a title, and must not be smuggled into one
    expect(
      legacyFrom({ title: { kind: 'code', source: 'print(1)' } }).title,
    ).toBeUndefined()
  })

  it('reads nothing from a slot the author named', () => {
    expect(legacyFrom({ 'photo-2': { kind: 'image', ref: 'x' } })).toEqual({
      title: undefined,
      body: undefined,
      bullets: undefined,
      caption: undefined,
      imageRef: undefined,
      imageSource: undefined,
      imageKeywords: undefined,
      attribution: undefined,
    })
  })
})

describe('foldLegacy', () => {
  it('folds a write to a conventional field into the map', () => {
    const folded = foldLegacy({}, { title: 'Osmosis' }, f => f === 'title')
    expect(folded.title).toEqual({ kind: 'text', value: 'Osmosis' })
  })

  it('leaves untouched fields alone', () => {
    const before = { body: { kind: 'text' as const, value: 'kept' } }
    expect(foldLegacy(before, { title: 'new' }, changedNothing)).toEqual(before)
  })

  it('empties a slot when its field was cleared', () => {
    const before = { title: { kind: 'text' as const, value: 'Osmosis' } }
    expect(foldLegacy(before, {}, changedEverything).title).toBeUndefined()
  })

  it('keeps the credit when only the picture changed', () => {
    const before = {
      image: {
        kind: 'image' as const,
        ref: 'old.png',
        attribution: { creator: 'Ada' },
      },
    }
    const folded = foldLegacy(
      before,
      { imageRef: 'new.png' },
      f => f === 'imageRef',
    )
    expect(folded.image).toMatchObject({
      ref: 'new.png',
      attribution: { creator: 'Ada' },
    })
  })

  it('drops an image slot left holding nothing at all', () => {
    const before = { image: { kind: 'image' as const, ref: 'old.png' } }
    expect(foldLegacy(before, {}, changedEverything).image).toBeUndefined()
  })
})

describe('patchSlot', () => {
  it('replaces a text slot outright', () => {
    expect(
      patchSlot({}, 'note', { kind: 'text', value: 'Read chapter 4' }).note,
    ).toEqual({ kind: 'text', value: 'Read chapter 4' })
  })

  it('merges an image slot, so setting a picture keeps its credit', () => {
    const before = patchSlot({}, 'photo-1', {
      kind: 'image',
      ref: 'a.png',
      attribution: { creator: 'Ada' },
    })
    const after = patchSlot(before, 'photo-1', { kind: 'image', ref: 'b.png' })
    expect(after['photo-1']).toMatchObject({
      ref: 'b.png',
      attribution: { creator: 'Ada' },
    })
  })

  it('leaves every other slot untouched', () => {
    const before = { 'photo-1': { kind: 'image' as const, ref: 'a.png' } }
    const after = patchSlot(before, 'photo-2', { kind: 'image', ref: 'b.png' })
    expect(after['photo-1']).toEqual({ kind: 'image', ref: 'a.png' })
  })
})

describe('remapSlots', () => {
  const slots = {
    title: { kind: 'text' as const, value: 'Osmosis' },
    body: { kind: 'text' as const, value: 'Water moves' },
  }

  it('moves a value onto the box the pairing named', () => {
    const next = remapSlots(slots, { title: 'headline' })
    expect(next.headline).toEqual({ kind: 'text', value: 'Osmosis' })
  })

  it('leaves a box that paired with itself exactly where it is', () => {
    expect(remapSlots(slots, { title: 'title', body: 'body' })).toEqual(slots)
  })

  it('keeps the old key, so switching back finds its content again', () => {
    // Unreachable while the new layout is on (it declares no such box), and
    // the source the refit pass writes the new layout's holes from.
    const next = remapSlots(slots, { title: 'headline' })
    expect(next.title).toEqual({ kind: 'text', value: 'Osmosis' })
  })

  it('ignores a pairing for a box that holds nothing', () => {
    const next = remapSlots(slots, { caption: 'credit' })
    expect(next.credit).toBeUndefined()
    expect(next).toEqual(slots)
  })

  it('does not mutate the map it was given', () => {
    const before = { ...slots }
    remapSlots(slots, { title: 'headline' })
    expect(slots).toEqual(before)
  })
})

/**
 * A conventional NAME holding a specialized KIND (TMPL-9/GEN-11).
 *
 * An author who turns "body" into a maths or code box has not renamed it. The
 * legacy fields predate those kinds and can only ever say "some prose", so an
 * empty `body` must not be read as "this box is empty" — it means the box
 * holds something `body` cannot express.
 */
describe('a legacy field and a box it cannot express', () => {
  const always = () => true

  it('leaves a listing alone when the prose field is empty', () => {
    // The bug this guards: a generated slide arrived with its code box
    // filled and came back from the database with it gone
    const folded = foldLegacy(
      { body: { kind: 'code', source: 'for x in xs:\n    pass' } },
      { body: undefined },
      always,
    )
    expect(folded.body).toEqual({
      kind: 'code',
      source: 'for x in xs:\n    pass',
    })
  })

  it('leaves a formula alone, and a table, and preformatted text', () => {
    for (const value of [
      { kind: 'math' as const, tex: 'v = gt' },
      { kind: 'table' as const, rows: [['2024']] },
      { kind: 'preformatted' as const, value: 'a  b' },
    ]) {
      expect(
        foldLegacy({ body: value }, { body: undefined }, always).body,
      ).toEqual(value)
    }
  })

  it('still clears a box the field CAN express', () => {
    // Prose emptied is prose gone — that is what the legacy field means
    expect(
      foldLegacy(
        { body: { kind: 'text', value: 'gone' } },
        { body: undefined },
        always,
      ).body,
    ).toBeUndefined()
  })

  it('still lets prose replace what was there', () => {
    expect(
      foldLegacy(
        { body: { kind: 'code', source: 'x = 1' } },
        { body: 'now prose' },
        always,
      ).body,
    ).toEqual({ kind: 'text', value: 'now prose' })
  })

  it('leaves a list-kind box alone only when it is not a list', () => {
    expect(
      foldLegacy(
        { bullets: { kind: 'table', rows: [['a']] } },
        { bullets: [] },
        always,
      ).bullets,
    ).toEqual({ kind: 'table', rows: [['a']] })
    expect(
      foldLegacy(
        { bullets: { kind: 'bullets', items: ['a'] } },
        { bullets: [] },
        always,
      ).bullets,
    ).toBeUndefined()
  })
})
