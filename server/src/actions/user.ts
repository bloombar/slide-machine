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
  UserSetProfileVisibilityInput,
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
