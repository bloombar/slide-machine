/**
 * User settings actions (AUTH-5). For now: profile visibility, which
 * gates the public profile page (SHARE-1).
 */
import { z } from 'zod'
import type {
  SafeUser,
  UserSetLanguageInput,
  UserSetProfileVisibilityInput,
} from '@slide-machine/shared'
import { LOCALES } from '@slide-machine/shared'
import { defineAction } from './define'
import { registerAction, ActionForbiddenError } from './dispatch'
import { UserModel, toUserDto } from '../models/user'

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
