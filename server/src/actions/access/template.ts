/**
 * Access policies for style templates (SPEC TECH-14).
 *
 * Templates carry their own three-value visibility (private / unlisted /
 * public) rather than an ACL, so these do NOT go through lib/access.ts. That
 * separation is deliberate and predates this work; what is new is that it is
 * now declared rather than implied.
 */
import type { HydratedDocument } from 'mongoose'
import { TemplateModel, type TemplateDb } from '../../models/template'
import { DeckModel, loadDeckAcls } from '../../models/deck'
import { canEditAcl } from '../../lib/access'
import {
  isBuiltinTemplate,
  resolveTemplate,
  resolveTemplateBySlug,
} from '../../templates/resolve'
import { ActionForbiddenError, ActionValidationError } from '../dispatch'
import { definePolicy, type AccessPolicy, type PickId } from './policy'
import { requireUser } from './common'
import type { TemplateAccess, TemplateAuthorAccess } from './types'

/**
 * True when a lecture the caller may edit is drawn with this design.
 *
 * Someone editing a shared lecture already sees its design on every slide, so
 * withholding the same design as a file would protect nothing while breaking
 * the export offered in that lecture's own settings. Reached only for a
 * private design belonging to someone else, which by definition only its
 * author can have applied — so the lectures searched are that one author's.
 */
const drawsAnEditableDeck = async (
  userId: string,
  templateId: string,
): Promise<boolean> => {
  const decks = await DeckModel.find({ templateId }).limit(200)
  if (decks.length === 0) return false
  const acls = await loadDeckAcls(decks)
  return decks.some(deck => canEditAcl(acls.get(deck._id.toString())!, userId))
}

/** The stored document behind a template, or null for a built-in. */
const storedDoc = async (
  templateId: string,
): Promise<HydratedDocument<TemplateDb> | null> =>
  isBuiltinTemplate(templateId)
    ? null
    : await TemplateModel.findById(templateId).catch(() => null)

/**
 * A design the caller may read: a built-in, one they authored, one its author
 * shared, or one that draws a lecture they may edit. Missing and forbidden
 * answer identically, so an id cannot be probed.
 */
export const templateReadable = <I>(
  pick: PickId<I>,
): AccessPolicy<I, TemplateAccess> =>
  definePolicy(
    { resource: 'template', level: 'readable' },
    async (ctx, input) => {
      const userId = requireUser(ctx)
      const templateId = pick(input)
      const template = await resolveTemplate(templateId)
      if (!template) throw new ActionForbiddenError()
      const own = template.ownerId === userId
      const builtin = template.ownerId === 'system'
      const shared = template.visibility !== 'private'
      if (
        !own &&
        !builtin &&
        !shared &&
        !(await drawsAnEditableDeck(userId, templateId))
      ) {
        throw new ActionForbiddenError()
      }
      return { userId, template, doc: await storedDoc(templateId) }
    },
  )

/** The same rule, addressed by permalink rather than id — template.get. */
export const templateReadableBySlug = <I>(
  pick: PickId<I>,
): AccessPolicy<I, TemplateAccess> =>
  definePolicy(
    { resource: 'template', level: 'readable' },
    async (ctx, input) => {
      const userId = requireUser(ctx)
      const template = await resolveTemplateBySlug(pick(input))
      if (!template) throw new ActionForbiddenError()
      if (template.ownerId !== userId && template.visibility === 'private') {
        throw new ActionForbiddenError()
      }
      return { userId, template, doc: await storedDoc(template.id) }
    },
  )

/**
 * The author alone — renaming, retheming, deleting.
 *
 * A built-in is refused differently on purpose: its id is public and its
 * read-only-ness is not a permission but a fact about where it comes from, so
 * saying "duplicate it first" is the useful answer rather than a flat no.
 */
export const templateAuthor = <I>(
  pick: PickId<I>,
): AccessPolicy<I, TemplateAuthorAccess> =>
  definePolicy(
    { resource: 'template', level: 'author' },
    async (ctx, input) => {
      const userId = requireUser(ctx)
      const templateId = pick(input)
      if (isBuiltinTemplate(templateId)) {
        throw new ActionValidationError('template', [
          'built-in templates cannot be changed; duplicate it first',
        ])
      }
      const doc = await TemplateModel.findById(templateId).catch(() => null)
      if (!doc || doc.ownerId.toString() !== userId) {
        throw new ActionForbiddenError()
      }
      const template = await resolveTemplate(templateId)
      if (!template) throw new ActionForbiddenError()
      return { userId, template, doc }
    },
  )
