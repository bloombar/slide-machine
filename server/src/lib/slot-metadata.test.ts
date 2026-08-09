/**
 * Unit tests for the slot metadata an export carries through Google Slides
 * (EXP-8).
 *
 * Two properties matter, and they pull in opposite directions. What we write
 * must come back exactly — that is the whole reason a presentation this
 * system exported round-trips while a foreign one does not. And what we read
 * must never be trusted: the field belongs to the user, who can edit or delete
 * it in Google's interface, and a converter need not preserve it. So every
 * damaged shape a payload can arrive in has a test, and every one of them
 * yields "infer instead" rather than a wrong answer or a thrown error.
 */
import { describe, it, expect } from 'vitest'
import type { SlotSpec } from '@slide-machine/shared'
import {
  MAX_SLOT_PAYLOAD_BYTES,
  SLOT_METADATA_VERSION,
  encodeSlotMetadata,
  parseSlotMetadata,
  slotFromToken,
  slotToken,
} from './slot-metadata'

const slot = (over: Partial<SlotSpec> = {}): SlotSpec => ({
  name: 'body',
  kind: 'text',
  label: 'Slide body',
  ...over,
})

describe('a slot’s identity on its shape', () => {
  it('comes back off the shape that carries it', () => {
    expect(slotFromToken(slotToken('worked-example'))).toBe('worked-example')
  })

  it('is found beside whatever the user wrote themselves', () => {
    // Alt text belongs to the author: a real description is worth more than
    // our marker, so both live there and the marker is read a line at a time
    const alt = `A diagram of the Krebs cycle\n${slotToken('image')}`
    expect(slotFromToken(alt)).toBe('image')
  })

  it('is nothing when the shape is not a slot', () => {
    expect(slotFromToken('Just a decorative rule')).toBeUndefined()
    expect(slotFromToken('')).toBeUndefined()
    expect(slotFromToken(undefined)).toBeUndefined()
  })

  it('is nothing when the token names nothing', () => {
    expect(slotFromToken('slot:')).toBeUndefined()
    expect(slotFromToken('slot:   ')).toBeUndefined()
  })

  it('is refused when the name is longer than a name should be', () => {
    expect(slotFromToken(slotToken('x'.repeat(500)))).toBeUndefined()
  })
})

describe('the payload a layout carries', () => {
  it('restores every slot exactly as the template stated it', () => {
    const slots = [
      slot({ name: 'title', label: 'Title', maxChars: 60 }),
      slot({
        name: 'example',
        label: 'Worked example',
        description: 'A runnable Python snippet, no more than eight lines.',
        maxWords: 40,
        required: true,
        multiline: true,
      }),
      slot({ name: 'points', kind: 'bullets', label: 'Points', maxItems: 5 }),
      slot({ name: 'figure', kind: 'image', label: 'Figure' }),
    ]
    // The claim EXP-8 exists to make: names, kinds, instructions and limits
    // come back, rather than being inferred from rectangles
    expect(parseSlotMetadata(encodeSlotMetadata(slots))).toEqual(slots)
  })

  it('states only what the template stated', () => {
    // A defaulted copy would read as an authored decision on re-import
    const encoded = encodeSlotMetadata([slot({ name: 'title' })])!
    expect(encoded).not.toContain('maxChars')
    expect(encoded).not.toContain('required')
  })

  it('is nothing for a layout with no slots', () => {
    // The whiteboard, and any decoration-only layout
    expect(encodeSlotMetadata([])).toBeUndefined()
  })

  it('names its version, so a later build knows what it is reading', () => {
    const encoded = encodeSlotMetadata([slot()])!
    expect(JSON.parse(encoded).slidemachine).toBe(SLOT_METADATA_VERSION)
  })
})

describe('a payload that cannot be trusted', () => {
  it('is nothing when it was never written', () => {
    expect(parseSlotMetadata(undefined)).toBeUndefined()
    expect(parseSlotMetadata('')).toBeUndefined()
  })

  it('is nothing when someone typed over it', () => {
    expect(parseSlotMetadata('Alt text for the title box')).toBeUndefined()
  })

  it('is nothing when it arrives half-eaten', () => {
    const encoded = encodeSlotMetadata([slot()])!
    expect(
      parseSlotMetadata(encoded.slice(0, encoded.length - 8)),
    ).toBeUndefined()
  })

  it('is nothing when it is JSON that is not ours', () => {
    expect(parseSlotMetadata('{"hello":"world"}')).toBeUndefined()
  })

  it('is nothing when it is from a version this build does not know', () => {
    // Guessing at an unknown shape is worse than inferring from geometry,
    // which is a path that is already tested and already lossy-but-honest
    const future = JSON.stringify({
      slidemachine: SLOT_METADATA_VERSION + 1,
      slots: [{ name: 'title', kind: 'text' }],
    })
    expect(parseSlotMetadata(future)).toBeUndefined()
  })

  it('is nothing when a slot has no name to be keyed by', () => {
    const nameless = JSON.stringify({
      slidemachine: SLOT_METADATA_VERSION,
      slots: [{ kind: 'text', label: 'Body' }],
    })
    expect(parseSlotMetadata(nameless)).toBeUndefined()
  })

  it('is nothing when it is far larger than a payload should be', () => {
    // A bounded reader: the field is user-editable, so its contents are input
    const huge = JSON.stringify({
      slidemachine: SLOT_METADATA_VERSION,
      slots: [{ name: 'title', label: 'x'.repeat(MAX_SLOT_PAYLOAD_BYTES) }],
    })
    expect(parseSlotMetadata(huge)).toBeUndefined()
  })

  it('gives a slot with no label its name to be known by', () => {
    const unlabelled = JSON.stringify({
      slidemachine: SLOT_METADATA_VERSION,
      slots: [{ name: 'figure', kind: 'image' }],
    })
    expect(parseSlotMetadata(unlabelled)).toEqual([
      { name: 'figure', kind: 'image', label: 'figure' },
    ])
  })

  it('reads a slot that states no kind as text', () => {
    // The same default inference uses, and the safe one: mistaking prose for
    // something specialized is worse than not recognizing it
    const bare = JSON.stringify({
      slidemachine: SLOT_METADATA_VERSION,
      slots: [{ name: 'body' }],
    })
    expect(parseSlotMetadata(bare)?.[0]?.kind).toBe('text')
  })
})

describe('a template too large for the field', () => {
  const many = (count: number, description?: string): SlotSpec[] =>
    Array.from({ length: count }, (_, i) =>
      slot({ name: `slot-${i}`, label: `Slot ${i}`, description }),
    )

  it('drops the authoring instructions and keeps the design', () => {
    const slots = many(60, 'x'.repeat(200))
    const encoded = encodeSlotMetadata(slots)!
    // A name, a kind and a limit restore a box exactly; an instruction only
    // steers what is written into it, so it is what goes first
    expect(Buffer.byteLength(encoded)).toBeLessThanOrEqual(
      MAX_SLOT_PAYLOAD_BYTES,
    )
    const parsed = parseSlotMetadata(encoded)!
    expect(parsed).toHaveLength(60)
    expect(parsed[0]?.description).toBeUndefined()
    expect(parsed[0]?.name).toBe('slot-0')
  })

  it('says nothing at all rather than half a design', () => {
    // Beyond what alt text can hold. Half a payload would restore some boxes
    // and infer others, which is worse than inferring all of them
    expect(encodeSlotMetadata(many(400))).toBeUndefined()
  })
})
