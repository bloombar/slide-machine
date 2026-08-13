/**
 * Unit tests for the template YAML importer (EXP-3).
 *
 * The round trip is the point: EXP-3 calls it "a stated guarantee, not a
 * hope", so the first thing proved here is that a template exported and parsed
 * back comes out the same design — theme, layouts, slots, geometry and the
 * bands and logos drawn behind them. The rest is refusal: a template that
 * cannot be restored faithfully must say so rather than substitute anything.
 */
import { describe, it, expect } from 'vitest'
import type { Template } from '@slide-machine/shared'
import { templateToYaml } from './template-yaml'
import {
  parseTemplateImport,
  layoutsWithWhiteboard,
  decorationImages,
  repointDecoration,
} from './template-import'

/** A design with something of everything the format carries. */
const template: Template = {
  id: 'classic',
  ownerId: 'author-1',
  permalinkSlug: 'classic',
  name: 'Classic',
  renderMode: 'positioned',
  theme: { background: '#fefce8', accent: '#b45309', text: '#1c1917' },
  layouts: [
    {
      type: 'title',
      label: 'Title',
      purpose: 'Opening slide',
      slots: [
        {
          name: 'title',
          kind: 'text',
          label: 'Title',
          description: 'The lecture’s name, as the class will hear it.',
          maxChars: 60,
          required: true,
        },
      ],
      elementPositions: {
        title: { x: 0.08, y: 0.4, w: 0.84, h: 0.2, fontSize: 7 },
      },
      decoration: [
        { x: 0, y: 0, w: 1, h: 0.1, fill: '#b45309' },
        {
          x: 0.86,
          y: 0.03,
          w: 0.1,
          h: 0.08,
          imageUrl: 'https://cdn.example.com/logo.png',
        },
      ],
      guides: { x: [0.08, 0.92], y: [0.4] },
    },
    {
      type: 'whiteboard',
      label: 'Whiteboard',
      purpose: 'A blank slate for freehand drawing',
      slots: [],
      elementPositions: {},
    },
  ],
  visibility: 'public',
  voteScore: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
}

/** The file the exporter writes for it. */
const exported = (over: Partial<Template> = {}): string =>
  templateToYaml({ ...template, ...over })

describe('the round trip EXP-3 guarantees', () => {
  it('gives back the design that was exported', () => {
    const parsed = parseTemplateImport(exported())
    expect('data' in parsed).toBe(true)
    if (!('data' in parsed)) return
    // Not "some layouts came back" — the same ones, in full
    expect(parsed.data.layouts).toEqual(template.layouts)
    expect(parsed.data.theme).toEqual(template.theme)
    expect(parsed.data.name).toBe('Classic')
    expect(parsed.data.renderMode).toBe('positioned')
  })

  it('gives back every slot’s kind, instruction and limits (TMPL-10)', () => {
    // The half of the guarantee geometry cannot carry: what each box is for
    const parsed = parseTemplateImport(exported())
    if (!('data' in parsed)) throw new Error('expected a parsed template')
    expect(parsed.data.layouts[0]!.slots[0]).toMatchObject({
      kind: 'text',
      description: 'The lecture’s name, as the class will hear it.',
      maxChars: 60,
      required: true,
    })
  })

  it('gives back the bands and logos drawn behind the slots', () => {
    const parsed = parseTemplateImport(exported())
    if (!('data' in parsed)) throw new Error('expected a parsed template')
    expect(parsed.data.layouts[0]!.decoration).toEqual(
      template.layouts[0]!.decoration,
    )
  })
})

describe('what an import refuses to carry over', () => {
  it('takes no id from the file, since the copy is a new template', () => {
    const parsed = parseTemplateImport(exported())
    if (!('data' in parsed)) throw new Error('expected a parsed template')
    expect(parsed.data).not.toHaveProperty('id')
  })

  it('takes no visibility, so nothing is published on the author’s behalf', () => {
    // The file says public; an import is a thing its new owner reviews first
    const parsed = parseTemplateImport(exported())
    if (!('data' in parsed)) throw new Error('expected a parsed template')
    expect(parsed.data).not.toHaveProperty('visibility')
  })
})

