/**
 * Naming what the geometry found (TMPL-8 pass 5, docs/TEMPLATES.md §7).
 *
 * The first four passes know where every box sits and nothing about what any
 * of it means. This is the one pass a model is genuinely better at than
 * arithmetic: seeing that a wide box at the top with a big word in it and a
 * list below is a `title-and-bullets` slide, and that the same shape mirrored
 * is still `two-column`.
 *
 * ## The model cannot break a template
 *
 * It is asked for **names and sentences only** — never geometry, never a box.
 * A wrong answer mislabels a layout, which an author fixes by typing; it can
 * never produce a template that draws incorrectly. And when the call fails, is
 * unconfigured, or returns nonsense, the rules below name everything and the
 * import carries on. An import never depends on a model being available.
 *
 */
import type { ImportedLayoutDescriptor } from '@slide-machine/shared'
import type { DerivedLayout, LayoutSemantics } from './consolidate'

/**
 * The layouts as the provider is given them: geometry, nothing else.
 *
 * The prompt itself lives with the provider (`providers/import-semantics-
 * prompt.ts`), since the importer reaches its model through the registry and a
 * prompt here would put a cycle between the two.
 */
export const toDescriptors = (
  layouts: DerivedLayout[],
): ImportedLayoutDescriptor[] =>
  layouts.map(layout => ({
    slideCount: layout.members.length,
    slots: layout.slots.map(slot => ({
      name: slot.name,
      kind: slot.kind,
      box: slot.box,
      ...(slot.fontSize !== undefined ? { fontSize: slot.fontSize } : {}),
      ...(slot.bold ? { bold: true } : {}),
    })),
  }))

/** Trims a model's string to something worth storing, or nothing. */
const clean = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().slice(0, max)
  return trimmed.length ? trimmed : undefined
}

/** A type name reduced to the kebab-case the rest of the system uses, so
 * `Two Column` and `two-column` merge rather than sitting side by side. */
const normalizeType = (value: unknown): string | undefined => {
  const text = clean(value, 40)
  if (!text) return undefined
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug.length ? slug : undefined
}

/**
 * Reads the model's answer, keeping only what is usable.
 *
 * Every field is optional on the way out: a response missing half its entries
 * still contributes the half it has, and the rules fill the rest. Parsing that
 * throws away a whole response over one bad field would make the model less
 * useful than no model.
 */
export const parseSemantics = (
  raw: unknown,
  layouts: DerivedLayout[],
): (LayoutSemantics | undefined)[] => {
  const entries = Array.isArray(raw)
    ? raw
    : ((raw as { layouts?: unknown })?.layouts ?? [])
  if (!Array.isArray(entries)) return layouts.map(() => undefined)

  return layouts.map((layout, i) => {
    const entry = entries[i] as Record<string, unknown> | undefined
    if (!entry || typeof entry !== 'object') return undefined
    const names = new Set(layout.slots.map(s => s.name))
    const slots = entry.slots as Record<string, unknown> | undefined
    const slotDescriptions: Record<string, string> = {}
    if (slots && typeof slots === 'object') {
      for (const [name, text] of Object.entries(slots)) {
        // A description for a box this layout does not have is noise, and
        // would show up in the editor attached to nothing.
        if (!names.has(name)) continue
        const value = clean(text, 200)
        if (value) slotDescriptions[name] = value
      }
    }
    return {
      ...(normalizeType(entry.type) ? { type: normalizeType(entry.type) } : {}),
      ...(clean(entry.description, 200)
        ? { description: clean(entry.description, 200) }
        : {}),
      ...(Object.keys(slotDescriptions).length ? { slotDescriptions } : {}),
    }
  })
}

/**
 * What a layout is called when nobody asked a model, or the model did not say.
 *
 * Names come from the conventional vocabulary (SPEC TMPL-2), the same one the
 * built-in templates use — an imported design that named its bullet slide
 * something of its own would sit outside every comparison the system makes.
 *
 * Crude on purpose, and enough to keep an import that never reaches a model
 * from producing a template of layouts called "Layout 3". It reads the same
 * signals a person would at a glance: how many boxes there are, what they
 * hold, and whether anything sits beside anything else.
 */
export const ruleBasedType = (layout: DerivedLayout): string => {
  const slots = layout.slots
  const has = (kind: string) => slots.some(s => s.kind === kind)

  if (slots.length === 0) return 'blank'
  if (has('image') && slots.length === 1) return 'image-heavy'

  // Side by side: two boxes that overlap vertically but not horizontally.
  const beside = slots.some(a =>
    slots.some(
      b =>
        a !== b &&
        a.box.x + a.box.w <= b.box.x + 0.02 &&
        a.box.y < b.box.y + b.box.h &&
        b.box.y < a.box.y + a.box.h,
    ),
  )
  if (beside) return 'two-column'

  // Nothing but a line or two of prose — a heading and perhaps a subtitle.
  // Away from the top it is a section marker, which is what a slide with
  // almost nothing on it nearly always is. Prose only: a title above a bullet
  // list is a title-and-bullets slide, not a title slide.
  const prose = slots.filter(s => s.kind === 'text')
  if (slots.length <= 2 && prose.length === slots.length) {
    const top = Math.min(...slots.map(s => s.box.y))
    return top > 0.25 ? 'section' : 'title'
  }
  if (has('bullets')) return 'list'
  return 'content'
}

/**
 * Fills in whatever the model left out.
 *
 * Applied to every layout, model or no model, so a template never carries a
 * layout with no name — including the case where the response was fine but
 * short.
 */
export const withFallbacks = (
  layouts: DerivedLayout[],
  semantics: (LayoutSemantics | undefined)[],
): LayoutSemantics[] =>
  layouts.map((layout, i) => ({
    type: semantics[i]?.type ?? ruleBasedType(layout),
    ...(semantics[i]?.description
      ? { description: semantics[i]!.description }
      : {}),
    ...(semantics[i]?.slotDescriptions
      ? { slotDescriptions: semantics[i]!.slotDescriptions }
      : {}),
  }))
