/**
 * Unit tests for the deck import parser/validator (EXP-3). A well-formed export
 * parses back to a structured deck; malformed input returns a readable list of
 * errors and never throws, so the caller can create nothing on failure.
 */
import { describe, it, expect } from 'vitest'
import YAML from 'yaml'
import { parseDeckImport } from './deck-import'

/** A minimal valid deck-export document, as `deckToYaml` would emit. */
const validDoc = {
  version: 1,
  kind: 'deck',
  title: 'Photosynthesis',
  templateId: 'classic',
  settings: { language: 'en', generationFreedom: 3, ttsVoice: 'emma' },
  slides: [
    { layout: 'title', title: 'Photosynthesis', body: 'Overview' },
    {
      layout: 'list',
      title: 'Steps',
      bullets: ['Light', 'Dark'],
      image: {
        ref: 'https://img/leaf.jpg',
        source: 'stock',
        caption: 'A leaf',
        attribution: { creator: 'Ada', license: 'CC BY' },
      },
    },
  ],
}

const asYaml = (doc: unknown): string => YAML.stringify(doc)

describe('parseDeckImport', () => {
  it('parses a well-formed deck export', () => {
    const result = parseDeckImport(asYaml(validDoc))
    expect('data' in result).toBe(true)
    if ('data' in result) {
      expect(result.data.title).toBe('Photosynthesis')
      expect(result.data.slides).toHaveLength(2)
      expect(result.data.settings?.generationFreedom).toBe(3)
      // Image reference, provenance, caption, and TASL attribution are
      // preserved (IMG-5 / read-only credit stays read-only on import).
      expect(result.data.slides[1]?.image?.ref).toBe('https://img/leaf.jpg')
      expect(result.data.slides[1]?.image?.source).toBe('stock')
      expect(result.data.slides[1]?.image?.attribution).toEqual({
        creator: 'Ada',
        license: 'CC BY',
      })
    }
  })

  it('strips unknown keys (incl. legacy seedMaterial) rather than failing', () => {
    const result = parseDeckImport(
      asYaml({
        ...validDoc,
        futureField: 'x',
        seedMaterial: [{ name: 'old.pdf', type: 'pdf', text: 'secret' }],
        settings: { ...validDoc.settings, seedNotes: 'private' },
      }),
    )
    expect('data' in result).toBe(true)
    if ('data' in result) {
      const data = result.data as Record<string, unknown>
      expect(data.futureField).toBeUndefined()
      // Legacy seed data in an older file is ignored, never restored.
      expect(data.seedMaterial).toBeUndefined()
      expect(
        (result.data.settings as Record<string, unknown> | undefined)
          ?.seedNotes,
      ).toBeUndefined()
    }
  })

  it('rejects input that is not valid YAML', () => {
    const result = parseDeckImport(': : not: valid: - yaml:\n  - [')
    expect('errors' in result).toBe(true)
    if ('errors' in result) expect(result.errors[0]).toMatch(/valid YAML/)
  })

  it('rejects a non-mapping document (e.g. a bare list)', () => {
    const result = parseDeckImport('- a\n- b\n')
    expect('errors' in result).toBe(true)
  })

  it('names a design file for what it is, and where it belongs', () => {
    // The likeliest wrong file here: both are .yaml and this app wrote both.
    // Four schema violations that never say "template" tell the instructor
    // nothing they can act on
    const result = parseDeckImport(asYaml({ ...validDoc, kind: 'template' }))
    expect('errors' in result).toBe(true)
    if ('errors' in result) {
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toMatch(/design file, not a lecture/i)
      expect(result.errors[0]).toMatch(/design tab/i)
    }
  })

  it('still refuses a document of no recognised kind at all', () => {
    const result = parseDeckImport(asYaml({ ...validDoc, kind: 'quiz' }))
    expect('errors' in result).toBe(true)
  })

  it('rejects a missing title', () => {
    const { title, ...noTitle } = validDoc
    void title
    const result = parseDeckImport(asYaml(noTitle))
    expect('errors' in result).toBe(true)
    if ('errors' in result)
      expect(result.errors.some(e => e.includes('title'))).toBe(true)
  })

  it('rejects an unknown slide layout', () => {
    const bad = {
      ...validDoc,
      slides: [{ layout: 'carousel', title: 'X' }],
    }
    const result = parseDeckImport(asYaml(bad))
    expect('errors' in result).toBe(true)
    if ('errors' in result)
      expect(result.errors.some(e => e.includes('layout'))).toBe(true)
  })

  it('rejects a non-numeric version', () => {
    const result = parseDeckImport(asYaml({ ...validDoc, version: 'one' }))
    expect('errors' in result).toBe(true)
    if ('errors' in result)
      expect(result.errors.some(e => e.includes('version'))).toBe(true)
  })

  it('collects multiple problems at once', () => {
    const result = parseDeckImport(
      asYaml({ kind: 'deck', slides: 'not-an-array' }),
    )
    expect('errors' in result).toBe(true)
    if ('errors' in result) expect(result.errors.length).toBeGreaterThan(1)
  })
})
