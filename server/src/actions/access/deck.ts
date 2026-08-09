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
import { requireUser, overrideActor } from './common'
import type { AdminActor, DeckAccess, DeckSettingsAccess } from './types'

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
