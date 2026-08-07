/**
 * Unit tests for exporting a style template as a .pptx (EXP-6).
 *
 * The claim worth testing is structural: the template's layouts must become
 * the presentation's **slide masters**, because that is what Drive converts
 * into native Google Slides layouts. A file that merely looked right but had
 * no masters would be a picture of a template rather than a template.
 *
 * A .pptx is a zip of XML parts, so the assertions read the parts it contains.
 */
import { describe, it, expect } from 'vitest'
import type { Template } from '@slide-machine/shared'
import { templateToPptx } from './template-pptx'

/** The distinct XML parts of a kind inside the generated file. */
const parts = (bytes: Uint8Array, pattern: RegExp): Set<string> =>
  new Set(Buffer.from(bytes).toString('latin1').match(pattern) ?? [])

const masters = (bytes: Uint8Array) => parts(bytes, /slideMaster\d+\.xml/g)
const slides = (bytes: Uint8Array) => parts(bytes, /slides\/slide\d+\.xml/g)

const layout = (
  type: string,
  slots: { name: string; kind?: 'text' | 'bullets' | 'image' }[],
) => ({
  type,
  label: type,
  purpose: `use for ${type}`,
  slots: slots.map(s => ({
    name: s.name,
    kind: s.kind ?? ('text' as const),
    label: s.name,
  })),
  elementPositions: Object.fromEntries(
    slots.map((s, i) => [
      s.name,
      { x: 0.06, y: 0.06 + i * 0.3, w: 0.88, h: 0.25 },
    ]),
  ),
})

const template = (over: Partial<Template> = {}): Template =>
  ({
    id: 't1',
    ownerId: 'u1',
    name: 'Mine',
    theme: { background: '#ffffff', text: '#111111', accent: '#0055ff' },
    layouts: [
      layout('title', [{ name: 'title' }]),
      layout('content', [{ name: 'title' }, { name: 'body' }]),
      layout('whiteboard', []),
    ],
    visibility: 'private',
    voteScore: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }) as Template

describe('a template exported as a presentation', () => {
  it('is a real .pptx', async () => {
    const bytes = await templateToPptx(template())
    // Zip local-file header: what Drive needs before it will convert
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
    expect(bytes.length).toBeGreaterThan(1000)
  })

  it('turns each layout into a slide master', async () => {
    const bytes = await templateToPptx(template())
    // Masters are what Drive converts into native Slides layouts — the whole
    // mechanism by which an exported template is a template over there
    expect(masters(bytes).size).toBe(2)
  })

  it('shows each layout on a demonstration slide', async () => {
    const bytes = await templateToPptx(template())
    // A deck of invisible placeholders would be useless to open
    expect(slides(bytes).size).toBe(2)
  })

  it('leaves the whiteboard layout out (TMPL-7)', async () => {
    const withWhiteboard = await templateToPptx(template())
    const without = await templateToPptx(
      template({
        layouts: template().layouts.filter(l => l.type !== 'whiteboard'),
      }),
    )
    // It is an app-only blank slate with no design to carry, and is
    // re-synthesized on import
    expect(masters(withWhiteboard).size).toBe(masters(without).size)
  })

  it('names each master after the layout, so Slides shows it', async () => {
    const bytes = await templateToPptx(
      template({ layouts: [layout('lab-safety', [{ name: 'title' }])] }),
    )
    expect(Buffer.from(bytes).toString('latin1')).toContain('LAB-SAFETY')
  })

  it('carries the author’s own words as each box’s prompt', async () => {
    const withLabels = template()
    withLabels.layouts[1]!.slots[1]!.label = 'Worked example'
    const bytes = await templateToPptx(withLabels)
    // A layout explains itself in Slides rather than showing "Click to add"
    expect(Buffer.from(bytes).toString('latin1')).toContain('Worked example')
  })

  it('still produces an openable file when nothing has geometry', async () => {
    const unplaced = {
      ...layout('content', [{ name: 'title' }]),
      elementPositions: {},
    }
    const bytes = await templateToPptx(
      template({ layouts: [unplaced] as Template['layouts'] }),
    )
    // A layout with no boxes placed contributes an empty master, not a wrong
    // one — better an honest blank than invented geometry
    expect(bytes[0]).toBe(0x50)
    expect(masters(bytes).size).toBe(1)
  })

  it('produces a valid presentation for a whiteboard-only template', async () => {
    const bytes = await templateToPptx(
      template({
        layouts: template().layouts.filter(l => l.type === 'whiteboard'),
      }),
    )
    // Nothing to export, but Drive refuses to convert an empty file
    expect(bytes[0]).toBe(0x50)
    expect(slides(bytes).size).toBe(1)
  })
})
