/**
 * Parses and validates a template YAML export back into a template ready to be
 * stored (SPEC EXP-3). Round-trips the shape `templateToYaml` produces: the
 * name, the theme, and every layout in full — slots, tree, geometry,
 * decoration and guides.
 *
 * Validation is total and side-effect-free: the whole document is checked
 * before anything is created, and every problem is collected into a readable
 * list. On any error the caller creates nothing, so a malformed file can never
 * partially corrupt an existing library.
 *
 * ## What is not carried over
 *
 * The file's `id` and `visibility` are read and discarded. An import is a new
 * template owned by whoever imported it, so it takes a fresh id, and it
 * arrives private — the same judgement TMPL-8's import makes, and for the same
 * reason: publishing a design on someone's behalf is not a thing to do
 * silently. Neither is part of what EXP-3 promises back unchanged, which is
 * the theme, the layouts and the geometry.
 *
 * ## Where it differs from a deck import
 *
 * A deck naming a template that does not exist falls back to the default and
 * warns, because the lecture's content is the point and is still worth
 * recovering. A template has nothing to fall back to — substituting a design
 * the user did not ask for is worse than refusing — so anything unresolvable
 * here is an error, not a warning (EXP-3).
 */
import YAML from 'yaml'
import { z } from 'zod'
import {
  WHITEBOARD_LAYOUT_TYPE,
  type Layout,
  type LayoutDecoration,
} from '@slide-machine/shared'
import { layoutSchema } from '../templates/builtin'

/** The blank slate every template must offer (TMPL-7). Synthesized when a file
 * has none, exactly as an import from Google Slides synthesizes one — it is a
 * blank canvas with no design to substitute, so adding it invents nothing. */
const WHITEBOARD_LAYOUT: Layout = {
  type: WHITEBOARD_LAYOUT_TYPE,
  label: 'Whiteboard',
  purpose: 'A blank slate for freehand drawing',
  slots: [],
  elementPositions: {},
}

/**
 * The full template-export document.
 *
 * `version` must be a number but its value is not pinned: the format is
 * additive, so a newer file with extra keys still imports and older exports
 * stay readable (EXP-3, "where the format has versions, older exports remain
 * readable"). Unknown keys — including `id` and `visibility` — are stripped.
 */
const templateDocSchema = z
  .object({
    version: z.number(),
    kind: z.literal('template'),
    name: z.string().trim().min(1).max(80),
    renderMode: z.enum(['components', 'positioned']).optional(),
    theme: z.record(z.string(), z.unknown()),
    layouts: z.array(layoutSchema).min(1),
  })
  .strip()

/** A validated template import, ready for the action to persist. */
export type ImportedTemplate = z.infer<typeof templateDocSchema>

/** The outcome of parsing: either the validated template, or the problems. */
export type ParseResult = { data: ImportedTemplate } | { errors: string[] }

/** Renders a zod issue as a readable "path: message" line (root → "document"). */
const formatIssue = (issue: z.ZodIssue): string => {
  const path = issue.path.join('.') || 'document'
  return `${path}: ${issue.message}`
}

/**
 * Parses a template-export YAML string and validates its structure. Returns
 * the validated template on success, or a de-duplicated list of human-readable
 * errors — never throws for malformed input.
 */
export const parseTemplateImport = (content: string): ParseResult => {
  let parsed: unknown
  try {
    parsed = YAML.parse(content)
  } catch {
    return { errors: ['document: not valid YAML'] }
  }
  // `typeof [] === 'object'`, so a list has to be turned away by name — left
  // to zod it comes back as "expected object, received array", which tells an
  // instructor nothing about the file they picked.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { errors: ['document: expected a YAML mapping'] }
  }
  // The mirror of the deck importer's check: a lecture picked for a design.
  if ((parsed as { kind?: unknown }).kind === 'deck') {
    return {
      errors: [
        'That is a lecture file, not a design. Import it from the "+" menu beside your lectures instead.',
      ],
    }
  }
  const result = templateDocSchema.safeParse(parsed)
  if (!result.success) {
    return { errors: [...new Set(result.error.issues.map(formatIssue))] }
  }
  return { data: result.data }
}

/** Every layout of the file, with the blank slate added when it has none. */
export const layoutsWithWhiteboard = (doc: ImportedTemplate): Layout[] => {
  const layouts = doc.layouts as Layout[]
  return layouts.some(layout => layout.type === WHITEBOARD_LAYOUT_TYPE)
    ? layouts
    : [...layouts, WHITEBOARD_LAYOUT]
}

/** Every picture the design refers to, once each, in the order met.
 *
 * Decoration is the only place a template names a file: its theme is colours
 * and its geometry is numbers. */
export const decorationImages = (layouts: Layout[]): string[] => [
  ...new Set(
    layouts.flatMap(layout =>
      (layout.decoration ?? [])
        .map(piece => piece.imageUrl)
        .filter((url): url is string => Boolean(url)),
    ),
  ),
]

/**
 * Repoints every decoration picture at the template's own stored copy.
 *
 * A template that referred to the exporting template's files would be a design
 * that stops rendering when someone else deletes theirs, and would not be
 * swept correctly when its own owner deletes it (P-11). So the import owns its
 * pictures or it does not import: a URL missing from `stored` is the caller's
 * signal to fail, which is why this never silently drops one.
 */
export const repointDecoration = (
  layouts: Layout[],
  stored: Map<string, string>,
): Layout[] =>
  layouts.map(layout =>
    layout.decoration?.length
      ? {
          ...layout,
          decoration: layout.decoration.map((piece): LayoutDecoration =>
            piece.imageUrl && stored.has(piece.imageUrl)
              ? { ...piece, imageUrl: stored.get(piece.imageUrl)! }
              : piece,
          ),
        }
      : layout,
  )
