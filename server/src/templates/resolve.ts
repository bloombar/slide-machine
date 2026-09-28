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
 *
 * `userId` is the signed-in caller, when the DTO is headed back to them —
 * pass it so `myRole` (TMPL-26) reads correctly; omit it where the result is
 * read for its structure alone (generation, export-time lookups, a template
 * resolved for someone other than the caller), where it reads `null`, same
 * as a built-in.
 */
export const resolveTemplate = async (
  id: string,
  userId?: string,
): Promise<Template | undefined> => {
  const builtin = getBuiltinTemplate(id)
  if (builtin) return builtin
  if (!couldBeStored(id)) return undefined
  const doc = await TemplateModel.findById(id).catch(() => null)
  return doc ? toTemplateDto(doc, userId) : undefined
}

/**
 * The template a `/t/:slug` permalink addresses, or undefined.
 *
 * Falls back to reading the slug as an id, which covers built-ins (whose id
 * is their slug) and the templates authored before permalinks existed, whose
 * document id is what `toTemplateDto` reports as their slug. `userId` is the
 * signed-in caller, as `resolveTemplate`'s.
 */
export const resolveTemplateBySlug = async (
  slug: string,
  userId?: string,
): Promise<Template | undefined> => {
  const doc = await TemplateModel.findOne({ permalinkSlug: slug }).catch(
    () => null,
  )
  return doc ? toTemplateDto(doc, userId) : resolveTemplate(slug, userId)
}

/** True when a template with this id exists; cheaper to read at call sites
 * that only need to validate a reference. */
export const templateExists = async (id: string): Promise<boolean> =>
  (await resolveTemplate(id)) !== undefined

/**
 * The library a user may choose from (TMPL-1, TMPL-26): every built-in, plus
 * the templates they authored, plus — unless told otherwise — the ones
 * shared with them (a viewer or an editor on the design's people list). Own
 * templates come first, then shared ones, then the built-ins: someone who
 * has made a template is usually reaching for it, not for the starter set,
 * and a design shared with them is closer to theirs than a built-in is.
 *
 * `includeShared: false` is for `template.duplicate`'s name-collision check
 * alone — a shared design is not the caller's to collide names with, even
 * though it does belong in the library they see.
 */
export const listTemplatesFor = async (
  userId: string | undefined,
  opts: { includeShared?: boolean } = {},
): Promise<Template[]> => {
  const builtins = listBuiltinTemplates()
  if (!userId || !Types.ObjectId.isValid(userId)) return builtins
  const own = await TemplateModel.find({ ownerId: userId }).sort({
    updatedAt: -1,
  })
  const ownDtos = own.map(doc => toTemplateDto(doc, userId))
  if (opts.includeShared === false) return [...ownDtos, ...builtins]
  const shared = await TemplateModel.find({
    ownerId: { $ne: userId },
    $or: [{ viewers: userId }, { editors: userId }],
  }).sort({ updatedAt: -1 })
  const sharedDtos = shared.map(doc => toTemplateDto(doc, userId))
  return [...ownDtos, ...sharedDtos, ...builtins]
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
 * `userId` is the signed-in caller, as `resolveTemplate`'s.
 */
export const resolveTemplateForRead = async (
  id: string,
  userId?: string,
): Promise<Template | undefined> =>
  (await resolveTemplate(id, userId)) ?? getBuiltinTemplate(defaultTemplateId())

/** True when the id names a built-in, which nobody may edit or delete. */
export const isBuiltinTemplate = (id: string): boolean =>
  getBuiltinTemplate(id) !== undefined
