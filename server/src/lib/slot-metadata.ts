/**
 * What a slot **is**, carried inside an exported Google Slides presentation
 * (EXP-8).
 *
 * Google Slides can say where a shape sits and what text it holds, and nothing
 * more. It has no notion of a slot's name, its kind, the authoring instruction
 * its template wrote for it, or the limits it is held to. So an export written
 * by this system puts that metadata into the file itself, in fields Google
 * preserves but never displays as slide content, and an import reads it back
 * instead of inferring a design from rectangles (docs/TEMPLATES.md §8).
 *
 * ## Identity travels on the shape
 *
 * Each emitted shape carries a short `slot:<name>` token in its alt text. A
 * shape whose alt text names a slot **is** that slot, so the association is
 * structural: it survives shapes being reordered, and it works on a
 * presentation's layouts as well as its slides — which is what lets a
 * template, not only a deck, round-trip.
 *
 * The alternative, one blob keyed back to each shape, has no usable key.
 * Object ids are reassigned when a slide is duplicated and are chosen by Drive
 * during conversion, so there is nothing to write; placeholder types cannot
 * tell three code slots apart; z-order breaks on any reorder.
 *
 * ## The bulk travels beside it
 *
 * Kind, instruction, limits and options are too bulky for alt text — Google
 * shows alt text to the user, and a wall of JSON there invites deletion. They
 * live in one versioned payload per layout, keyed by slot name, on a marker
 * shape of its own.
 *
 * ## It is advisory, and untrusted
 *
 * An instructor can edit or delete alt text in Google's interface, and a
 * converter need not preserve everything. So the payload is versioned,
 * validated and size-capped, and a reader that finds it missing, damaged or of
 * an unknown version returns nothing and lets the caller infer instead. Its
 * presence makes a round trip lossless; its absence degrades the result and
 * never fails an import.
 */
import { z } from 'zod'
import {
  MAX_SLOT_DESCRIPTION,
  SLOT_KINDS,
  type SlotKind,
  type SlotSpec,
} from '@slide-machine/shared'

/** Bumped when the payload's shape changes. A reader that meets a version it
 * does not know infers instead of guessing. */
export const SLOT_METADATA_VERSION = 1

/** Marks the payload as ours, so a reader can tell it from any other text that
 * happens to be JSON. */
const MARKER = 'slidemachine'

/** The prefix that makes a shape's alt text a slot identity. */
export const SLOT_TOKEN_PREFIX = 'slot:'

/**
 * How much payload one layout may carry.
 *
 * Alt text is not a place to put an unbounded amount of anything: a template
 * with a hundred boxes, each with a two-hundred-character instruction, would
 * otherwise write a document into a field meant for a sentence. Well above any
 * plausible layout, and finite.
 */
export const MAX_SLOT_PAYLOAD_BYTES = 8000

/** A slot name that can survive the trip: no newline, since the token is read
 * a line at a time, and bounded. */
const MAX_SLOT_NAME = 120

/** A slot as the payload states it: its own declaration, plus the text role
 * the box that shows it follows. The role rides here rather than on `SlotSpec`
 * because that is where it has to be read back from, not where it lives. */
export type RestoredSlot = SlotSpec & { textStyle?: string; caps?: boolean }

/** The alt text that identifies a shape as a slot. */
export const slotToken = (name: string): string => `${SLOT_TOKEN_PREFIX}${name}`

/**
 * The slot a shape's alt text names, or nothing.
 *
 * Read a line at a time because the field belongs to the user: someone may
 * have typed a real description above or below the token, and a genuine alt
 * text is worth more than our marker is.
 */
export const slotFromToken = (
  altText: string | undefined,
): string | undefined => {
  if (!altText) return undefined
  for (const line of altText.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith(SLOT_TOKEN_PREFIX)) continue
    const name = trimmed.slice(SLOT_TOKEN_PREFIX.length).trim()
    if (name && name.length <= MAX_SLOT_NAME) return name
  }
  return undefined
}

/**
 * One slot as the payload states it.
 *
 * Deliberately not `SlotSpec` itself: this is a wire format that must stay
 * readable by a build that has moved on, so every field beyond the name is
 * optional and anything unrecognized is dropped rather than trusted.
 */
