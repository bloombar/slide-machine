/**
 * User account settings actions (AUTH-5): profile visibility, which gates
 * the public profile page (SHARE-1), and the lecturing language. Every
 * change is recorded in the settings change log — see
 * docs/ADMINISTRATION.md ("Settings change log").
 */
import { z } from 'zod'
import type { HydratedDocument } from 'mongoose'
import type {
  SafeUser,
  UserSetLanguageInput,
  UserSetLocaleInput,
  UserSetProfileVisibilityInput,
  UserUpdateProfileInput,
} from '@slide-machine/shared'
import { LOCALES } from '@slide-machine/shared'
import { defineAction } from './define'
import { registerAction, ActionForbiddenError } from './dispatch'
import { UserModel, toUserDto, type UserDb } from '../models/user'
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
      if (!ctx.userId) throw new ActionForbiddenError('Sign in to continue')
      const user = await UserModel.findById(ctx.userId)
      if (!user) throw new ActionForbiddenError()
      if (input.displayName !== undefined) user.displayName = input.displayName
      if (input.bio !== undefined) user.bio = input.bio || undefined
      await user.save()
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

/** Interface language (TECH-12). Mirrors userSetLanguage, but is not
 * nullable: an account always has a locale, so there is nothing to clear
 * back to. */
export const userSetLocale = defineAction<UserSetLocaleInput, SafeUser>({
  name: 'user.setLocale',
  input: z.object({ locale: z.enum(LOCALES) }),
  execute: async (ctx, input) => {
    const user = await loadSelf(ctx.userId)
    const before = userSettingsSnapshot(user)
    user.locale = input.locale
    await user.save()
    await recordSelfChange(user, before)
    return toUserDto(user)
  },
})

registerAction(userSetLocale)
