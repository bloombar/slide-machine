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
  SLOT_KINDS,
  WHITEBOARD_LAYOUT_TYPE,
  defaultLayoutTree,
  slotLimits,
  themeTextStyles,
  treeFromSlots,
  type Layout,
  type LayoutDescriptor,
  type LayoutSlot,
  type SlotKind,
  type SlotSpec,
  type Template,
  MAX_SLOT_DESCRIPTION,
} from '@slide-machine/shared'
import { env } from '../config/env'

/** A slot in a template file: bare-name shorthand for the conventional
 * slots, or the full WYSIWYG-ready object (custom slots must state
 * their media kind). Normalized to SlotSpec at load. */
const slotFileSchema = z.union([
  z.string().min(1),
  z.object({
    name: z.string().min(1),
    // The closed menu of kinds (TMPL-9). Open here would let a template
    // declare content nothing knows how to draw, edit or read aloud.
    kind: z.enum(SLOT_KINDS as [SlotKind, ...SlotKind[]]).optional(),
    label: z.string().min(1).optional(),
    // The author's instruction to the AI (TMPL-10). Capped here rather than
    // trusted: it is untrusted text that flows into a prompt, and every byte
    // of it costs latency on a per-phrase call.
    description: z.string().trim().max(MAX_SLOT_DESCRIPTION).optional(),
    multiline: z.boolean().optional(),
    maxChars: z.number().int().positive().optional(),
    maxWords: z.number().int().positive().optional(),
    maxItems: z.number().int().positive().max(50).optional(),
    required: z.boolean().optional(),
    options: z.record(z.string(), z.unknown()).optional(),
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
    description: raw.description?.trim() || undefined,
    multiline: raw.multiline ?? conventional?.multiline,
    maxChars: raw.maxChars,
    maxWords: raw.maxWords,
    maxItems: raw.maxItems,
    required: raw.required,
    options: raw.options,
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

/**
 * How a box paints itself and sets type inside it. Sizes are in `cqi` — a
 * percent of the slide's width — so they scale with the slide; colors are a
 * hex value or a theme key such as `accent`.
 */
const boxStyleSchema = z.object({
  align: z.enum(['start', 'center', 'end']).optional(),
  vAlign: z.enum(['start', 'center', 'end']).optional(),
  textStyle: z.string().min(1).max(40).optional(),
  fontSize: z.number().positive().max(100).optional(),
  fontWeight: z.number().int().min(100).max(900).optional(),
  italic: z.boolean().optional(),
  lineHeight: z.number().min(0.5).max(4).optional(),
  fontFamily: z.string().min(1).max(40).optional(),
  color: z.string().min(1).max(40).optional(),
  background: z.string().min(1).max(40).optional(),
  padding: z.number().min(0).max(50).optional(),
  paddingX: z.number().min(0).max(50).optional(),
  paddingY: z.number().min(0).max(50).optional(),
  radius: z.number().min(0).max(50).optional(),
  borderColor: z.string().min(1).max(40).optional(),
  borderWidth: z.number().min(0).max(50).optional(),
})

const containerSpecSchema = z.object({
  mode: z.enum(['flex', 'grid']),
  direction: z.enum(['row', 'column']).optional(),
  wrap: z.boolean().optional(),
  columns: z.number().int().min(1).max(24).optional(),
  rows: z.number().int().min(1).max(24).optional(),
  gap: z.number().min(0).max(50).optional(),
  gapX: z.number().min(0).max(50).optional(),
  gapY: z.number().min(0).max(50).optional(),
  justify: z
    .enum(['start', 'center', 'end', 'between', 'around', 'evenly'])
    .optional(),
  alignItems: z.enum(['start', 'center', 'end', 'stretch']).optional(),
})

/** How deep a layout may nest. Generous for any real design, and a bound at
 * all so a cyclic or hand-edited document cannot make the renderer recurse
 * forever. */
const MAX_TREE_DEPTH = 8

/**
 * One node of a layout's tree. Recursive, so declared with `z.lazy` and given
 * an explicit type — zod cannot infer through the cycle.
 */
const layoutNodeSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    id: z.string().min(1).max(60),
    slot: z.string().min(1).max(60).optional(),
    before: z.string().max(8).optional(),
    after: z.string().max(8).optional(),
    container: containerSpecSchema.optional(),
    children: z.array(layoutNodeSchema).max(64).optional(),
    grow: z.number().min(0).max(100).optional(),
    shrink: z.number().min(0).max(100).optional(),
    basis: z.number().min(0).max(1).optional(),
    colSpan: z.number().int().min(1).max(24).optional(),
    rowSpan: z.number().int().min(1).max(24).optional(),
    width: z.number().min(0).max(1).optional(),
    height: z.number().min(0).max(1).optional(),
    free: z.boolean().optional(),
    box: z
      .object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        w: z.number().min(0.01).max(1),
        h: z.number().min(0.01).max(1),
      })
      .optional(),
    style: boxStyleSchema.optional(),
  }),
)

/** Walks a tree, reporting every problem the schema cannot express on its
 * own: a slot the layout never declared, a duplicate id, or nesting past the
 * depth bound. */