const slotSchema = z.object({
  name: z.string().min(1).max(MAX_SLOT_NAME),
  kind: z.enum(SLOT_KINDS as [SlotKind, ...SlotKind[]]).optional(),
  label: z.string().max(200).optional(),
  description: z.string().max(MAX_SLOT_DESCRIPTION).optional(),
  multiline: z.boolean().optional(),
  maxChars: z.number().int().positive().optional(),
  maxWords: z.number().int().positive().optional(),
  maxItems: z.number().int().positive().optional(),
  required: z.boolean().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  /** The text role the box follows (TMPL-9). Not a `SlotSpec` field — it
   * lives on the box, not the slot — but it belongs in this payload because
   * it is the one part of a design's typography that a Slides file has
   * nowhere else to put: the exporter resolves every role down to literal
   * type before writing, so without this a re-import can only derive a fresh
   * scale, which is a different design from the one that left. */
  textStyle: z.string().min(1).max(40).optional(),
  /** Set in capitals. Travels for the same reason the role does: the export
   * writes the shouted letterforms, so a re-import would read the text as
   * capitals rather than as a box SET in them (`BoxStyle.caps`). */
  caps: z.boolean().optional(),
})

const payloadSchema = z.object({
  [MARKER]: z.literal(SLOT_METADATA_VERSION),
  slots: z.array(slotSchema).max(200),
})

/** The fields worth carrying, with anything absent left out so the payload
 * states what a template said rather than a defaulted copy of it. */
const forWire = (
  spec: SlotSpec,
  role?: string,
  caps?: boolean,
): Record<string, unknown> => {
  const out: Record<string, unknown> = { name: spec.name, kind: spec.kind }
  if (role) out.textStyle = role
  if (caps) out.caps = true
  if (spec.label) out.label = spec.label
  if (spec.description) out.description = spec.description
  if (spec.multiline) out.multiline = spec.multiline
  if (spec.maxChars !== undefined) out.maxChars = spec.maxChars
  if (spec.maxWords !== undefined) out.maxWords = spec.maxWords
  if (spec.maxItems !== undefined) out.maxItems = spec.maxItems
  if (spec.required) out.required = spec.required
  if (spec.options) out.options = spec.options
  return out
}

const bytes = (text: string): number => Buffer.byteLength(text, 'utf8')

/**
 * The payload a layout carries, or nothing when it has no slots.
 *
 * Over the cap, authoring instructions are dropped first and the rest is kept:
 * a name, a kind and a limit still restore a box exactly, while an instruction
 * only steers what is written into it. Losing the whole payload to save a
 * sentence would be the wrong trade.
 */
export const encodeSlotMetadata = (
  slots: SlotSpec[],
  /** The text role each box follows, by slot name — `textStylesBySlot` of the
   * layout these slots belong to. Optional so a caller that has only the
   * specs still writes a valid payload, just one without the roles. */
  roles: Record<string, string | undefined> = {},
  /** Which boxes are set in capitals, by slot name. */
  caps: Record<string, boolean | undefined> = {},
): string | undefined => {
  if (!slots.length) return undefined
  const wrap = (entries: Record<string, unknown>[]): string =>
    JSON.stringify({ [MARKER]: SLOT_METADATA_VERSION, slots: entries })

  const full = wrap(
    slots.map(spec => forWire(spec, roles[spec.name], caps[spec.name])),
  )
  if (bytes(full) <= MAX_SLOT_PAYLOAD_BYTES) return full

  const lean = wrap(
    slots.map(spec => {
      const { description, ...rest } = forWire(
        spec,
        roles[spec.name],
        caps[spec.name],
      )
      void description
      return rest
    }),
  )
  // Still over: a template this large is beyond what alt text can hold, and
  // saying nothing is honest where saying half of it would not be.
  return bytes(lean) <= MAX_SLOT_PAYLOAD_BYTES ? lean : undefined
}

/**
 * The slots a payload states, or nothing.
 *
 * Nothing means "infer this design", which is the same answer for a payload
 * that was never written, one an instructor deleted, one a converter mangled,
 * and one from a version this build does not know. The caller does not need to
 * tell those apart — every one of them means the file cannot be trusted to
 * describe itself.
 */
export const parseSlotMetadata = (
  text: string | undefined,
): RestoredSlot[] | undefined => {
  if (!text || bytes(text) > MAX_SLOT_PAYLOAD_BYTES) return undefined
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return undefined
  }
  const parsed = payloadSchema.safeParse(raw)
  if (!parsed.success) return undefined
  const slots = parsed.data.slots
    .filter(slot => slot.name)
    .map((slot): RestoredSlot => ({
      ...slot,
      kind: (slot.kind ?? 'text') as SlotKind,
      // A slot must be labelled to be shown, and its name is the honest
      // fallback for one whose label did not travel.
      label: slot.label ?? slot.name,
    }))
  return slots.length ? slots : undefined
}