describe('a file that cannot be trusted', () => {
  it('says so rather than throwing, when it is not YAML at all', () => {
    const parsed = parseTemplateImport('{ this: is: not: yaml')
    expect(parsed).toEqual({ errors: ['document: not valid YAML'] })
  })

  it('says so when it is YAML but not a mapping', () => {
    expect(parseTemplateImport('- a\n- b')).toEqual({
      errors: ['document: expected a YAML mapping'],
    })
  })

  it('refuses a deck export, which is a different document', () => {
    const parsed = parseTemplateImport(
      'version: 1\nkind: deck\ntitle: Week 1\n',
    )
    expect('errors' in parsed).toBe(true)
  })

  it('refuses a template with no layouts, which is not a design', () => {
    const parsed = parseTemplateImport(
      'version: 1\nkind: template\nname: Empty\ntheme: {}\nlayouts: []\n',
    )
    expect('errors' in parsed).toBe(true)
  })

  it('collects every problem at once, rather than one per attempt', () => {
    // A total check: the author fixes the file once instead of round-tripping
    // through the importer for each mistake
    const parsed = parseTemplateImport('version: 1\nkind: template\n')
    if (!('errors' in parsed)) throw new Error('expected errors')
    expect(parsed.errors.length).toBeGreaterThan(1)
    expect(parsed.errors.join(' ')).toMatch(/name/)
  })

  it('reads a newer file, the format being additive', () => {
    // EXP-3: older exports stay readable, so version is checked as a number
    // and not pinned, and unknown keys are ignored rather than fatal
    const doc = `${exported()}\nsomethingNew: true\n`
    expect('data' in parseTemplateImport(doc)).toBe(true)
  })
})

describe('the blank slate every template owes (TMPL-7)', () => {
  it('is kept when the file has one', () => {
    const parsed = parseTemplateImport(exported())
    if (!('data' in parsed)) throw new Error('expected a parsed template')
    const layouts = layoutsWithWhiteboard(parsed.data)
    expect(layouts.filter(l => l.type === 'whiteboard')).toHaveLength(1)
  })

  it('is synthesized when it has none, inventing no design', () => {
    const parsed = parseTemplateImport(
      exported({ layouts: [template.layouts[0]!] }),
    )
    if (!('data' in parsed)) throw new Error('expected a parsed template')
    const layouts = layoutsWithWhiteboard(parsed.data)
    expect(layouts).toHaveLength(2)
    expect(layouts.at(-1)).toMatchObject({ type: 'whiteboard', slots: [] })
  })
})

describe('the pictures a design refers to', () => {
  it('are found in the decoration, which is the only place one is named', () => {
    expect(decorationImages(template.layouts)).toEqual([
      'https://cdn.example.com/logo.png',
    ])
  })

  it('are listed once however many layouts share them', () => {
    const shared = [
      template.layouts[0]!,
      { ...template.layouts[0]!, type: 'list' },
    ]
    expect(decorationImages(shared)).toHaveLength(1)
  })

  it('are none when a design is drawn only in colour', () => {
    const plain = [
      {
        ...template.layouts[0]!,
        decoration: [{ x: 0, y: 0, w: 1, h: 0.1, fill: '#b45309' }],
      },
    ]
    expect(decorationImages(plain)).toEqual([])
  })

  it('point at the importer’s own copy once stored', () => {
    // Pointing at the exporting library's files would break the moment its
    // owner deletes them, and would be swept as theirs, not ours (P-11)
    const stored = new Map([
      ['https://cdn.example.com/logo.png', 'https://cdn.example.com/mine.png'],
    ])
    const repointed = repointDecoration(template.layouts, stored)
    expect(repointed[0]!.decoration![1]!.imageUrl).toBe(
      'https://cdn.example.com/mine.png',
    )
    // The band beside it is untouched: it names no file
    expect(repointed[0]!.decoration![0]).toEqual(
      template.layouts[0]!.decoration![0],
    )
  })

  it('leaves a layout that has no decoration exactly as it was', () => {
    const repointed = repointDecoration(template.layouts, new Map())
    expect(repointed[1]).toEqual(template.layouts[1])
  })
})
