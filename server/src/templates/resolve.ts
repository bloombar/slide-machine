/**
 * Resolving a template by id, wherever it lives (TMPL-1/TMPL-4).
 *
 * A deck or project stores one `templateId`, which may name a built-in file
 * template or a user-authored one in MongoDB. Everything downstream — the
 * generation prompt, slide-fit validation, the viewer, export — only wants
 * "the template with this id", so that lookup belongs in one place rather
 * than being repeated with a store-specific call at each site.
 *
 * Built-ins are checked first: their ids are slugs and a stored template's is
 * a document id, so the two cannot collide.
 */
import { Types } from 'mongoose'
import type { Template } from '@slide-machine/shared'
import { TemplateModel, toTemplateDto } from '../models/template'
import {
  defaultTemplateId,
  getBuiltinTemplate,
  listBuiltinTemplates,
} from './builtin'

/** True when the id could address a MongoDB document at all. */
const couldBeStored = (id: string): boolean => Types.ObjectId.isValid(id)

/**
 * The template with this id, or undefined. Soft-deleted templates resolve to
 * undefined via the model's query middleware, so a deck pointing at a deleted
 * template falls back the same way it would for an unknown id.
 */
export const resolveTemplate = async (
  id: string,
): Promise<Template | undefined> => {
  const builtin = getBuiltinTemplate(id)
  if (builtin) return builtin
  if (!couldBeStored(id)) return undefined
  const doc = await TemplateModel.findById(id).catch(() => null)
  return doc ? toTemplateDto(doc) : undefined
}

/**
 * The template a `/t/:slug` permalink addresses, or undefined.
 *
 * Falls back to reading the slug as an id, which covers built-ins (whose id
 * is their slug) and the templates authored before permalinks existed, whose
 * document id is what `toTemplateDto` reports as their slug.
 */
export const resolveTemplateBySlug = async (
  slug: string,
): Promise<Template | undefined> => {
  const doc = await TemplateModel.findOne({ permalinkSlug: slug }).catch(
    () => null,
  )
  return doc ? toTemplateDto(doc) : resolveTemplate(slug)
}

/** True when a template with this id exists; cheaper to read at call sites
 * that only need to validate a reference. */
export const templateExists = async (id: string): Promise<boolean> =>
  (await resolveTemplate(id)) !== undefined

/**
 * The library a user may choose from (TMPL-1): every built-in, plus the
 * templates they authored. Their own come first — someone who has made a
 * template is usually reaching for it, not for the starter set.
 */
export const listTemplatesFor = async (
  userId: string | undefined,
): Promise<Template[]> => {
  const builtins = listBuiltinTemplates()
  if (!userId || !Types.ObjectId.isValid(userId)) return builtins
  const own = await TemplateModel.find({ ownerId: userId }).sort({
    updatedAt: -1,
  })
  return [...own.map(toTemplateDto), ...builtins]
}

/**
 * The template with this id, or the deployment's default when it is gone.
 *
 * For read paths only. Before templates could be authored they could never
 * disappear, so a missing one meant a broken reference worth refusing. Now a
 * user can delete their own, and a lecture that used it must still open — it
 * keeps its `templateId`, so restoring the template (P-10) brings its look
 * back, and until then it renders in the default rather than not at all.
 * Validation paths keep using `templateExists`, where a bad id should fail.
 */
export const resolveTemplateForRead = async (
  id: string,
): Promise<Template | undefined> =>
  (await resolveTemplate(id)) ?? getBuiltinTemplate(defaultTemplateId())

/** True when the id names a built-in, which nobody may edit or delete. */
export const isBuiltinTemplate = (id: string): boolean =>
  getBuiltinTemplate(id) !== undefined
