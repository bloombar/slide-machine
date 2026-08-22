/**
 * Whether a design's type scale survives leaving the app and coming back
 * (EXP-2/EXP-3, EXP-6/EXP-8).
 *
 * An import states a design's typography once, on the theme, and has each box
 * name the role it follows (`import/type-scale.ts`). That is a good deal more
 * fragile across a round trip than the arrangement it replaced: geometry is
 * numbers on a box and travels or does not, visibly, whereas a role is a
 * REFERENCE, and a reference survives only if both halves do. Lose
 * `theme.textStyles` and every box still names a role that no longer exists;
 * lose the box's `textStyle` and the theme still states a scale nothing
 * follows. Either way the design falls back to `DEFAULT_TEXT_STYLES` and comes
 * back subtly restyled rather than broken — no error, no missing box, just
 * different type. Nothing else in the suite would notice.
 *
 * So these assert **resolved equivalence** rather than equality of the stored
 * shape: every box is read the way the renderer and the exporters read it,
 * through `themeTextStyles` and `resolveStyle`, before and after the trip. A
 * refactor is free to move a value between the theme and the box — that is
 * the thing the scale exists to do — and is not free to change what any box
 * ends up set in.
 */
import { describe, it, expect } from 'vitest'
import {
  themeTextStyles,
  type Layout,
  type BoxStyle,
} from '@slide-machine/shared'
import { resolveStyle } from './tree-boxes'
import { templateToYaml } from './template-yaml'
import { parseTemplateImport } from './template-import'
import { encodeSlotMetadata, parseSlotMetadata } from './slot-metadata'
import { buildTemplate } from '../import/build-template'
import type { CandidateSlot } from '../import/candidate'
import type { DerivedLayout } from '../import/consolidate'
import type { SourcePresentation } from '../import/source-presentation'

const slot = (
  name: string,
  box: { x: number; y: number; w: number; h: number },
  over: Partial<CandidateSlot> = {},
): CandidateSlot => ({ name, kind: 'text', box, ...over })

/** A deck set on a real scale: a heading size, a reading size and a small
 * size, each used on more than one box, so the derivation has something to
 * recover rather than one box per size. */
const derived = (): DerivedLayout[] => [
  {
    slots: [
      slot(
        'title',
        { x: 0.08, y: 0.08, w: 0.84, h: 0.15 },
        {
          fontSize: 8,
          bold: true,
          color: '#57068c',
          fontFamily: 'Times New Roman',
        },
      ),
      slot('prose', { x: 0.08, y: 0.3, w: 0.84, h: 0.5 }, { fontSize: 3 }),
      slot(
        'caption',
        { x: 0.08, y: 0.86, w: 0.84, h: 0.08 },
        { fontSize: 1.6 },
      ),
    ],
    decoration: [],
    members: ['s1', 's2'],
    type: 'title-and-body',
  },
  {
    slots: [
      slot(
        'title',
        { x: 0.08, y: 0.08, w: 0.84, h: 0.15 },
        {
          fontSize: 8,
          bold: true,
          color: '#57068c',
          fontFamily: 'Times New Roman',
        },
      ),
      slot(
        'points',
        { x: 0.08, y: 0.3, w: 0.84, h: 0.5 },
        {
          kind: 'bullets',
          fontSize: 3,
        },
      ),
      slot(
        'caption',
        { x: 0.08, y: 0.86, w: 0.84, h: 0.08 },
        { fontSize: 1.6 },
      ),
    ],
    decoration: [],
    members: ['s3', 's4'],
    type: 'list',
  },
]

const source = (): SourcePresentation => ({
  id: 'p1',
  title: 'Rainwater harvesting',
  theme: {
    background: '#ffffff',
    text: '#1c2230',
    accent: '#57068c',
    muted: '#667085',
  },
  layouts: [],
  slides: [],
})

/** A template as the library stores one, built from a real import so its
 * scale is derived rather than hand-written — the case that would break. */
const imported = () => {
  const built = buildTemplate(source(), derived(), new Map())
  return {
    id: 't1',
    ownerId: 'u1',
    permalinkSlug: 'rainwater',
    name: built.name,
    renderMode: built.renderMode,
    theme: built.theme,
    layouts: built.layouts,
    visibility: 'private' as const,
    voteScore: 0,
    createdAt: '2026-08-22T00:00:00.000Z',
  }
}

/** Every box of every layout, resolved the way anything that draws them
 * resolves them: the role it names, with its own fields over the top. */
const typeOfEveryBox = (
  theme: Record<string, unknown>,
  layouts: Layout[],
): Record<string, BoxStyle> => {
  const styles = themeTextStyles(theme)
  const out: Record<string, BoxStyle> = {}
  for (const layout of layouts)
    for (const [name, box] of Object.entries(layout.elementPositions ?? {}))
      out[`${layout.type}.${name}`] = resolveStyle(box, styles)
  return out
}

