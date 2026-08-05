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
  LAYOUT_TYPES,
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

export const layoutSchema = z
  .object({
    type: z.enum(LAYOUT_TYPES),
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
    // Where each slot sits, as percentages of the slide (TMPL-4). Validated
    // here rather than trusted from the editor: a box outside the slide, or
    // one naming a slot the layout does not have, would render a slide with
    // content nobody can see.
    elementPositions: z
      .record(
        z.string(),
        z.object({
          x: z.number().min(0).max(100),
          y: z.number().min(0).max(100),
          w: z.number().min(1).max(100),
          h: z.number().min(1).max(100),
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
      if (box.x + box.w > 100 || box.y + box.h > 100) {
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
