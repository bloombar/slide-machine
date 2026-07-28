/**
 * Admin settings editors (ADMIN-5): audited PATCH endpoints that let an
 * admin change the settings of any user, project, or lecture, even when
 * they do not own it. Mounted inside adminRouter (routes/admin.ts) after
 * requireAuth + requireAdmin, so the allowlist gate covers these too.
 *
 * Each handler snapshots the entity's settings, applies the patch, and
 * diffs the two snapshots — mongoose setters and the lecture's
 * copy-on-write ACL make a patch-vs-document comparison lie, and it makes
 * "the admin re-submitted the same value" a free no-op. A patch that
 * changes nothing is a 204 with no save and no audit entry; anything else
 * saves once and records `{field: {from, to}}` in the admin action log.
 *
 * These deliberately mirror, rather than reuse, the owner-facing
 * counterparts — `project.update`/`project.setAccess`
 * (actions/project.ts) and `deck.setAccess`/`deck.resetAccess`/
 * `deck.setGenerationFreedom`/`deck.setRefineSettings`/
 * `deck.setLanguage`/`deck.setTtsVoice` (actions/deck.ts) — because those
 * are a dozen single-field actions with their own authorization and
 * response shapes. Keep the null-means-inherit semantics in step with
 * them. See docs/ADMINISTRATION.md ("Editing settings").
 */
import { Router } from 'express'
import type { HydratedDocument, Types } from 'mongoose'
import { z } from 'zod'
import {
  LOCALES,
  type AdminDeckSettings,
  type AdminDeckSettingsView,
} from '@slide-machine/shared'
import { UserModel, type UserDb } from '../models/user'
import { ProjectModel, type ProjectDb } from '../models/project'
import { ensureDeckOverride, resolveDeckAcl, type DeckDb } from '../models/deck'
import { logAdminAction } from '../audit/log'
import { diffSettings } from '../lib/settings-diff'
import { ttsVoiceIdSchema } from '../lib/tts-voice'
import type { ResolvedAcl } from '../lib/access'
import { env } from '../config/env'
import { HttpError } from '../middleware/error'
import {
  actor,
  loadDeck,
  loadProject,
  loadUser,
  rejectAdminTarget,
} from './admin-targets'

export const adminSettingsRouter = Router()

// Every field is optional: absent leaves it alone. `strictObject` rejects
// anything else outright (400) rather than dropping it silently, so a
// patch carrying e.g. planTier or email fails loudly.
const VISIBILITY = ['restricted', 'public'] as const
/** A 1-5 setting that null clears back to its inherited value. */
const level = () => z.number().int().min(1).max(5).nullable().optional()
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

const projectSettingsSchema = z.strictObject({
  visibility: z.enum(VISIBILITY).optional(),
  generationFreedom: level(),
  language: locale(),
  ttsVoice: ttsVoiceIdSchema.nullable().optional(),
})

