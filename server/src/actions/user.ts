/**
 * User account settings actions (AUTH-5): the display name and bio shown
 * on the profile, the profile visibility that gates the public profile
 * page (SHARE-1), the account type that chooses the account's privacy
 * defaults (AUTH-6), and the lecturing and interface languages. Every
 * change is recorded in the settings change log — see
 * docs/ADMINISTRATION.md ("Settings change log").
 */
import { z } from 'zod'
import type { HydratedDocument } from 'mongoose'
import type {
  SafeUser,
  UsageSummaryResponse,
  UserSetAccountTypeInput,
  UserSetLanguageInput,
  UserSetLocaleInput,
  UserSetProfileVisibilityInput,
  UserUpdateProfileInput,
} from '@slide-machine/shared'
import {
  ACCOUNT_TYPES,
  LOCALES,
  accountDefaultsToPrivate,
} from '@slide-machine/shared'
import { defineAction } from './define'
import { self, type SelfAccess } from './access'
import { registerAction } from './dispatch'
import { toUserDto, type UserDb } from '../models/user'
import { accountUsage } from '../billing/usage-view'
import { effectivePlanTier } from '../billing/plan-grant'
import { deleteUserCascade } from '../lib/cascade'
import { recordSettingsChange } from '../audit/settings-log'
import { userSettingsSnapshot } from '../lib/settings-snapshot'

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
export const userUpdateProfile = defineAction<
  UserUpdateProfileInput,
  SafeUser,
  SelfAccess
>({
  name: 'user.updateProfile',
  access: self(),
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
  execute: async (ctx, input, { user }) => {
    const before = userSettingsSnapshot(user)
    if (input.displayName !== undefined) user.displayName = input.displayName
    if (input.bio !== undefined) user.bio = input.bio || undefined
    await user.save()
    await recordSelfChange(user, before)
    return toUserDto(user)
  },
})

registerAction(userUpdateProfile)

export const userSetProfileVisibility = defineAction<
  UserSetProfileVisibilityInput,
  SafeUser,
  SelfAccess
>({
  name: 'user.setProfileVisibility',
  access: self(),
  input: z.object({ profileVisibility: z.enum(['public', 'private']) }),
  execute: async (ctx, input, { user }) => {
    const before = userSettingsSnapshot(user)
    user.profileVisibility = input.profileVisibility
    await user.save()
    await recordSelfChange(user, before)
    return toUserDto(user)
  },
})

registerAction(userSetProfileVisibility)

/**
 * Answers the post-sign-in prompt (AUTH-6) and, the first time only,
 * settles the account's privacy defaults from it: a student's profile
 * starts private, everyone else's stays public. Projects read the type
 * directly when they are created (actions/project.ts), so nothing else
 * has to be written here.
 *
 * Only the FIRST answer applies the defaults. Changing the type later
 * changes what new work starts as, and deliberately leaves the profile
 * alone: by then the visibility toggle beside it may hold a choice the
 * user actually made, and silently reversing it would be worse than
 * asking them to press one more control.
 */
export const userSetAccountType = defineAction<
  UserSetAccountTypeInput,
  SafeUser,
  SelfAccess
>({
  name: 'user.setAccountType',
  access: self(),
  input: z.object({ accountType: z.enum(ACCOUNT_TYPES) }),
  execute: async (ctx, input, { user }) => {
    const before = userSettingsSnapshot(user)
    const first = user.accountType === undefined
    user.accountType = input.accountType
    if (first && accountDefaultsToPrivate(input.accountType)) {
      user.profileVisibility = 'private'
    }
    await user.save()
    await recordSelfChange(user, before)
    return toUserDto(user)
  },
})

registerAction(userSetAccountType)

/** Explicit lecturing/generation language on the profile; null clears
 * it so the browser default applies again. */
export const userSetLanguage = defineAction<
  UserSetLanguageInput,
  SafeUser,
  SelfAccess
>({
  name: 'user.setLanguage',
  access: self(),
  input: z.object({ language: z.enum(LOCALES).nullable() }),
  execute: async (ctx, input, { user }) => {
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
export const userSetLocale = defineAction<
  UserSetLocaleInput,
  SafeUser,
  SelfAccess
>({
  name: 'user.setLocale',
  access: self(),
  input: z.object({ locale: z.enum(LOCALES).nullable() }),
  execute: async (ctx, input, { user }) => {
    const before = userSettingsSnapshot(user)
    user.locale = input.locale ?? undefined
    await user.save()
    await recordSelfChange(user, before)
    return toUserDto(user)
  },
})

registerAction(userSetLocale)

/**
 * Whether the account wants the advisory cap warning by email (BILL-8).
 *
 * Only the 80% notice is switchable. The message sent when a cap has actually
 * blocked something stays on whatever this is set to, because it is not
 * advice — it is the explanation for a thing the user just tried that did not
 * happen, and an unexplained failure is the outcome BILL-8 exists to prevent.
 * The in-app notices are likewise unaffected: they are derived from the
 * counters and always appear.
 */
export const userSetCapWarnings = defineAction<
  { enabled: boolean },
  SafeUser,
  SelfAccess
>({
  name: 'user.setCapWarnings',
  access: self(),
  input: z.object({ enabled: z.boolean() }),
  execute: async (ctx, input, { user }) => {
    const before = userSettingsSnapshot(user)
    user.notifyCapWarnings = input.enabled
    await user.save()
    await recordSelfChange(user, before)
    return toUserDto(user)
  },
})

registerAction(userSetCapWarnings)

/**
 * The account's own metered usage (BILL-4). Read-only, and scoped to the
 * caller: a plan's remaining quota is an account's own business, so there is
 * deliberately no way to ask for someone else's. An admin who needs to see it
 * reads it through the admin views, which are audited.
 */
export const userUsage = defineAction<
  Record<string, never>,
  UsageSummaryResponse,
  SelfAccess
>({
  name: 'user.usage',
  access: self(),
  input: z.object({}).strict(),
  execute: async (_ctx, _input, { user }) => {
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
  { deleted: true },
  SelfAccess
>({
  name: 'user.deleteAccount',
  access: self(),
  input: z.object({}).strict(),
  execute: async (_ctx, _input, { user }) => {
    await deleteUserCascade(user._id.toString())
    return { deleted: true }
  },
})

registerAction(userDeleteAccount)
