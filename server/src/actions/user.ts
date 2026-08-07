/**
 * User account settings actions (AUTH-5): the display name and bio shown
 * on the profile, the profile visibility that gates the public profile
 * page (SHARE-1), and the lecturing and interface languages. Every change
 * is recorded in the settings change log — see docs/ADMINISTRATION.md
 * ("Settings change log").
 */
import { z } from 'zod'
import type { HydratedDocument } from 'mongoose'
import type {
  SafeUser,
  UsageSummaryResponse,
  UserSetLanguageInput,
  UserSetLocaleInput,
  UserSetProfileVisibilityInput,
  UserUpdateProfileInput,
} from '@slide-machine/shared'
import { LOCALES } from '@slide-machine/shared'
import { defineAction } from './define'
import { registerAction, ActionForbiddenError } from './dispatch'
import { UserModel, toUserDto, type UserDb } from '../models/user'
import { accountUsage } from '../billing/usage-view'
import { effectivePlanTier } from '../billing/plan-grant'
import { deleteUserCascade } from '../lib/cascade'
import { recordSettingsChange } from '../audit/settings-log'
import { userSettingsSnapshot } from '../lib/settings-snapshot'

/** The signed-in account, or a refusal; every action here edits its own. */
const loadSelf = async (
  userId: string | undefined,
): Promise<HydratedDocument<UserDb>> => {
  if (!userId) throw new ActionForbiddenError('Sign in to continue')
  const user = await UserModel.findById(userId)
  if (!user) throw new ActionForbiddenError()
  return user
}

/** Logs what an account holder changed about their own settings. The
 * actor is the account itself, so its email needs no extra lookup. */
const recordSelfChange = (
  user: HydratedDocument<UserDb>,
  before: ReturnType<typeof userSettingsSnapshot>,
): Promise<void> =>
  recordSettingsChange({
    actorId: user._id.toString(),
    actorEmail: user.email,
    actorRole: 'owner',
    entityType: 'user',
    entityId: user._id.toString(),
    entityName: user.email,
    ownerId: user._id.toString(),
    before,
    after: userSettingsSnapshot(user),
  })

/** Self-service edit of the fields strangers see on the profile page.
 * Field rules match the admin endpoint's (routes/admin-settings.ts) so
 * both paths accept and store exactly the same values. */
export const userUpdateProfile = defineAction<UserUpdateProfileInput, SafeUser>(
  {
    name: 'user.updateProfile',
    input: z.object({
      displayName: z
        .string()
        .trim()
        .min(1, 'Display name is required')
        .max(200)
        .optional(),
      // Empty clears the bio (there is nothing to inherit at this level)
      bio: z.string().trim().max(2000).optional(),
    }),
    execute: async (ctx, input) => {
      const user = await loadSelf(ctx.userId)
      const before = userSettingsSnapshot(user)
      if (input.displayName !== undefined) user.displayName = input.displayName
      if (input.bio !== undefined) user.bio = input.bio || undefined
      await user.save()
      await recordSelfChange(user, before)
      return toUserDto(user)
    },
  },
)

registerAction(userUpdateProfile)

export const userSetProfileVisibility = defineAction<
  UserSetProfileVisibilityInput,
  SafeUser
>({
  name: 'user.setProfileVisibility',
  input: z.object({ profileVisibility: z.enum(['public', 'private']) }),
  execute: async (ctx, input) => {
    const user = await loadSelf(ctx.userId)
    const before = userSettingsSnapshot(user)
    user.profileVisibility = input.profileVisibility
    await user.save()
    await recordSelfChange(user, before)
    return toUserDto(user)
  },
})

registerAction(userSetProfileVisibility)

/** Explicit lecturing/generation language on the profile; null clears
 * it so the browser default applies again. */
export const userSetLanguage = defineAction<UserSetLanguageInput, SafeUser>({
  name: 'user.setLanguage',
  input: z.object({ language: z.enum(LOCALES).nullable() }),
  execute: async (ctx, input) => {
    const user = await loadSelf(ctx.userId)
    const before = userSettingsSnapshot(user)
    user.language = input.language ?? undefined
    await user.save()
    await recordSelfChange(user, before)
    return toUserDto(user)
  },
})

registerAction(userSetLanguage)

/** Interface language (TECH-12). Mirrors userSetLanguage: nothing is
 * stored until a language is explicitly chosen, and null clears the
 * choice so the interface follows the browser again. */
export const userSetLocale = defineAction<UserSetLocaleInput, SafeUser>({
  name: 'user.setLocale',
  input: z.object({ locale: z.enum(LOCALES).nullable() }),
  execute: async (ctx, input) => {
    const user = await loadSelf(ctx.userId)
    const before = userSettingsSnapshot(user)
    user.locale = input.locale ?? undefined
    await user.save()
    await recordSelfChange(user, before)
    return toUserDto(user)
  },
})

registerAction(userSetLocale)

/**
 * The account's own metered usage (BILL-4). Read-only, and scoped to the
 * caller: a plan's remaining quota is an account's own business, so there is
 * deliberately no way to ask for someone else's. An admin who needs to see it
 * reads it through the admin views, which are audited.
 */
export const userUsage = defineAction<
  Record<string, never>,
  UsageSummaryResponse
>({
  name: 'user.usage',
  input: z.object({}).strict(),
  execute: async ctx => {
    const user = await loadSelf(ctx.userId)
    // The effective tier: a comped account is metered against the plan it was
    // given, so the bars it reads are the caps it is actually held to.
    return accountUsage(user._id.toString(), effectivePlanTier(user))
  },
})

registerAction(userUsage)

/**
 * Closes the caller's own account (P-10). A **soft** delete: the account and
 * everything under it is tombstoned, not erased, so it can be restored during
 * the retention window before the purge sweep hard-deletes it (P-11).
 *
 * Scoped to the caller, like every other action here. An admin closing someone
 * else's account goes through the audited admin endpoint instead — the same
 * cascade, but recorded against the admin who ran it.
 *
 * The cascade also drops every refresh token, so the account is signed out the
 * moment this returns rather than lingering until the access token expires.
 */
export const userDeleteAccount = defineAction<
  Record<string, never>,
  { deleted: true }
>({
  name: 'user.deleteAccount',
  input: z.object({}).strict(),
  execute: async ctx => {
    const user = await loadSelf(ctx.userId)
    await deleteUserCascade(user._id.toString())
    return { deleted: true }
  },
})

registerAction(userDeleteAccount)