describe('the scale an import derived', () => {
  it('is actually on the template, or these tests prove nothing', () => {
    // A guard on the fixture rather than on the code: if the derivation ever
    // stops emitting roles, every round-trip test below would keep passing
    // while comparing one styleless template against another
    const template = imported()
    expect(template.theme.textStyles).toBeDefined()
    const roles = template.layouts.flatMap(l =>
      Object.values(l.elementPositions ?? {}).map(b => b.textStyle),
    )
    expect(roles.filter(Boolean).length).toBeGreaterThan(0)
  })
})

describe('a template exported to YAML and imported back (EXP-2/EXP-3)', () => {
  const roundTrip = (template: ReturnType<typeof imported>) => {
    const result = parseTemplateImport(templateToYaml(template))
    if ('errors' in result) throw new Error(result.errors.join('; '))
    return result.data
  }

  it('comes back at all', () => {
    expect(roundTrip(imported()).layouts.length).toBeGreaterThan(0)
  })

  it('still states the deck’s typography once, on the theme', () => {
    const back = roundTrip(imported())
    expect(back.theme.textStyles).toEqual(imported().theme.textStyles)
  })

  it('keeps every box pointing at the role it followed', () => {
    const before = imported()
    const after = roundTrip(before)
    const roles = (layouts: Layout[]) =>
      layouts.flatMap(l =>
        Object.entries(l.elementPositions ?? {}).map(
          ([name, box]) => `${l.type}.${name}=${box.textStyle ?? ''}`,
        ),
      )
    expect(roles(after.layouts as Layout[])).toEqual(roles(before.layouts))
  })

  it('sets every box in exactly the type it was set in before', () => {
    // The assertion that matters: not where the value is stored, but what
    // each box ends up drawn in
    const before = imported()
    const after = roundTrip(before)
    expect(typeOfEveryBox(after.theme, after.layouts as Layout[])).toEqual(
      typeOfEveryBox(before.theme, before.layouts),
    )
  })

  it('does not quietly fall back to the app’s own default scale', () => {
    // The failure this file exists to catch looks like success: a template
    // that lost its scale still resolves, to `DEFAULT_TEXT_STYLES`
    const before = imported()
    const after = roundTrip(before)
    const stripped = typeOfEveryBox({}, after.layouts as Layout[])
    expect(typeOfEveryBox(after.theme, after.layouts as Layout[])).not.toEqual(
      stripped,
    )
  })
})

describe('what a template carries into Google Slides (EXP-8)', () => {
  const specsOf = (layout: Layout) => layout.slots

  it('brings a slot’s kind, instruction and limits back unchanged', () => {
    // What the payload is for, and what it does carry
    const layout = imported().layouts[0]!
    const encoded = encodeSlotMetadata(specsOf(layout))
    expect(encoded).toBeDefined()
    const back = parseSlotMetadata(encoded!)
    expect(back).toBeDefined()
    const byName = new Map(back!.map(s => [s.name, s]))
    for (const spec of specsOf(layout)) {
      expect(byName.get(spec.name)?.kind).toBe(spec.kind)
      expect(byName.get(spec.name)?.maxChars).toBe(spec.maxChars)
      expect(byName.get(spec.name)?.maxItems).toBe(spec.maxItems)
    }
  })

  it('says which text role each box follows, so the trip is lossless', () => {
    // EXP-8's promise is that the payload's presence makes a round trip
    // lossless. A design's typography is now a REFERENCE from each box to a
    // role on the theme, and `templateToPptx` resolves that reference away
    // before writing — every shape goes out in literal type, and the payload
    // (`slotSchema`) carries name, kind, label, instruction, limits and
    // options, with no field for a role and nothing anywhere for the theme's
    // `textStyles`. So a re-import cannot restore the scale. It derives a
    // fresh one from the flattened result, which is a different design.
    //
    // The loss is at the WRITER, not the reader: there is nowhere in the file
    // for the role to be. If it is later carried somewhere other than the
    // slot payload, update this to read it from there.
    const layout = imported().layouts[0]!
    const back = parseSlotMetadata(encodeSlotMetadata(specsOf(layout))!)
    const byName = new Map((back ?? []).map(s => [s.name, s]))
    for (const [name, box] of Object.entries(layout.elementPositions ?? {})) {
      if (!box.textStyle) continue
      const carried = byName.get(name) as Record<string, unknown> | undefined
      expect(
        carried?.textStyle,
        `the payload says nothing about "${name}" following "${box.textStyle}"`,
      ).toBe(box.textStyle)
    }
  })
})
