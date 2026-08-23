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
  textStylesBySlot,
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
    const encoded = encodeSlotMetadata(
      specsOf(layout),
      textStylesBySlot(layout),
    )
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
    const back = parseSlotMetadata(
      encodeSlotMetadata(specsOf(layout), textStylesBySlot(layout))!,
    )
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

/**
 * What happens when a re-imported file states a role (EXP-8).
 *
 * Being told which role a box followed beats deriving it — the file went out
 * in literal type, so a derivation can only recover a scale that RESEMBLES
 * the one that left. But a role name is only worth honouring if the scale it
 * names says the same thing, and these are the three ways that can go wrong.
 */
describe('a role restored from an exported file', () => {
  const builtFrom = (slots: CandidateSlot[]) =>
    buildTemplate(
      source(),
      [{ slots, decoration: [], members: ['s1'] }],
      new Map(),
    )

  /** A design with a real scale — a heading size and a reading size — plus
   * whatever box the case under test needs. */
  const around = (extra: CandidateSlot) => [
    ...[1, 2, 3].map(i =>
      slot(
        `headline-${i}`,
        { x: 0.08, y: 0.08, w: 0.84, h: 0.15 },
        {
          fontSize: 8,
        },
      ),
    ),
    ...[1, 2, 3].map(i =>
      slot(`prose-${i}`, { x: 0.08, y: 0.3, w: 0.84, h: 0.5 }, { fontSize: 3 }),
    ),
    extra,
  ]

  const typeOf = (built: ReturnType<typeof builtFrom>, name: string) =>
    resolveStyle(
      built.layouts[0]!.elementPositions![name],
      themeTextStyles(built.theme),
    )

  it('imports a file that records no role exactly as it always did', () => {
    // Every deck exported before the role was carried has a payload without
    // one. A fix that made new exports lossless while changing how old ones
    // import would be worse than the defect it fixed.
    const legacy = slot(
      'legacy',
      { x: 0.08, y: 0.3, w: 0.4, h: 0.5 },
      {
        fontSize: 3,
        restored: { name: 'legacy', kind: 'text', label: 'Legacy' },
      },
    )
    const built = builtFrom(around(legacy))
    const plain = builtFrom(
      around(
        slot('legacy', { x: 0.08, y: 0.3, w: 0.4, h: 0.5 }, { fontSize: 3 }),
      ),
    )
    expect(typeOf(built, 'legacy')).toEqual(typeOf(plain, 'legacy'))
    expect(typeOf(built, 'legacy').fontSize).toBe(3)
  })

  it('ignores a role the derived scale has nothing behind', () => {
    // A name with no style behind it resolves against DEFAULT_TEXT_STYLES,
    // which would restyle the box — `quote` would arrive italic at 4cqi
    const aside = slot(
      'sidebar',
      { x: 0.08, y: 0.3, w: 0.4, h: 0.5 },
      {
        fontSize: 3,
        restored: {
          name: 'sidebar',
          kind: 'text',
          label: 'Quoted',
          textStyle: 'quote',
        },
      },
    )
    const built = builtFrom(around(aside))
    expect(built.theme.textStyles).not.toHaveProperty('quote')
    expect(typeOf(built, 'sidebar').italic).not.toBe(true)
    expect(typeOf(built, 'sidebar').fontSize).toBe(3)
  })

  it('keeps the type a box was measured in when its role says otherwise', () => {
    // A box that followed `title` while overriding the size — a small title —
    // comes back measured at its own size, and the re-derivation puts it in
    // the reading-size cluster. Honouring the recorded role is right; what it
    // must not do is hand the box the role's size, because the box was
    // subtracted against the role the derivation gave it, not the one the
    // file named. Otherwise a 3cqi box re-imports at 8.
    const small = slot(
      'small-title',
      { x: 0.08, y: 0.3, w: 0.4, h: 0.5 },
      {
        fontSize: 3,
        restored: {
          name: 'small-title',
          kind: 'text',
          label: 'Small title',
          textStyle: 'title',
        },
      },
    )
    const built = builtFrom(around(small))
    expect(typeOf(built, 'small-title').fontSize).toBe(3)
  })

  it('does not let one oddly named box rename the role of the many', () => {
    // The anchor takes its name from its boxes "where they agree". Only boxes
    // whose name claims a role get a vote, so three boxes called `prose` are
    // silent and a single `quoted` one carries it unopposed — and the deck
    // loses `body` altogether, the role every layout and every generation
    // budget is written around.
    const odd = slot(
      'quoted',
      { x: 0.08, y: 0.3, w: 0.4, h: 0.5 },
      {
        fontSize: 3,
      },
    )
    const built = builtFrom(around(odd))
    expect(Object.keys(built.theme.textStyles as object)).toContain('body')
  })

  it('leaves a box alone when its role is the one it would have got', () => {
    // The common case, and the one a fix for the divergent case could quietly
    // break: where the derived role and the recorded role agree, being told
    // the role must change nothing at all. Asserted against the same box with
    // no record of a role rather than against literal values, so it holds
    // whatever the derivation decides the scale is.
    const box = { x: 0.08, y: 0.08, w: 0.84, h: 0.15 }
    const told = slot('headline-4', box, {
      fontSize: 8,
      restored: {
        name: 'headline-4',
        kind: 'text',
        label: 'Headline',
        textStyle: 'title',
      },
    })
    const untold = slot('headline-4', box, { fontSize: 8 })
    expect(typeOf(builtFrom(around(told)), 'headline-4')).toEqual(
      typeOf(builtFrom(around(untold)), 'headline-4'),
    )
    expect(typeOf(builtFrom(around(told)), 'headline-4').fontSize).toBe(8)
  })

  it('never leaves a box naming a role the theme does not define', () => {
    // The door either fix could reopen. A box naming a role with nothing
    // behind it resolves against DEFAULT_TEXT_STYLES — which is the silent
    // restyling both defects were, arriving through a third entrance. Held
    // over a deck that exercises every path into a role at once: derived,
    // restored-and-defined, restored-and-undefined, and a list.
    const built = builtFrom([
      ...[1, 2, 3].map(i =>
        slot(
          `headline-${i}`,
          { x: 0.08, y: 0.08, w: 0.84, h: 0.15 },
          {
            fontSize: 8,
          },
        ),
      ),
      ...[1, 2, 3].map(i =>
        slot(
          `prose-${i}`,
          { x: 0.08, y: 0.3, w: 0.84, h: 0.5 },
          {
            fontSize: 3,
          },
        ),
      ),
      slot(
        'points',
        { x: 0.5, y: 0.3, w: 0.4, h: 0.5 },
        {
          kind: 'bullets',
          fontSize: 3,
        },
      ),
      slot(
        'told-known',
        { x: 0.08, y: 0.3, w: 0.4, h: 0.5 },
        {
          fontSize: 8,
          restored: {
            name: 'told-known',
            kind: 'text',
            label: 'Told',
            textStyle: 'title',
          },
        },
      ),
      slot(
        'told-unknown',
        { x: 0.5, y: 0.3, w: 0.4, h: 0.5 },
        {
          fontSize: 3,
          restored: {
            name: 'told-unknown',
            kind: 'text',
            label: 'Told',
            textStyle: 'quote',
          },
        },
      ),
      slot('tiny', { x: 0.08, y: 0.86, w: 0.84, h: 0.08 }, { fontSize: 1.6 }),
    ])
    const defined = Object.keys(
      (built.theme.textStyles ?? {}) as Record<string, unknown>,
    )
    const named = built.layouts.flatMap(layout =>
      Object.entries(layout.elementPositions ?? {}).flatMap(([name, box]) =>
        box.textStyle ? [[name, box.textStyle] as const] : [],
      ),
    )
    // The deck has roles at all, or this asserts nothing
    expect(named.length).toBeGreaterThan(0)
    for (const [name, role] of named)
      expect(defined, `"${name}" names the role "${role}"`).toContain(role)
  })
})
