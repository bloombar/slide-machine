/**
 * Unit tests for slot metadata (TMPL-10): the authoring instruction a template
 * writes for each box, its limits, whether it is required, and its
 * kind-specific options.
 *
 * The two properties that matter most are that an instruction survives the
 * loader intact — it is the whole mechanism by which a subject-specific
 * template produces subject-appropriate slides — and that it stays *data*: it
 * is length-capped, and the system's own limits hold whatever it says.
 */
import { describe, it, expect } from 'vitest'
import { MAX_SLOT_DESCRIPTION } from '@slide-machine/shared'
import { layoutSchema, normalizeSlot } from './builtin'

/** A layout carrying one authored box, parsed the way the loader parses it —
 * which is where the schema's caps actually apply. */
const parseLayoutWith = (slot: Record<string, unknown>) =>
  layoutSchema.safeParse({
    type: 'content',
    label: 'Content',
    purpose: 'body text',
    slots: [slot],
    elementPositions: {},
  })

describe('an authoring instruction', () => {
  it('survives the loader as the author wrote it', () => {
    const spec = normalizeSlot({
      name: 'example',
      kind: 'text',
      label: 'Worked example',
      description: 'A runnable Python snippet, no more than eight lines.',
    })
    expect(spec.description).toBe(
      'A runnable Python snippet, no more than eight lines.',
    )
  })

  it('is absent rather than blank when the author wrote none', () => {
    const spec = normalizeSlot({ name: 'body', kind: 'text', label: 'Body' })
    // An empty string would be sent to the model as an empty quotation
    expect(spec.description).toBeUndefined()
  })

  it('is dropped when it is only whitespace', () => {
    const spec = normalizeSlot({
      name: 'body',
      kind: 'text',
      label: 'Body',
      description: '   ',
    })
    expect(spec.description).toBeUndefined()
  })

  it('is refused when it runs past the cap', () => {
    // Untrusted author text on a per-phrase prompt: bounded, not trusted
    const over = parseLayoutWith({
      name: 'body',
      kind: 'text',
      label: 'Body',
      description: 'x'.repeat(MAX_SLOT_DESCRIPTION + 1),
    })
    expect(over.success).toBe(false)
  })

  it('accepts one exactly at the cap', () => {
    const at = parseLayoutWith({
      name: 'body',
      kind: 'text',
      label: 'Body',
      description: 'x'.repeat(MAX_SLOT_DESCRIPTION),
    })
    expect(at.success).toBe(true)
  })
})

describe('the rest of a box’s metadata', () => {
  it('carries limits, required, and kind-specific options', () => {
    const spec = normalizeSlot({
      name: 'example',
      kind: 'text',
      label: 'Worked example',
      maxChars: 400,
      maxWords: 60,
      required: true,
      options: { language: 'python' },
    })
    expect(spec).toMatchObject({
      maxChars: 400,
      maxWords: 60,
      required: true,
      options: { language: 'python' },
    })
  })

  it('leaves a conventional slot’s shorthand alone', () => {
    // `title` expands from the shared defaults and carries no instruction
    const spec = normalizeSlot('title')
    expect(spec).toMatchObject({ name: 'title', kind: 'text' })
    expect(spec.description).toBeUndefined()
    expect(spec.required).toBeUndefined()
  })

  it('refuses a limit that is not a positive whole number', () => {
    const negative = parseLayoutWith({
      name: 'body',
      kind: 'text',
      label: 'Body',
      maxWords: -5,
    })
    expect(negative.success).toBe(false)
  })
})
