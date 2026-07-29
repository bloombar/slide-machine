/**
 * Parses and validates a deck YAML export back into a structured form for import
 * (SPEC EXP-3). Round-trips the shape produced by `deckToYaml`: the deck title,
 * template, General-tab settings, and slides. Seed notes and seed material are
 * not imported (nor exported) — any such keys in an older file are ignored.
 *
 * Validation is total and side-effect-free: the whole document is checked before
 * anything is created, and every problem is collected into a readable list. On
 * any error the caller creates nothing, so a malformed import can never
 * partially corrupt existing data.
 */
import YAML from 'yaml'
import { z } from 'zod'
import { LAYOUT_TYPES } from '@slide-machine/shared'

/** TASL image attribution — all fields optional strings. */
const attributionSchema = z
  .object({
    caption: z.string().optional(),
    title: z.string().optional(),
    creator: z.string().optional(),
    creatorUrl: z.string().optional(),
    sourceUrl: z.string().optional(),
    sourceName: z.string().optional(),
    license: z.string().optional(),
    licenseUrl: z.string().optional(),
  })
  .strip()

const slideSchema = z
  .object({
    layout: z.enum(LAYOUT_TYPES),
    title: z.string().optional(),
    body: z.string().optional(),
    bullets: z.array(z.string()).optional(),
    image: z
      .object({
        ref: z.string().optional(),
        source: z.enum(['seeded', 'stock', 'generated']).optional(),
        caption: z.string().optional(),
        attribution: attributionSchema.optional(),
      })
      .strip()
      .optional(),
  })
  .strip()

const settingsSchema = z
  .object({
    language: z.string().optional(),
    generationFreedom: z.number().optional(),
    ttsVoice: z.string().optional(),
  })
  .strip()

/** The full deck-export document. `version` is required to be a number but its
 * value is not pinned — the format is additive, so a newer file with extra keys
 * still imports (unknown keys, including any legacy seedMaterial, are stripped). */
const deckDocSchema = z
  .object({
    version: z.number(),
    kind: z.literal('deck'),
    title: z.string(),
    templateId: z.string(),
    visibility: z.string().optional(),
    settings: settingsSchema.optional(),
    slides: z.array(slideSchema),
  })
  .strip()

/** A validated deck import, ready for the action to persist. */
export type ImportedDeck = z.infer<typeof deckDocSchema>

/** The outcome of parsing: either the validated deck, or a list of problems. */
export type ParseResult = { data: ImportedDeck } | { errors: string[] }

/** Renders a zod issue as a readable "path: message" line (root → "document"). */
const formatIssue = (issue: z.ZodIssue): string => {
  const path = issue.path.join('.') || 'document'
  return `${path}: ${issue.message}`
}

/**
 * Parses a deck-export YAML string and validates its structure. Returns the
 * validated deck on success, or a de-duplicated list of human-readable errors —
 * never throws for malformed input.
 */
export const parseDeckImport = (content: string): ParseResult => {
  let parsed: unknown
  try {
    parsed = YAML.parse(content)
  } catch {
    return { errors: ['document: not valid YAML'] }
  }
  if (parsed === null || typeof parsed !== 'object') {
    return { errors: ['document: expected a YAML mapping'] }
  }
  const result = deckDocSchema.safeParse(parsed)
  if (!result.success) {
    const errors = [...new Set(result.error.issues.map(formatIssue))]
    return { errors }
  }
  return { data: result.data }
}
