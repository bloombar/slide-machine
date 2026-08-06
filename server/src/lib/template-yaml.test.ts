/**
 * Unit tests for the template YAML serializer (EXP-2): a style template exports
 * to a versioned, human-readable YAML capturing its identity, theme, and
 * layouts, and parses back cleanly.
 */
import { describe, it, expect } from 'vitest'
import YAML from 'yaml'
import type { Template } from '@slide-machine/shared'
import { templateToYaml, TEMPLATE_YAML_VERSION } from './template-yaml'

const template: Template = {
  id: 'classic',
  ownerId: 'system',
  permalinkSlug: 'classic',
  name: 'Classic',
  theme: { background: '#fefce8', accent: '#b45309', text: '#1c1917' },
  layouts: [
    {
      type: 'title',
      label: 'Title',
      purpose: 'Opening slide',
      slots: [{ name: 'title', kind: 'text', label: 'Title' }],
      elementPositions: {},
    },
    {
      type: 'list',
      label: 'List',
      purpose: 'Bulleted points',
      slots: [
        { name: 'title', kind: 'text', label: 'Title' },
        { name: 'bullets', kind: 'bullets', label: 'Bullets' },
      ],
      constraints: { maxBullets: 6 },
      elementPositions: {},
    },
  ],
  visibility: 'public',
  voteScore: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
}

describe('templateToYaml', () => {
  it('serializes identity, theme, and layouts', () => {
    const parsed = YAML.parse(templateToYaml(template))
    expect(parsed.version).toBe(TEMPLATE_YAML_VERSION)
    expect(parsed.kind).toBe('template')
    expect(parsed.id).toBe('classic')
    expect(parsed.name).toBe('Classic')
    expect(parsed.theme.accent).toBe('#b45309')
    expect(parsed.layouts).toHaveLength(2)
    expect(parsed.layouts[1]).toMatchObject({
      type: 'list',
      purpose: 'Bulleted points',
      constraints: { maxBullets: 6 },
    })
  })

  it('omits constraints when a layout has none', () => {
    const parsed = YAML.parse(templateToYaml(template))
    expect(parsed.layouts[0].constraints).toBeUndefined()
  })
})
