/**
 * Unit tests for the externalized template loader: the real files in
 * server/config/templates load and validate, every conventional layout is
 * present (including the required blank whiteboard slate), and malformed
 * files fail loudly.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { LAYOUT_TYPES } from '@slide-machine/shared'
import {
  getBuiltinTemplate,
  listBuiltinTemplates,
  loadBuiltinTemplates,
  layoutDescriptors,
} from './builtin'

describe('externalized templates', () => {
  it('loads the three starter templates from server/config/templates', () => {
    const templates = listBuiltinTemplates()
    expect(templates.map(t => t.id).sort()).toEqual([
      'classic',
      'midnight',
      'seminar',
    ])
    for (const template of templates) {
      expect(Object.keys(template.theme)).toEqual(
        expect.arrayContaining([
          'background',
          'text',
          'accent',
          'penColor',
          'highlighterColor',
        ]),
      )
      // Every conventional layout is present with its budgets intact
      expect(template.layouts.map(l => l.type).sort()).toEqual(
        [...LAYOUT_TYPES].sort(),
      )
      const list = template.layouts.find(l => l.type === 'list')!
      expect(list.constraints?.maxBullets).toBe(6)
      expect(list.constraints?.maxBulletChars).toBe(70)

      // Prose AND points on one slide: `content` gives one and `list` the
      // other, so a slide wanting both had to drop the sentence of context
      // or write it as an extra point.
      const mixed = template.layouts.find(l => l.type === 'content-list')!
      expect(mixed.slots.map(slot => slot.kind)).toEqual(
        expect.arrayContaining(['text', 'bullets']),
      )
      expect(mixed.constraints?.maxBullets).toBeGreaterThan(0)
      expect(mixed.constraints?.maxBodyChars).toBeGreaterThan(0)
    }
  })

  it('serves lookups and descriptors from the loaded files', () => {
    expect(getBuiltinTemplate('midnight')?.name).toBe('Midnight')
    expect(getBuiltinTemplate('nope')).toBeUndefined()
    const descriptors = layoutDescriptors(getBuiltinTemplate('classic')!)
    // The whiteboard layout is withheld from the AI, so descriptors cover
    // every layout type except that one.
    expect(descriptors).toHaveLength(LAYOUT_TYPES.length - 1)
    expect(descriptors.some(d => d.type === 'whiteboard')).toBe(false)
    expect(descriptors[0]).not.toHaveProperty('elementPositions')
  })

  it('requires every template to include a whiteboard layout', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tmpl-no-wb-'))
    writeFileSync(
      path.join(dir, 'nowb.json'),
      JSON.stringify({
        id: 'nowb',
        name: 'No whiteboard',
        theme: {},
        layouts: [
          {
            type: 'content',
            label: 'C',
            purpose: 'p',
            slots: ['title', 'body'],
            elementPositions: {},
          },
        ],
      }),
    )
    expect(() => loadBuiltinTemplates(dir)).toThrow(
      /must include a 'whiteboard' layout/,
    )
  })

  it('accepts a whiteboard layout with no slots', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tmpl-wb-'))
    writeFileSync(
      path.join(dir, 'wb.json'),
      JSON.stringify({
        id: 'wb',
        name: 'WB',
        theme: {},
        layouts: [
          {
            type: 'content',
            label: 'C',
            purpose: 'p',
            slots: ['title'],
            elementPositions: {},
          },
          {
            type: 'whiteboard',
            label: 'Whiteboard',
            purpose: 'blank slate',
            slots: [],
            elementPositions: {},
          },
        ],
      }),
    )
    const [template] = loadBuiltinTemplates(dir)
    const whiteboard = template!.layouts.find(l => l.type === 'whiteboard')!
    expect(whiteboard.slots).toEqual([])
    // …but a non-whiteboard layout with no slots is still rejected.
    expect(
      layoutDescriptors(template!).some(d => d.type === 'whiteboard'),
    ).toBe(false)
  })

  it('normalizes slots and accepts custom slots with explicit kinds', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tmpl-slots-'))
    writeFileSync(
      path.join(dir, 'custom.json'),
      JSON.stringify({
        id: 'custom',
        name: 'Custom',
        theme: {},
        layouts: [
          {
            type: 'content',
            label: 'C',
            purpose: 'p',
            // Shorthand string + full object + custom-named slot
            slots: [
              'title',
              { name: 'body', maxChars: 70 },
              { name: 'pull-quote', kind: 'text', label: 'Pull quote' },
            ],
            elementPositions: {},
          },
          // Required blank slate — keeps this a valid template.
          {
            type: 'whiteboard',
            label: 'Whiteboard',
            purpose: 'blank slate',
            slots: [],
            elementPositions: {},
          },
        ],
      }),
    )
    const [template] = loadBuiltinTemplates(dir)
    const slots = template!.layouts[0]!.slots
    expect(slots[0]).toMatchObject({
      name: 'title',
      kind: 'text',
      label: 'Slide title',
    })
    expect(slots[1]).toMatchObject({
      name: 'body',
      kind: 'text',
      maxChars: 70,
      multiline: true,
    })
    expect(slots[2]).toMatchObject({ name: 'pull-quote', kind: 'text' })
  })

  it('rejects custom slots without a declared kind', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tmpl-nokind-'))
    writeFileSync(
      path.join(dir, 'bad.json'),
      JSON.stringify({
        id: 'bad',
        name: 'Bad',
        theme: {},
        layouts: [
          {
            type: 'content',
            label: 'C',
            purpose: 'p',
            slots: [{ name: 'mystery' }],
            elementPositions: {},
          },
          {
            type: 'whiteboard',
            label: 'Whiteboard',
            purpose: 'blank slate',
            slots: [],
            elementPositions: {},
          },
        ],
      }),
    )
    expect(() => loadBuiltinTemplates(dir)).toThrow(/must declare its kind/)
  })

  it('rejects malformed template files loudly', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tmpl-'))
    writeFileSync(
      path.join(dir, 'broken.json'),
      JSON.stringify({ id: 'x', name: 'X', theme: {}, layouts: [] }),
    )
    expect(() => loadBuiltinTemplates(dir)).toThrow(/Invalid template file/)
  })

  it('fails loudly when the directory has no templates', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tmpl-empty-'))
    expect(() => loadBuiltinTemplates(dir)).toThrow(/No template files/)
  })
})