const checkTree = (
  node: unknown,
  slotNames: Set<string>,
  ctx: z.RefinementCtx,
  seenIds: Set<string>,
  depth = 0,
): void => {
  const n = node as {
    id?: string
    slot?: string
    children?: unknown[]
  }
  if (depth > MAX_TREE_DEPTH) {
    ctx.addIssue({
      code: 'custom',
      message: `layout tree nests deeper than ${MAX_TREE_DEPTH} levels`,
      path: ['tree'],
    })
    return
  }
  if (n.id) {
    // Ids address a node in the editor, so two the same make one unreachable.
    if (seenIds.has(n.id)) {
      ctx.addIssue({
        code: 'custom',
        message: `duplicate node id "${n.id}" in the layout tree`,
        path: ['tree'],
      })
    }
    seenIds.add(n.id)
  }
  // A node naming a slot the layout does not declare would render nothing and
  // give the author no way to see why.
  if (n.slot && !slotNames.has(n.slot)) {
    ctx.addIssue({
      code: 'custom',
      message: `tree node shows slot "${n.slot}", which this layout does not declare`,
      path: ['tree'],
    })
  }
  for (const child of n.children ?? [])
    checkTree(child, slotNames, ctx, seenIds, depth + 1)
}

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
    // How the layout is built: containers and boxes (TMPL-4). This is what
    // the author edits and what the renderer draws.
    tree: layoutNodeSchema.optional(),
    // Where each slot ends up, as a fraction of the slide, 0–1 (TMPL-4, see
    // docs/TEMPLATES.md §4). Derived from the tree by the editor, and kept
    // because the exporters cannot run CSS. Validated here rather than
    // trusted: a box outside the slide, or one naming a slot the layout does
    // not have, would render a slide with content nobody can see.
    elementPositions: z
      .record(
        z.string(),
        boxStyleSchema.extend({
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          w: z.number().min(0.01).max(1),
          h: z.number().min(0.01).max(1),
        }),
      )
      .default({}),
    // Authoring guidelines the editor snaps to. Never drawn on a slide.
    guides: z
      .object({
        x: z.array(z.number().min(0).max(1)).max(40),
        y: z.array(z.number().min(0).max(1)).max(40),
      })
      .optional(),
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
    if (layout.tree) checkTree(layout.tree, names, ctx, new Set())
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
 * Gives a layout the conventional tree for its type, when it has nothing else
 * to be drawn from.
 *
 * A template someone duplicated before layouts became trees carries no tree
 * and no geometry — it relied on a component that no longer exists, and left
 * alone it would fall through to the generic fallback and visibly change. Its
 * type still says what it is, so the matching default is exactly what it used
 * to look like.
 *
 * Applied on read, next to `normalizePositions`, so no stored document has to
 * be rewritten. A layout that has a tree, or has geometry of its own (a design
 * imported from Google Slides), is left alone — both already say how they are
 * drawn.
 */
export const adoptDefaultTree = <
  T extends {
    type: string
    tree?: unknown
    slots?: { name: string; kind?: string }[]
    elementPositions?: Record<string, unknown>
  },
>(
  layouts: T[],
): T[] =>
  layouts.map(layout => {
    if (layout.tree) return layout
    if (Object.keys(layout.elementPositions ?? {}).length > 0) return layout
    // A conventional type is exactly what it always was; a layout an author
    // named themselves has no such definition, so one is built from the slots
    // it declares. Either way it comes back with something to draw and edit
    // rather than nothing.
    const tree =
      defaultLayoutTree(layout.type) ?? treeFromSlots(layout.slots ?? [])
    return tree ? { ...layout, tree } : layout
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
      // A file that names a conventional layout gets that layout's tree
      // without writing it out, so the starter templates stay readable and a
      // deployment's own file only describes what it does differently.
      layouts: adoptDefaultTree(
        parsed.data.layouts.map(layout => ({
          ...layout,
          slots: layout.slots.map(normalizeSlot),
        })),
      ) as Layout[],
      ownerId: 'system',
      // A built-in's id is already a readable slug, so it is its permalink.
      permalinkSlug: parsed.data.id,
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
export const layoutDescriptors = (
  template: Pick<Template, 'theme' | 'layouts'>,
): LayoutDescriptor[] => {
  const styles = themeTextStyles(template.theme)
  return template.layouts
    .filter(l => l.type !== WHITEBOARD_LAYOUT_TYPE)
    .map(layout => {
      const { type, label, purpose, slots, constraints } = layout
      // Every box's limit stated on the box itself, so the prompt reads one
      // number per box rather than leaving the model to combine a style and a
      // constraint it was never shown (`slotLimits`, shared with the editor's
      // preview so the two cannot disagree).
      const limits = slotLimits(layout, styles)
      const resolved = slots.map(slot => ({
        ...slot,
        maxChars: limits[slot.name]?.maxChars,
        maxItems: limits[slot.name]?.maxItems,
      }))

      // A bullet box's own limit is more specific than the layout's, so it
      // wins where it says anything.
      const bullets = resolved.find(s => s.kind === 'bullets')?.maxItems
      return {
        type,
        label,
        purpose,
        slots: resolved,
        constraints: bullets
          ? { ...constraints, maxBullets: bullets }
          : constraints,
      }
    })
}

/** Test hook: re-read template files. */
export const resetTemplateCache = (): void => {
  cache = undefined
}
