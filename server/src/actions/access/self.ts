/**
 * Access policies for actions that name no resource (SPEC TECH-14).
 *
 * Three levels of "nothing to look up": the caller's own account, merely
 * being signed in, and open to anyone the route already let through.
 */
import { UserModel } from '../../models/user'
import { ActionForbiddenError } from '../dispatch'
import { definePolicy, type AccessPolicy } from './policy'
import { requireUser } from './common'
import type { SelfAccess, Signed } from './types'

/**
 * The caller's own account, loaded.
 *
 * The billing and profile actions accept no id naming a customer or a
 * subscription — what they touch is looked up from the context — so "self" is
 * the whole of their access rule rather than a check on top of one. An
 * account that no longer exists is refused: the token outlived the user.
 *
 * `select` adds fields the schema hides by default, for the callers that
 * need them (a Google refresh token, a password hash).
 */
export const self = <I>(select?: string): AccessPolicy<I, SelfAccess> =>
  definePolicy({ resource: 'self', level: 'self' }, async ctx => {
    const userId = requireUser(ctx)
    const query = UserModel.findById(userId)
    const user = await (select ? query.select(select) : query)
    if (!user) throw new ActionForbiddenError()
    return { userId, user }
  })

/**
 * Signed in, nothing more — for actions whose result is the same for every
 * account, or which scope themselves by filtering on the caller's id.
 */
export const signedIn = <I>(): AccessPolicy<I, Signed> =>
  definePolicy({ resource: 'none', level: 'signedIn' }, async ctx => ({
    userId: requireUser(ctx),
  }))

/**
 * No requirement of its own. For genuinely public data — a published price
 * list, an echo — where the route's own authentication is the only gate and
 * there is nothing further to decide.
 */
export const open = <I>(): AccessPolicy<I, undefined> =>
  definePolicy(
    { resource: 'none', level: 'open' },
    async () => undefined as undefined,
  )

/**
 * An action that authorizes itself, with the reason recorded.
 *
 * For rules that are genuinely not one resource at one level — a public feed
 * whose Mongo filter *is* its authorization, and which therefore has no
 * single document to resolve. The reason is required and the registry test
 * publishes it, so an unguarded action is always a decision somebody wrote
 * down rather than an omission nobody noticed.
 *
 * It still refuses an anonymous caller: escaping the vocabulary is not
 * escaping the need to be signed in.
 */
export const custom = <I>(reason: string): AccessPolicy<I, Signed> =>
  definePolicy(
    { resource: 'none', level: 'open', custom: { reason } },
    async ctx => ({ userId: requireUser(ctx) }),
  )
