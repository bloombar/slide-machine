/**
 * The pieces every access policy shares (SPEC TECH-14): one definition of
 * "signed in", one refusal, and the admin-override admission the settings
 * levels are built on.
 *
 * Before this existed the sign-in check was written seven times across the
 * action files — some synchronous, some not, with two different messages.
 * One copy is the point.
 */
import { UserModel } from '../../models/user'
import { isAdminEmail } from '../../config/admin'
import { ActionForbiddenError } from '../dispatch'
import type { ActionContext } from '../context'
import type { AdminActor } from './types'

/**
 * The acting user's id, or a refusal.
 *
 * Refused rather than reported as unauthenticated: the HTTP route already
 * requires a token (routes/actions.ts), so reaching a policy without one
 * means an in-process caller with no user — not an expired session.
 */
export const requireUser = (ctx: ActionContext): string => {
  if (!ctx.userId) throw new ActionForbiddenError('Sign in to continue')
  return ctx.userId
}

/**
 * The admin behind an override, or a refusal. Two accounts are checked: the
 * actor must be allowlisted, and the entity's owner must not be — admins
 * moderate but are not moderated (ADMIN-1), so an admin's own content is off
 * limits here exactly as it is in the console.
 *
 * Lifted verbatim from lib/admin-edit.ts, which now calls this rather than
 * keeping its own copy.
 */
export const overrideActor = async (
  userId: string,
  ownerId: string,
): Promise<AdminActor> => {
  const actor = await UserModel.findById(userId).catch(() => null)
  if (!actor || !isAdminEmail(actor.email)) throw new ActionForbiddenError()
  const owner = await UserModel.findById(ownerId).catch(() => null)
  if (owner && isAdminEmail(owner.email)) throw new ActionForbiddenError()
  return { id: actor._id.toString(), email: actor.email }
}

/**
 * Refuses unless the acting account is allowlisted as an admin. For the rare
 * setting only an admin may touch even on their own entity (EVAL-3's study
 * label) — `overrideActor` cannot express that case, because there the actor
 * already holds edit access and nothing is being overridden.
 */
export const requireAdminEmail = async (userId: string): Promise<void> => {
  const actor = await UserModel.findById(userId).catch(() => null)
  if (!actor || !isAdminEmail(actor.email)) throw new ActionForbiddenError()
}
