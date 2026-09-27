/**
 * Access policies for style templates (SPEC TECH-14, TMPL-26).
 *
 * A stored template now carries a real ACL — visibility, viewers, editors,
 * invites, the same shape a project's does (`templateAcl`,
 * models/template.ts) — so `canViewAcl`/`canEditAcl` decide most of it. What
 * stays template-specific, and is why these do not simply become
 * `deckViewer`/`deckEditor` under a different resource name, is what has no
 * lecture or project analogue: a built-in has no ACL at all and is always
 * readable, and a *private* design is also readable by anyone editing a
 * lecture drawn with it, whether or not they are on its people list.
 */
import type { HydratedDocument } from 'mongoose'
import {
  TemplateModel,
  templateAcl,
  type TemplateDb,
} from '../../models/template'
import { DeckModel, loadDeckAcls } from '../../models/deck'
import { canEditAcl, canViewAcl } from '../../lib/access'
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
 * the export offered in that lecture's own settings.
 *
 * Reached only for a restricted design belonging to someone else — but that
 * is true only because every path that assigns a `templateId` to a deck,
 * project or account checks `isTemplateReadable` before doing so, not by
 * anything inherent here: `deck.switchTemplate`, `project.switchTemplate`,
 * `user.setTemplate`, `deck.import`'s settings restore, and `project.create`'s
 * and `deck.create`'s own inherited defaults (a stale choice — the owner
 * unshared from a design after setting it as their default, or a project's
 * template likewise — is dropped for the deployment default, the same as an
 * outright deleted one already was). Without that enforcement everywhere
 * this would be exactly backwards: anyone could point a deck of their own at
 * a restricted template they cannot read and reach it through this very
 * fallback.
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
 * Whether `userId` may read this template at all: a built-in, a public one,
 * a member (owner, viewer or editor), or one that draws a lecture they may
 * edit. A missing template reads as unreadable too, so a caller that only
 * has a bare id — anything below that takes a `templateId` as plain input,
 * not as the resource an access policy loads — can refuse it exactly as it
 * refuses one that does not exist (TMPL-26): `project.switchTemplate`,
 * `deck.switchTemplate`, `user.setTemplate`, `deck.import`'s settings
 * restore, and `project.create`/`deck.create`'s own inherited-default
 * lookups all call this before pointing anything at the id they were given,
 * which is what closes the hole `drawsAnEditableDeck` would otherwise leave
 * open — pointing a deck of your own at a restricted template you cannot
 * read, then reading it back through this very fallback.
 */
export const isTemplateReadable = async (
  userId: string,
  templateId: string,
): Promise<boolean> => {
  const template = await resolveTemplate(templateId)
  if (!template) return false
  if (template.ownerId === 'system') return true
  const doc = await storedDoc(templateId)
  return (
    (doc ? canViewAcl(templateAcl(doc), userId) : false) ||
    (await drawsAnEditableDeck(userId, templateId))
  )
}

/**
 * A design the caller may read: a built-in, one they own, one they are a
 * viewer or editor of, one that is public, or one that draws a lecture they
 * may edit. Missing and forbidden answer identically, so an id cannot be
 * probed.
 */
export const templateReadable = <I>(
  pick: PickId<I>,
): AccessPolicy<I, TemplateAccess> =>
  definePolicy(
    { resource: 'template', level: 'readable' },
    async (ctx, input) => {
      const userId = requireUser(ctx)
      const templateId = pick(input)
      if (!(await isTemplateReadable(userId, templateId))) {
        throw new ActionForbiddenError()
      }
      // Re-resolved with the caller, so `myRole` (TMPL-26) is theirs and not
      // the `null` `isTemplateReadable`'s own internal lookup reads it as.
      const template = await resolveTemplate(templateId, userId)
      const doc = await storedDoc(templateId)
      return { userId, template: template!, doc }
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
      const template = await resolveTemplateBySlug(pick(input), userId)
      if (!template || !(await isTemplateReadable(userId, template.id))) {
        throw new ActionForbiddenError()
      }
      const doc = await storedDoc(template.id)
      return { userId, template, doc }
    },
  )

/**
 * Owner or editor: the design content itself — renaming, retheming, retuning
 * layouts, applying an update.
 *
 * A built-in is refused differently on purpose: its id is public and its
 * read-only-ness is not a permission but a fact about where it comes from, so
 * saying "duplicate it first" is the useful answer rather than a flat no.
 */
export const templateEditor = <I>(
  pick: PickId<I>,
): AccessPolicy<I, TemplateAuthorAccess> =>
  definePolicy(
    { resource: 'template', level: 'editor' },
    async (ctx, input) => {
      const userId = requireUser(ctx)
      const templateId = pick(input)
      if (isBuiltinTemplate(templateId)) {
        throw new ActionValidationError('template', [
          'built-in templates cannot be changed; duplicate it first',
        ])
      }
      const doc = await TemplateModel.findById(templateId).catch(() => null)
      if (!doc || !canEditAcl(templateAcl(doc), userId)) {
        throw new ActionForbiddenError()
      }
      const template = await resolveTemplate(templateId)
      if (!template) throw new ActionForbiddenError()
      return { userId, template, doc }
    },
  )

/**
 * The owner alone — deleting a design, or changing who else may reach it
 * (setAccess/share/unshare/shares). Deliberately stricter than
 * `templateEditor`: handing out or withdrawing access is not something an
 * editor may do on someone else's design.
 *
 * Refuses a built-in exactly as `templateEditor` does — nobody owns one, so
 * "duplicate it first" is the same useful answer here too.
 */
export const templateOwner = <I>(
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