const deckSettingsSchema = z.strictObject({
  // null drops the lecture's override so it follows its project again
  visibility: z.enum(VISIBILITY).nullable().optional(),
  generationFreedom: level(),
  language: locale(),
  ttsVoice: ttsVoiceIdSchema.nullable().optional(),
  refineIdentifySpeakers: z.boolean().nullable().optional(),
  refineSlidesEnabled: z.boolean().nullable().optional(),
  refineSlidesLevel: level(),
  refineTranscriptEnabled: z.boolean().nullable().optional(),
  refineTranscriptLevel: level(),
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

/** The project's settings as the diff vocabulary sees them. Projects sit
 * at the top of the ACL tree, so their stored visibility is the effective
 * one (nothing to inherit). */
const projectSettingsSnapshot = (doc: HydratedDocument<ProjectDb>) => ({
  visibility: doc.visibility,
  generationFreedom: doc.generationFreedom,
  language: doc.language,
  ttsVoice: doc.ttsVoice,
})

/** The lecture's settings as the diff vocabulary sees them. `visibility`
 * is the EFFECTIVE one and `accessInherited` says where it came from:
 * pinning a lecture to the visibility it already inherits still detaches
 * it from its project, and that flag is the only signal of it. */
export const deckSettingsSnapshot = (
  doc: HydratedDocument<DeckDb>,
  acl: ResolvedAcl,
): AdminDeckSettings => ({
  visibility: acl.visibility,
  accessInherited: acl.inherited,
  generationFreedom: doc.generationFreedom,
  language: doc.language,
  ttsVoice: doc.ttsVoice,
  refineIdentifySpeakers: doc.refineIdentifySpeakers,
  refineSlidesEnabled: doc.refineSlidesEnabled,
  refineSlidesLevel: doc.refineSlidesLevel,
  refineTranscriptEnabled: doc.refineTranscriptEnabled,
  refineTranscriptLevel: doc.refineTranscriptLevel,
})

/** The lecture settings the admin lecture page reads, with the project
 * freedom the slider positions itself against while inheriting. */
export const deckSettingsView = (
  doc: HydratedDocument<DeckDb>,
  acl: ResolvedAcl,
  project: Pick<ProjectDb, 'generationFreedom'> | null,
): AdminDeckSettingsView => ({
  ...deckSettingsSnapshot(doc, acl),
  effectiveGenerationFreedom:
    project?.generationFreedom ?? env.GENERATION_FREEDOM,
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

/**
 * Refuses the edit when the entity's owner is allowlisted (ADMIN-1: an
 * admin's own content is not moderated either). A missing owner means the
 * entity is mid-cascade-deletion, so there is no account to protect.
 */
const rejectAdminOwner = async (ownerId: Types.ObjectId) => {
  const owner = await UserModel.findById(ownerId)
  if (owner) rejectAdminTarget(owner.email)
}

adminSettingsRouter.patch('/projects/:id', async (req, res) => {
  const project = await loadProject(String(req.params.id))
  const admin = actor(req)
  await rejectAdminOwner(project.ownerId)
  const input = parsePatch(projectSettingsSchema, req.body)

  const before = projectSettingsSnapshot(project)
  if (input.visibility !== undefined) project.visibility = input.visibility
  // null on any of the three clears this level so it inherits again
  if (input.generationFreedom !== undefined) {
    project.generationFreedom = input.generationFreedom ?? undefined
  }
  if (input.language !== undefined) {
    project.language = input.language ?? undefined
  }
  if (input.ttsVoice !== undefined) {
    project.ttsVoice = input.ttsVoice ?? undefined
  }
  const changes = diffSettings(before, projectSettingsSnapshot(project))

  if (!Object.keys(changes).length) {
    res.status(204).end()
    return
  }
  await project.save()
  await logAdminAction({
    actorId: admin.id,
    actorEmail: admin.email,
    action: 'project.settings_update',
    targetType: 'project',
    targetId: project._id.toString(),
    details: {
      title: project.title,
      ownerId: project.ownerId.toString(),
      changes,
    },
  })
  res.status(204).end()
})

adminSettingsRouter.patch('/decks/:id', async (req, res) => {
  const deck = await loadDeck(String(req.params.id))
  const admin = actor(req)
  // The lecture's OWN owner, which can differ from its project's after a
  // transfer — that is whose content this is.
  await rejectAdminOwner(deck.ownerId)
  const input = parsePatch(deckSettingsSchema, req.body)

  const project = await ProjectModel.findById(deck.projectId).catch(() => null)
  const before = deckSettingsSnapshot(deck, resolveDeckAcl(deck, project))
  if (input.visibility !== undefined) {
    if (input.visibility === null) {
      // Follow the project again (mirrors deck.resetAccess)
      deck.accessOverride = undefined
    } else {
      // Copy-on-write: pinning visibility snapshots the inherited people
      // lists onto the lecture, which then stops following its project
      ensureDeckOverride(deck, resolveDeckAcl(deck, project))
      deck.accessOverride!.visibility = input.visibility
    }
    deck.markModified('accessOverride')
  }
  if (input.generationFreedom !== undefined) {
    deck.generationFreedom = input.generationFreedom ?? undefined
  }
  if (input.language !== undefined) deck.language = input.language ?? undefined
  if (input.ttsVoice !== undefined) deck.ttsVoice = input.ttsVoice ?? undefined
  if (input.refineIdentifySpeakers !== undefined) {
    deck.refineIdentifySpeakers = input.refineIdentifySpeakers ?? undefined
  }
  if (input.refineSlidesEnabled !== undefined) {
    deck.refineSlidesEnabled = input.refineSlidesEnabled ?? undefined
  }
  if (input.refineSlidesLevel !== undefined) {
    deck.refineSlidesLevel = input.refineSlidesLevel ?? undefined
  }
  if (input.refineTranscriptEnabled !== undefined) {
    deck.refineTranscriptEnabled = input.refineTranscriptEnabled ?? undefined
  }
  if (input.refineTranscriptLevel !== undefined) {
    deck.refineTranscriptLevel = input.refineTranscriptLevel ?? undefined
  }
  // Re-resolved after the assignments: dropping or adding an override
  // changes where the effective access comes from.
  const changes = diffSettings(
    before,
    deckSettingsSnapshot(deck, resolveDeckAcl(deck, project)),
  )

  if (!Object.keys(changes).length) {
    res.status(204).end()
    return
  }
  await deck.save()
  await logAdminAction({
    actorId: admin.id,
    actorEmail: admin.email,
    action: 'deck.settings_update',
    targetType: 'deck',
    targetId: deck._id.toString(),
    details: {
      title: deck.title,
      ownerId: deck.ownerId.toString(),
      changes,
    },
  })
  res.status(204).end()
})
