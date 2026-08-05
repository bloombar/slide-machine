/**
 * Built-in slide-style templates (TMPL-2/TMPL-3), loaded from JSON
 * files in server/config/templates — one file per template, editable
 * without a code change (see docs/TEMPLATES.md). Each carries the
 * conventional layouts with AI-facing descriptors (TMPL-6) serialized
 * into generation requests as the layout option set (GEN-6).
 *
 * Files are validated with zod at first use and cached; a malformed
 * template fails loudly rather than producing broken slides.
 * User-authored templates (TMPL-4) will live in MongoDB later; these
 * files are the interim store for the starter set.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import {
  SLOT_DESCRIPTORS,
  WHITEBOARD_LAYOUT_TYPE,
  type Layout,
  type LayoutDescriptor,
  type LayoutSlot,
  type SlotSpec,
  type Template,
} from '@slide-machine/shared'
import { env } from '../config/env'

/** A slot in a template file: bare-name shorthand for the conventional
 * slots, or the full WYSIWYG-ready object (custom slots must state
 * their media kind). Normalized to SlotSpec at load. */
const slotFileSchema = z.union([
  z.string().min(1),
  z.object({
    name: z.string().min(1),
    kind: z.enum(['text', 'bullets', 'image']).optional(),
    label: z.string().min(1).optional(),
    multiline: z.boolean().optional(),
    maxChars: z.number().int().positive().optional(),
    style: z.record(z.string(), z.unknown()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
])

export const normalizeSlot = (
  raw: z.infer<typeof slotFileSchema>,
): SlotSpec => {
  const name = typeof raw === 'string' ? raw : raw.name
  const conventional = SLOT_DESCRIPTORS[name as LayoutSlot] as
    (typeof SLOT_DESCRIPTORS)[LayoutSlot] | undefined
  if (typeof raw === 'string') {
    if (!conventional) {
      throw new Error(
        `Slot "${name}" is not a conventional slot; use the object form with an explicit kind`,
      )
    }
    return { name, ...conventional }
  }
  const kind = raw.kind ?? conventional?.kind
  if (!kind) {
    throw new Error(`Custom slot "${name}" must declare its kind`)
  }
  return {
    name,
    kind,
    label: raw.label ?? conventional?.label ?? name,
    multiline: raw.multiline ?? conventional?.multiline,
    maxChars: raw.maxChars,
    style: raw.style,
    metadata: raw.metadata,
  }
}

/**
 * A layout type is a NAME, not a menu choice (TMPL-9): the conventional types
 * (TMPL-2) are the vocabulary to reuse where one fits, and an author may name
 * a layout of their own where none does. Shaped like a slug so it stays usable
 * as a key — in a slide's `layoutType`, in exports, and in the AI's option set.
 */
const layoutTypeSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    'layout type must be lowercase words joined by hyphens',
  )

export const layoutSchema = z
  .object({
    type: layoutTypeSchema,
    label: z.string().min(1),
    purpose: z.string().min(1),
    // The whiteboard layout is a blank slate with no content slots; every
    // other layout must expose at least one (enforced below).
    slots: z.array(slotFileSchema),
    constraints: z
      .object({
        maxBullets: z.number().int().positive().optional(),
        maxTitleChars: z.number().int().positive().optional(),
        maxBodyChars: z.number().int().positive().optional(),
        maxBulletChars: z.number().int().positive().optional(),
        maxCaptionChars: z.number().int().positive().optional(),
        imageRequired: z.boolean().optional(),
      })
      .optional(),
    // Where each slot sits, as a fraction of the slide, 0–1 (TMPL-4, see
    // docs/TEMPLATES.md §4). Validated here rather than trusted from the
    // editor: a box outside the slide, or one naming a slot the layout does
    // not have, would render a slide with content nobody can see.
    elementPositions: z
      .record(
        z.string(),
        z.object({
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          w: z.number().min(0.01).max(1),
          h: z.number().min(0.01).max(1),
          align: z.enum(['start', 'center', 'end']).optional(),
          vAlign: z.enum(['start', 'center', 'end']).optional(),
          /** Font size in `cqi` — a percent of the slide's width, so type
           * scales with the slide rather than the window. */
          fontSize: z.number().positive().max(100).optional(),
          fontWeight: z.number().int().min(100).max(900).optional(),
          /** A hex value, or a theme key such as `accent`. */
          color: z.string().min(1).max(40).optional(),
        }),
      )
      .default({}),
  })
  .superRefine((layout, ctx) => {
    if (layout.type !== WHITEBOARD_LAYOUT_TYPE && layout.slots.length < 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'layout must declare at least one slot',
        path: ['slots'],
      })
    }
    const names = new Set(
      layout.slots.map(s => (typeof s === 'string' ? s : s.name)),
    )
    for (const [name, box] of Object.entries(layout.elementPositions ?? {})) {
      if (!names.has(name)) {
        ctx.addIssue({
          code: 'custom',
          message: `positioned slot "${name}" is not declared by this layout`,
          path: ['elementPositions', name],
        })
        continue
      }
      // A box that starts inside but runs past the edge hides its own content.
      if (box.x + box.w > 1 || box.y + box.h > 1) {
        ctx.addIssue({
          code: 'custom',
          message: `slot "${name}" extends past the slide`,
          path: ['elementPositions', name],
        })
      }
    }
  })

const templateFileSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    /** Absent means `components`: the hand-tuned layout components. */
    renderMode: z.enum(['components', 'positioned']).optional(),
    theme: z.record(z.string(), z.unknown()),
    layouts: z.array(layoutSchema).min(1),
  })
  // Every template — built-in or user-authored — must provide the blank
  // whiteboard slate so the drawing tools always have a canvas (WB-1).
  .superRefine((template, ctx) =>
    requireWhiteboardLayout(template.layouts, ctx),
  )

let cache: Template[] | undefined

/**
 * Rescales a layout's boxes to the 0–1 they are stored in today.
 *
 * The first templates saved through the editor held percentages, and 88 read
 * as 0–1 places a box eighty-eight slides to the right — off screen, so the
 * layout looks empty. A box is percentages if any side exceeds 1, which a
 * fraction never does (a full-width box is exactly 1).
 */
export const normalizePositions = <T extends { elementPositions?: unknown }>(
  layouts: T[],
): T[] =>
  layouts.map(layout => {
    const positions = layout.elementPositions as
      Record<string, Record<string, unknown>> | undefined
    if (!positions) return layout
    let rescaled = false
    const next = Object.fromEntries(
      Object.entries(positions).map(([name, box]) => {
        const sides = ['x', 'y', 'w', 'h'] as const
        if (!sides.some(k => typeof box[k] === 'number' && box[k] > 1)) {
          return [name, box]
        }
        rescaled = true
        return [
          name,
          {
            ...box,
            ...Object.fromEntries(
              sides.map(k => [
                k,
                typeof box[k] === 'number' ? (box[k] as number) / 100 : box[k],
              ]),
            ),
          },
        ]
      }),
    )
    return rescaled ? { ...layout, elementPositions: next } : layout
  })

/**
 * The rule every template must satisfy, file-based or user-authored: a blank
 * whiteboard slate, so the drawing tools always have a canvas (WB-1/TMPL-7).
 * Shared so a template saved through the editor cannot be shaped differently
 * from one shipped as a file.
 */
export const requireWhiteboardLayout = (
  layouts: { type: string }[],
  ctx: z.RefinementCtx,
): void => {
  if (!layouts.some(l => l.type === WHITEBOARD_LAYOUT_TYPE)) {
    ctx.addIssue({
      code: 'custom',
      message: `template must include a '${WHITEBOARD_LAYOUT_TYPE}' layout`,
      path: ['layouts'],
    })
  }
  // A slide stores its layout as a type, so two layouts sharing one would be
  // indistinguishable to every slide that used it.
  const seen = new Set<string>()
  for (const layout of layouts) {
    if (seen.has(layout.type)) {
      ctx.addIssue({
        code: 'custom',
        message: `duplicate layout type '${layout.type}'`,
        path: ['layouts'],
      })
    }
    seen.add(layout.type)
  }
}

/** Loads and validates every *.json in the templates directory. */
export const loadBuiltinTemplates = (
  dir: string = env.TEMPLATES_DIR,
): Template[] => {
  const files = readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort()
  if (!files.length) {
    throw new Error(`No template files found in ${dir}`)
  }
  return files.map(file => {
    const raw: unknown = JSON.parse(readFileSync(path.join(dir, file), 'utf8'))
    const parsed = templateFileSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(
        `Invalid template file ${file}: ${parsed.error.issues
          .map(i => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      )
    }
    return {
      ...parsed.data,
      layouts: parsed.data.layouts.map(layout => ({
        ...layout,
        slots: layout.slots.map(normalizeSlot),
      })) as Layout[],
      ownerId: 'system',
      visibility: 'public' as const,
      voteScore: 0,
      createdAt: '2026-07-01T00:00:00.000Z',
    }
  })
}

const templates = (): Template[] => {
  cache ??= loadBuiltinTemplates()
  return cache
}

/** The starter template set, for template.list. */
export const listBuiltinTemplates = (): Template[] => templates()

export const getBuiltinTemplate = (id: string): Template | undefined =>
  templates().find(t => t.id === id)

/**
 * The template to fall back on: the deployment's configured default, or the
 * first one it ships. Never a literal id — a deployment may replace the
 * starter set entirely, and nothing in code should assume a template it does
 * not necessarily have.
 */
export const defaultTemplateId = (): string => {
  const configured = env.DEFAULT_TEMPLATE_ID
  if (configured && getBuiltinTemplate(configured)) return configured
  const first = templates()[0]
  if (!first) throw new Error('No templates available')
  return first.id
}

/** The AI-facing option set for a template (GEN-6). The whiteboard layout
 * is a manual blank slate, so it is withheld from the model — generation
 * never auto-selects it; users add it via the layout picker. */
export const layoutDescriptors = (template: Template): LayoutDescriptor[] =>
  template.layouts
    .filter(l => l.type !== WHITEBOARD_LAYOUT_TYPE)
    .map(({ type, label, purpose, slots, constraints }) => ({
      type,
      label,
      purpose,
      slots,
      constraints,
    }))

/** Test hook: re-read template files. */
export const resetTemplateCache = (): void => {
  cache = undefined
}
