/**
 * Access policies for actions that operate on a lecture (SPEC TECH-14).
 *
 * These are the existing gates in actions/deck.ts moved behind a declaration:
 * `deckEditor` is what `loadEditableDeck` did, `deckOwner` what
 * `loadOwnedDeck` did, and `deckSettings` the admitting half of
 * `editDeckSettings`. The decisions are unchanged — every one still runs
 * through lib/access.ts — but they are now stated on the action rather than
 * buried in its handler, and the documents they load reach `execute` instead
 * of being fetched twice.
 */
import { DeckModel, loadDeckAcl } from '../../models/deck'
import { canEditAcl, canViewAcl } from '../../lib/access'
import { ActionForbiddenError } from '../dispatch'
import { definePolicy, type AccessPolicy, type PickId } from './policy'
import { projectOwner } from './project'
import { requireUser, overrideActor, requireAdminEmail } from './common'
import type {
  AdminActor,
  DeckAccess,
  DeckMoveAccess,
  DeckSettingsAccess,
} from './types'

/**
 * Loads the lecture named by `pick` and its resolved ACL, or refuses.
 * A missing lecture and one the caller may not reach answer identically.
 */
const loadDeck = async (
  userId: string,
  deckId: string,
): Promise<DeckAccess> => {
  const deck = await DeckModel.findById(deckId).catch(() => null)
  if (!deck) throw new ActionForbiddenError()
  return { userId, deck, acl: await loadDeckAcl(deck) }
}

/**
 * The content gate: the owner or an editor, granted on the lecture itself or
 * inherited from its project. Slides, recordings, refine runs, quizzes and
 * exports all pass through here, and an allowlisted admin never does —
 * ADMIN-3 keeps an admin's view of someone else's lecture read-only.
 */
export const deckEditor = <I>(pick: PickId<I>): AccessPolicy<I, DeckAccess> =>
  definePolicy({ resource: 'deck', level: 'edit' }, async (ctx, input) => {
    const access = await loadDeck(requireUser(ctx), pick(input))
    if (!canEditAcl(access.acl, access.userId)) throw new ActionForbiddenError()
    return access
  })

/** Anyone who may read the lecture — including anyone at all when it is public. */
export const deckViewer = <I>(pick: PickId<I>): AccessPolicy<I, DeckAccess> =>
  definePolicy({ resource: 'deck', level: 'view' }, async (ctx, input) => {
    const access = await loadDeck(requireUser(ctx), pick(input))
    if (!canViewAcl(access.acl, access.userId)) throw new ActionForbiddenError()
    return access
  })

/**
 * The owner alone — deliberately stricter than `deckEditor`. Deleting a
 * lecture or handing it to someone else is not something an editor may do.
 */
export const deckOwner = <I>(pick: PickId<I>): AccessPolicy<I, DeckAccess> =>
  definePolicy({ resource: 'deck', level: 'own' }, async (ctx, input) => {
    const access = await loadDeck(requireUser(ctx), pick(input))
    if (access.acl.ownerId !== access.userId) throw new ActionForbiddenError()
    return access
  })

/**
 * Moving a lecture into another project (PROJ-3): the caller must own the
 * lecture AND own the project it lands in.
 *
 * Two resources at once, which no single resource/level says — so it declares
 * itself, with the reason recorded, exactly as the other self-authorizing
 * actions do (access/policy.ts). The rule is still written as one policy
 * rather than left in the handler, and both halves reuse the levels they
 * would use alone: `deckOwner`'s check on the lecture, `projectOwner` on the
 * destination — the same gate `deck.create` applies, because a move puts a
 * lecture in a project the same way creating one there would.
 */
export const deckMove = <I>(
  pickDeck: PickId<I>,
  pickProject: PickId<I>,
): AccessPolicy<I, DeckMoveAccess> =>
  definePolicy(
    {
      resource: 'none',
      level: 'open',
      custom: {
        reason:
          'a move is two resources — the caller must own the lecture and own the destination project (the gate deck.create applies), and no single resource/level says both',
      },
    },
    async (ctx, input) => {
      const access = await loadDeck(requireUser(ctx), pickDeck(input))
      if (access.acl.ownerId !== access.userId) throw new ActionForbiddenError()
      const { project } = await projectOwner<I>(pickProject).authorize(
        ctx,
        input,
      )
      return { ...access, project }
    },
  )

/**
 * Admits the caller to a lecture's settings (ADMIN-5): an owner or editor as
 * usual, otherwise an allowlisted admin overriding the ACL — who is returned
 * so the audit half of a change can be filed against them without loading the
 * account a second time. Refuses anyone else.
 */
const settingsActor = async (access: DeckAccess): Promise<AdminActor | null> =>
  canEditAcl(access.acl, access.userId)
    ? null
    : overrideActor(access.userId, access.acl.ownerId)

/**
 * The settings gate: an owner or editor, otherwise an allowlisted admin.
 */
export const deckSettings = <I>(
  pick: PickId<I>,
): AccessPolicy<I, DeckSettingsAccess> =>
  definePolicy({ resource: 'deck', level: 'settings' }, async (ctx, input) => {
    const access = await loadDeck(requireUser(ctx), pick(input))
    return { ...access, admin: await settingsActor(access) }
  })

/**
 * The settings gate narrowed to the admin allowlist (EVAL-3): the same
 * admission as `deckSettings`, plus the actor must be an admin. An owner or
 * editor who is not allowlisted is refused — the study label is research
 * metadata, not a lecture setting every owner should manage — while an
 * admin who is neither reaches it on the audited override exactly as they
 * reach any other setting.
 */
export const deckSettingsAdmin = <I>(
  pick: PickId<I>,
): AccessPolicy<I, DeckSettingsAccess> =>
  definePolicy(
    { resource: 'deck', level: 'settingsAdmin' },
    async (ctx, input) => {
      const access = await loadDeck(requireUser(ctx), pick(input))
      const admin = await settingsActor(access)
      if (!admin) await requireAdminEmail(access.userId)
      return { ...access, admin }
    },
  )

/**
 * The settings gate for *reading* settings rather than changing them —
 * currently `deck.shares`, which answers "who is this shared with?".
 *
 * Admission is identical to `deckSettings`, deliberately: the share list is
 * management data, not content, and an admin looking at someone's settings
 * page needs to see it. What differs is what the caller then does with it. A
 * read declared this way skips the audit wrapper entirely, so it cannot file
 * a settings-change entry — where before it filed one and relied on the diff
 * coming out empty.
 */
export const deckSettingsView = <I>(
  pick: PickId<I>,
): AccessPolicy<I, DeckAccess> =>
  definePolicy(
    { resource: 'deck', level: 'settingsView' },
    async (ctx, input) => {
      const access = await loadDeck(requireUser(ctx), pick(input))
      await settingsActor(access)
      return access
    },
  )
