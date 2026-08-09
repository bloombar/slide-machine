/**
 * Access policies for actions reached through something a lecture owns
 * (SPEC TECH-14) — a slide, or a refine job.
 *
 * Neither carries an ACL of its own: the question is always whether the
 * caller may edit the lecture it belongs to. The input names the child, so
 * the policy dereferences to the parent and gates there — and hands back
 * both, since `execute` invariably wants each.
 */
import { SlideModel } from '../../models/slide'
import { RefineJobModel } from '../../models/refine-job'
import { DeckModel, loadDeckAcl } from '../../models/deck'
import { canEditAcl } from '../../lib/access'
import { ActionForbiddenError } from '../dispatch'
import { definePolicy, type AccessPolicy, type PickId } from './policy'
import { requireUser } from './common'
import type { DeckAccess, RefineJobAccess, SlideAccess } from './types'

/** The lecture behind a child record, gated for editing. */
const editableParent = async (
  userId: string,
  deckId: unknown,
): Promise<DeckAccess> => {
  const deck = await DeckModel.findById(deckId).catch(() => null)
  if (!deck) throw new ActionForbiddenError()
  const acl = await loadDeckAcl(deck)
  if (!canEditAcl(acl, userId)) throw new ActionForbiddenError()
  return { userId, deck, acl }
}

/**
 * A slide the caller may edit, via its lecture's ACL. Replaces the
 * `loadOwnedSlide` helper, whose name outlived its rule — it admitted
 * editors, not only owners.
 */
export const slideEditor = <I>(pick: PickId<I>): AccessPolicy<I, SlideAccess> =>
  definePolicy({ resource: 'slide', level: 'edit' }, async (ctx, input) => {
    const userId = requireUser(ctx)
    const slide = await SlideModel.findById(pick(input)).catch(() => null)
    if (!slide) throw new ActionForbiddenError()
    return { ...(await editableParent(userId, slide.deckId)), slide }
  })

/**
 * A refine job, reached through the lecture it was started for. The only
 * policy whose input names something other than the thing authorized.
 */
export const refineJobEditor = <I>(
  pick: PickId<I>,
): AccessPolicy<I, RefineJobAccess> =>
  definePolicy({ resource: 'refineJob', level: 'edit' }, async (ctx, input) => {
    const userId = requireUser(ctx)
    const job = await RefineJobModel.findById(pick(input)).catch(() => null)
    if (!job) throw new ActionForbiddenError()
    return { ...(await editableParent(userId, job.deckId)), job }
  })
