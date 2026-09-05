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
import {
  DEFAULT_TEXT_STYLES,
  LAYOUT_TYPES,
  TEXT_STYLE_ROLES,
  themeTextStyles,
} from '@slide-machine/shared'
import {
  getBuiltinTemplate,
  listBuiltinTemplates,
  loadBuiltinTemplates,
  layoutDescriptors,
} from './builtin'

describe('externalized templates', () => {
  it('loads the starter templates from server/config/templates', () => {
    const templates = listBuiltinTemplates()
    expect(templates.map(t => t.id).sort()).toEqual([
      'classic',
      'midnight',
      'nyu-bold',
      'nyu-elegant',
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
      // Every conventional layout is present with its budgets intact. A
      // template may also name layouts of its own (TMPL-9), so this is
      // containment rather than equality — `nyu-elegant` adds three.
      expect(template.layouts.map(l => l.type)).toEqual(
        expect.arrayContaining([...LAYOUT_TYPES]),
      )
      // A list layout budgets its points. Asserted on the RESOLVED limits
      // rather than on `constraints`, because that is what actually governs:
      // a box's own `maxChars`/`maxItems` wins over the layout's, and a
      // template that states them per box (as `nyu-elegant` does) need carry
      // no layout-level copy at all. The figures are each design's own
      // (TMPL-9), so this asserts a budget exists, not what it is.
      const list = layoutDescriptors(template).find(l => l.type === 'list')!
      const bullets = list.slots.find(s => s.kind === 'bullets')!
      expect(bullets.maxItems).toBeGreaterThan(0)
      expect(bullets.maxChars).toBeGreaterThan(0)

      // Prose AND points on one slide: `content` gives one and `list` the
      // other, so a slide wanting both had to drop the sentence of context
      // or write it as an extra point.
      const mixed = layoutDescriptors(template).find(
        l => l.type === 'content-list',
      )!
      expect(mixed.slots.map(slot => slot.kind)).toEqual(
        expect.arrayContaining(['text', 'bullets']),
      )
      // Resolved per box, for the reason given above.
      expect(
        mixed.slots.find(s => s.kind === 'bullets')!.maxItems,
      ).toBeGreaterThan(0)
      expect(
        mixed.slots.find(s => s.name === 'body')!.maxChars,
      ).toBeGreaterThan(0)
    }
  })

  it('keeps the original starters on the budgets they were designed to', () => {
    for (const id of ['classic', 'midnight', 'seminar']) {
      const list = getBuiltinTemplate(id)!.layouts.find(l => l.type === 'list')!
      expect(list.constraints?.maxBullets).toBe(6)
      expect(list.constraints?.maxBulletChars).toBe(70)
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

  it('rejects a positioned key naming a slot the layout does not declare', () => {
    // Client-side regression: TemplateEditor used to drop a box's SlotSpec on
    // delete without pruning the matching elementPositions entry, leaving a
    // template unsaveable. The server's job is to keep rejecting that shape
    // no matter which caller produces it.
    const dir = mkdtempSync(path.join(tmpdir(), 'tmpl-stale-pos-'))
    writeFileSync(
      path.join(dir, 'stale.json'),
      JSON.stringify({
        id: 'stale',
        name: 'Stale',
        theme: {},
        layouts: [
          {
            type: 'content',
            label: 'C',
            purpose: 'p',
            slots: ['title'],
            elementPositions: {
              title: { x: 0, y: 0, w: 1, h: 0.2 },
              body: { x: 0, y: 0.2, w: 1, h: 0.8 },
            },
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
    expect(() => loadBuiltinTemplates(dir)).toThrow(
      /positioned slot "body" is not declared by this layout/,
    )
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

  /**
   * The three original starters now state their type scale instead of
   * inheriting it (TMPL-9).
   *
   * Stating it is the whole point — a scale an author can see in the file and
   * edit in the design panel, and that each template can take in its own
   * direction. But a template someone is already teaching from must not move
   * because of it, so what they state has to be exactly what they drew before
   * they stated anything. That is a property worth ASSERTING rather than
   * eyeballing: `themeTextStyles` merges field by field against the app's
   * defaults, so a single number out of place restyles a shipped design
   * silently.
   */
  it('leaves the original starters drawing exactly as they did', () => {
    for (const id of ['classic', 'midnight', 'seminar']) {
      const template = getBuiltinTemplate(id)!
      expect(template.theme.textStyles).toBeDefined()
      const resolved = themeTextStyles(template.theme)
      // Against the defaults resolved the same way, so this compares two
      // fully-filled scales rather than a scale against a sparse literal.
      const before = themeTextStyles({})
      for (const role of TEXT_STYLE_ROLES) {
        expect(resolved[role]).toEqual(before[role])
      }
      // And nothing was invented: the roles stated are the roles that exist.
      expect(Object.keys(template.theme.textStyles as object).sort()).toEqual(
        [...TEXT_STYLE_ROLES].sort(),
      )
    }
  })

  it('states every field the default scale states', () => {
    // A role that stated only some of its fields would still resolve
    // correctly today and drift the moment a default changed underneath it.
    const classic = getBuiltinTemplate('classic')!
    const stated = classic.theme.textStyles as Record<
      string,
      Record<string, unknown>
    >
    for (const [role, spec] of Object.entries(DEFAULT_TEXT_STYLES)) {
      for (const key of Object.keys(spec)) {
        expect(stated[role]).toHaveProperty(key)
      }
    }
  })
})
