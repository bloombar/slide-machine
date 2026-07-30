/**
 * User settings actions (AUTH-5): the public profile fields shown on the
 * profile page, plus the account settings behind its Settings button —
 * profile visibility, which gates the page for strangers (SHARE-1), and
 * the lecturing language.
 */
import { z } from 'zod'
import type {
  SafeUser,
  UserSetLanguageInput,
  UserSetProfileVisibilityInput,
  UserUpdateProfileInput,
} from '@slide-machine/shared'
import { LOCALES } from '@slide-machine/shared'
import { defineAction } from './define'
import { registerAction, ActionForbiddenError } from './dispatch'
import { UserModel, toUserDto } from '../models/user'

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
    if (!ctx.userId) throw new ActionForbiddenError('Sign in to continue')
    const user = await UserModel.findById(ctx.userId)
    if (!user) throw new ActionForbiddenError()
    user.profileVisibility = input.profileVisibility
    await user.save()
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
    if (!ctx.userId) throw new ActionForbiddenError('Sign in to continue')
    const user = await UserModel.findById(ctx.userId)
    if (!user) throw new ActionForbiddenError()
    user.language = input.language ?? undefined
    await user.save()
    return toUserDto(user)
  },
})

registerAction(userSetLanguage)
