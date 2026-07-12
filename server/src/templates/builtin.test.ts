/**
 * Unit tests for the externalized template loader: the real files in
 * server/config/templates load and validate, all seven conventional
 * layouts carry word budgets, and malformed files fail loudly.
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
        expect.arrayContaining(['background', 'text', 'accent']),
      )
      // Every conventional layout is present with its budgets intact
      expect(template.layouts.map(l => l.type).sort()).toEqual(
        [...LAYOUT_TYPES].sort(),
      )
      const list = template.layouts.find(l => l.type === 'list')!
      expect(list.constraints?.maxBullets).toBe(6)
      expect(list.constraints?.maxBulletWords).toBe(12)
    }
  })

  it('serves lookups and descriptors from the loaded files', () => {
    expect(getBuiltinTemplate('midnight')?.name).toBe('Midnight')
    expect(getBuiltinTemplate('nope')).toBeUndefined()
    const descriptors = layoutDescriptors(getBuiltinTemplate('classic')!)
    expect(descriptors).toHaveLength(7)
    expect(descriptors[0]).not.toHaveProperty('elementPositions')
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
