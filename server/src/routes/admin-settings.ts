/**
 * Admin account settings editor (ADMIN-5): an audited PATCH endpoint that
 * lets an admin change any user's profile fields. Mounted inside
 * adminRouter (routes/admin.ts) after requireAuth + requireAdmin, so the
 * allowlist gate covers it too.
 *
 * The handler snapshots the account's settings, applies the patch, and
 * diffs the two snapshots — mongoose setters make a patch-vs-document
 * comparison lie, and it makes "the admin re-submitted the same value" a
 * free no-op. A patch that changes nothing is a 204 with no save and no
 * audit entry; anything else saves once and records `{field: {from, to}}`
 * in the admin action log.
 *
 * Projects and lectures have no counterpart here: an admin edits their
 * settings in the owner-facing settings modal, through the same actions
 * the owner uses (lib/admin-edit.ts). See docs/ADMINISTRATION.md
 * ("Editing settings").
 */
import { Router } from 'express'
import type { HydratedDocument } from 'mongoose'
import { z } from 'zod'
import { LOCALES } from '@slide-machine/shared'
import type { UserDb } from '../models/user'
import { logAdminAction } from '../audit/log'
import { diffSettings } from '../lib/settings-diff'
import { HttpError } from '../middleware/error'
import { actor, loadUser, rejectAdminTarget } from './admin-targets'

export const adminSettingsRouter = Router()

// Every field is optional: absent leaves it alone. `strictObject` rejects
// anything else outright (400) rather than dropping it silently, so a
// patch carrying e.g. planTier or email fails loudly.
const locale = () => z.enum(LOCALES).nullable().optional()

const userSettingsSchema = z.strictObject({
  displayName: z
    .string()
    .trim()
    .min(1, 'Display name is required')
    .max(200)
    .optional(),
  // Empty clears the bio (there is nothing to inherit at this level)
  bio: z.string().trim().max(2000).optional(),
  profileVisibility: z.enum(['public', 'private']).optional(),
  locale: z.enum(LOCALES).optional(),
  language: locale(),
})

/** Parses a settings patch or 400s with the offending fields listed. */
const parsePatch = <T extends z.ZodTypeAny>(
  schema: T,
  body: unknown,
): z.output<T> => {
  const parsed = schema.safeParse(body ?? {})
  if (!parsed.success) {
    throw new HttpError(
      400,
      'invalid_input',
      'Invalid settings',
      parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
    )
  }
  return parsed.data
}

/** The account's settings as the diff vocabulary sees them. */
const userSettingsSnapshot = (doc: HydratedDocument<UserDb>) => ({
  displayName: doc.displayName,
  bio: doc.bio,
  profileVisibility: doc.profileVisibility,
  locale: doc.locale,
  language: doc.language,
})

adminSettingsRouter.patch('/users/:id', async (req, res) => {
  const user = await loadUser(String(req.params.id))
  const admin = actor(req)
  // Refused before the body is even read, matching the password reset
  rejectAdminTarget(user.email)
  const input = parsePatch(userSettingsSchema, req.body)

  const before = userSettingsSnapshot(user)
  if (input.displayName !== undefined) user.displayName = input.displayName
  // Blank clears the field rather than storing an empty string
  if (input.bio !== undefined) user.bio = input.bio || undefined
  if (input.profileVisibility !== undefined) {
    user.profileVisibility = input.profileVisibility
  }
  if (input.locale !== undefined) user.locale = input.locale
  // null clears back to the browser default (stores nothing)
  if (input.language !== undefined) user.language = input.language ?? undefined
  const changes = diffSettings(before, userSettingsSnapshot(user))

  if (!Object.keys(changes).length) {
    res.status(204).end()
    return
  }
  await user.save()
  await logAdminAction({
    actorId: admin.id,
    actorEmail: admin.email,
    action: 'user.settings_update',
    targetType: 'user',
    targetId: user._id.toString(),
    details: { email: user.email, changes },
  })
  res.status(204).end()
})
