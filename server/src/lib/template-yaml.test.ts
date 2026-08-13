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

  it('carries the tree the design is built from (EXP-2)', () => {
    // Without it the file says a layout has a picture box somewhere and
    // nothing about where — ingredients rather than a design
    const arranged: Template = {
      ...template,
      layouts: [
        {
          ...template.layouts[0]!,
          slots: [
            { name: 'title', kind: 'text', label: 'Title' },
            { name: 'image', kind: 'image', label: 'Image' },
          ],
          tree: {
            id: 'root',
            container: { mode: 'grid', columns: 2, gap: 4 },
            children: [
              { id: 't', slot: 'title', style: { textStyle: 'heading' } },
              { id: 'i', slot: 'image', height: 0.75 },
            ],
          },
        },
        ...template.layouts.slice(1),
      ],
    }
    const parsed = YAML.parse(templateToYaml(arranged))
    expect(parsed.layouts[0].tree).toMatchObject({
      container: { mode: 'grid', columns: 2 },
      children: [{ slot: 'title' }, { slot: 'image', height: 0.75 }],
    })
  })

  it('carries measured geometry and the guides its author worked to', () => {
    const measured: Template = {
      ...template,
      layouts: [
        {
          ...template.layouts[0]!,
          elementPositions: {
            title: { x: 0.06, y: 0.4, w: 0.88, h: 0.15, fontSize: 7 },
          },
          guides: { x: [0.06, 0.94], y: [0.1] },
        },
        ...template.layouts.slice(1),
      ],
    }
    const parsed = YAML.parse(templateToYaml(measured))
    // Where each box sits AND how it is set: geometry without the type would
    // reconstruct the right rectangles holding the wrong slide
    expect(parsed.layouts[0].elementPositions.title).toMatchObject({
      x: 0.06,
      w: 0.88,
      fontSize: 7,
    })
    expect(parsed.layouts[0].guides).toMatchObject({ x: [0.06, 0.94] })
  })

  it('carries the bands, rules and logos a design is drawn with (EXP-3)', () => {
    // A deck imported from Google Slides keeps its logo and its colour bands
    // as decoration, so a file without them exports the template without the
    // pieces that make it recognizable
    const decorated: Template = {
      ...template,
      layouts: [
        {
          ...template.layouts[0]!,
          decoration: [
            { x: 0, y: 0, w: 1, h: 0.12, fill: '#123456' },
            {
              x: 0.86,
              y: 0.04,
              w: 0.1,
              h: 0.1,
              imageUrl: 'https://cdn.example.com/logo.png',
            },
          ],
        },
        ...template.layouts.slice(1),
      ],
    }
    const parsed = YAML.parse(templateToYaml(decorated))
    expect(parsed.layouts[0].decoration).toHaveLength(2)
    expect(parsed.layouts[0].decoration[0]).toMatchObject({
      h: 0.12,
      fill: '#123456',
    })
    expect(parsed.layouts[0].decoration[1]).toMatchObject({
      imageUrl: 'https://cdn.example.com/logo.png',
    })
  })

  it('says nothing about geometry a layout does not have', () => {
    // An empty map would read as "this layout has no boxes" rather than
    // "its boxes are in its tree"
    const parsed = YAML.parse(templateToYaml(template))
    expect(parsed.layouts[0].elementPositions).toBeUndefined()
    expect(parsed.layouts[0].tree).toBeUndefined()
    expect(parsed.layouts[0].guides).toBeUndefined()
    expect(parsed.layouts[0].decoration).toBeUndefined()
  })

  it('carries each slot’s instruction and limits (TMPL-10)', () => {
    const authored: Template = {
      ...template,
      layouts: [
        {
          ...template.layouts[0]!,
          slots: [
            {
              name: 'example',
              kind: 'text',
              label: 'Worked example',
              description: 'A runnable snippet, no more than eight lines.',
              maxWords: 40,
              required: true,
            },
          ],
        },
      ],
    }
    const parsed = YAML.parse(templateToYaml(authored))
    expect(parsed.layouts[0].slots[0]).toMatchObject({
      name: 'example',
      description: 'A runnable snippet, no more than eight lines.',
      maxWords: 40,
      required: true,
    })
  })
})
