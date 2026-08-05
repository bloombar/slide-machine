/**
 * Template actions (TMPL-1, TMPL-4).
 *   - template.list      — the caller's library: their own plus the built-ins.
 *   - template.export    — a template serialized to YAML for download (EXP-2).
 *   - template.duplicate — a copy of a template the caller can see, theirs to
 *                          edit. This is also how one is created: starting
 *                          from an existing template means no starter theme or
 *                          layout set is written into code, so a deployment
 *                          shipping its own built-ins is unaffected.
 *   - template.update    — rename, retheme, or retune a template's layouts.
 *   - template.delete    — tombstone a template the caller authored.
 *
 * Built-ins are read-only: they come from files a deployment controls, and
 * editing one into the database would silently diverge from the file it came
 * from. Duplicating gives the user their own copy instead.
 */
import { z } from 'zod'
import type { ExportDownload, Layout, Template } from '@slide-machine/shared'
import { defineAction } from './define'
import {
  registerAction,
  ActionForbiddenError,
  ActionValidationError,
} from './dispatch'
import type { ActionContext } from './context'
import { TemplateModel, toTemplateDto } from '../models/template'
import {
  layoutSchema,
  normalizeSlot,
  requireWhiteboardLayout,
} from '../templates/builtin'
import {
  isBuiltinTemplate,
  listTemplatesFor,
  resolveTemplate,
} from '../templates/resolve'
import { templateToYaml } from '../lib/template-yaml'

const requireUser = (ctx: ActionContext): string => {
  if (!ctx.userId) throw new ActionForbiddenError('Sign in to continue')
  return ctx.userId
}

/** The editable body of a template, validated exactly as a template file is,
 * so a saved template and a shipped one cannot differ in shape. */
const templateBody = z.object({
  name: z.string().trim().min(1).max(80),
  theme: z.record(z.string(), z.unknown()),
  layouts: z.array(layoutSchema).min(1),
  /** Private until the author shares it: unlisted is reachable by link,
   * public is listed for discovery (TMPL-4). */
  visibility: z.enum(['private', 'unlisted', 'public']).optional(),
})

/** Slots arrive in the file's shorthand or object form; normalizing on save
 * means every reader downstream sees one shape. */
const normalizeLayouts = (
  layouts: z.infer<typeof templateBody>['layouts'],
): Layout[] =>
  layouts.map(layout => ({
    ...layout,
    slots: layout.slots.map(normalizeSlot),
  })) as Layout[]

/** Loads a template the caller authored, or refuses. */
const loadOwn = async (userId: string, templateId: string) => {
  if (isBuiltinTemplate(templateId)) {
    throw new ActionValidationError('template', [
      'built-in templates cannot be changed; duplicate it first',
    ])
  }
  const doc = await TemplateModel.findById(templateId).catch(() => null)
  if (!doc || doc.ownerId.toString() !== userId) {
    throw new ActionForbiddenError()
  }
  return doc
}

export const templateList = defineAction<Record<string, never>, Template[]>({
  name: 'template.list',
  input: z.object({}),
  execute: async ctx => listTemplatesFor(ctx.userId),
})

/**
 * Exports a style template to a YAML file (EXP-2), returned inline for the
 * browser to download — the template's identity, theme, and layouts.
 */
export const templateExport = defineAction<
  { templateId: string },
  ExportDownload
>({
  name: 'template.export',
  input: z.object({ templateId: z.string().min(1) }),
  execute: async (_ctx, input) => {
    const template = await resolveTemplate(input.templateId)
    if (!template) {
      throw new ActionValidationError('template.export', ['unknown template'])
    }
    const slug =
      template.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'template'
    return {
      fileName: `${slug}.template.yaml`,
      mimeType: 'application/x-yaml',
      contentBase64: Buffer.from(templateToYaml(template), 'utf8').toString(
        'base64',
      ),
    }
  },
})

/**
 * Copies a template into the caller's library (TMPL-4). The copy carries the
 * source's theme and layouts verbatim, so a new template always starts from
 * something that already renders rather than from an empty shell.
 */
export const templateDuplicate = defineAction<
  { templateId: string; name?: string },
  Template
>({
  name: 'template.duplicate',
  input: z.object({
    templateId: z.string().min(1),
    name: z.string().trim().min(1).max(80).optional(),
  }),
  execute: async (ctx, input) => {
    const userId = requireUser(ctx)
    const source = await resolveTemplate(input.templateId)
    if (!source) {
      throw new ActionValidationError('template.duplicate', [
        'unknown template',
      ])
    }
    // Someone else's private template is not a source to copy from.
    if (
      source.ownerId !== 'system' &&
      source.ownerId !== userId &&
      source.visibility === 'private'
    ) {
      throw new ActionForbiddenError()
    }
    const doc = await TemplateModel.create({
      ownerId: userId,
      name: input.name ?? source.name,
      theme: source.theme,
      layouts: source.layouts,
      visibility: 'private',
    })
    return toTemplateDto(doc)
  },
})

/** Renames, rethemes, or retunes a template the caller authored (TMPL-4). */
export const templateUpdate = defineAction<
  {
    templateId: string
    name: string
    theme: Record<string, unknown>
    layouts: z.infer<typeof templateBody>['layouts']
    visibility?: 'private' | 'unlisted' | 'public'
  },
  Template
>({
  name: 'template.update',
  input: z
    .object({ templateId: z.string().min(1) })
    .extend(templateBody.shape)
    .superRefine((body, ctx) => requireWhiteboardLayout(body.layouts, ctx)),
  execute: async (ctx, input) => {
    const userId = requireUser(ctx)
    const doc = await loadOwn(userId, input.templateId)
    doc.name = input.name
    doc.theme = input.theme
    doc.layouts = normalizeLayouts(input.layouts)
    if (input.visibility) doc.visibility = input.visibility
    await doc.save()
    return toTemplateDto(doc)
  },
})

/**
 * Tombstones a template the caller authored (P-10). A deck already using it
 * keeps its id and falls back the way it would for any unknown template, so
 * deleting one never breaks a lecture that referenced it.
 */
export const templateDelete = defineAction<
  { templateId: string },
  { id: string }
>({
  name: 'template.delete',
  input: z.object({ templateId: z.string().min(1) }),
  execute: async (ctx, input) => {
    const userId = requireUser(ctx)
    const doc = await loadOwn(userId, input.templateId)
    doc.deletedAt = new Date()
    await doc.save()
    return { id: doc._id.toString() }
  },
})

registerAction(templateList)
registerAction(templateExport)
registerAction(templateDuplicate)
registerAction(templateUpdate)
registerAction(templateDelete)
