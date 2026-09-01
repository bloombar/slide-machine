/**
 * What counts as an entity's "settings", in one place. Each function
 * flattens the editable settings of an account, project, or lecture into
 * a plain object; callers take one before an edit and one after, and
 * lib/settings-diff.ts says what changed.
 *
 * Both audit trails read these, so the field lists are the vocabulary of
 * both: the admin action log (ADMIN-5, admin edits only) and the settings
 * change log (every settings edit, whoever made it). Adding a setting to
 * an editor means adding it here.
 */
import type { HydratedDocument } from 'mongoose'
import type { UserDb } from '../models/user'
import type { ProjectDb } from '../models/project'
import type { DeckDb } from '../models/deck'
import type { ResolvedAcl } from './access'

/** A people list as one comparable, loggable value: its ids, sorted so a
 * reordering alone never reads as a change. */
const people = (ids: string[]): string => [...ids].sort().join(', ')

/**
 * The account settings reachable from the profile page and the admin
 * account editor. Credentials (email, password) and billing state (plan
 * tier) are governed elsewhere and deliberately absent.
 */
export const userSettingsSnapshot = (doc: HydratedDocument<UserDb>) => ({
  displayName: doc.displayName,
  bio: doc.bio,
  profileVisibility: doc.profileVisibility,
  accountType: doc.accountType,
  locale: doc.locale,
  language: doc.language,
  templateId: doc.templateId,
  notifyCapWarnings: doc.notifyCapWarnings,
})

/** The project settings reachable from the project settings modal,
 * including the ownership its Privacy & Sharing tab can transfer. */
export const projectSettingsSnapshot = (doc: HydratedDocument<ProjectDb>) => ({
  title: doc.title,
  ownerId: doc.ownerId.toString(),
  visibility: doc.visibility,
  templateId: doc.templateId,
  seedContext: doc.seedContext,
  generationFreedom: doc.generationFreedom,
  language: doc.language,
  ttsVoice: doc.ttsVoice,
  viewers: people(doc.viewers ?? []),
  editors: people(doc.editors ?? []),
})

/**
 * The lecture settings reachable from the lecture settings modal.
 * `visibility` is the EFFECTIVE one and `accessInherited` says where it
 * came from: pinning a lecture to the visibility it already inherits
 * still detaches it from its project, and that flag is the only signal.
 * `projectId` is here because a move (PROJ-3) changes which project's
 * settings the lecture inherits, and an inheriting lecture's effective
 * access can change with it — the field says why the rest of the entry
 * moved.
 */
export const deckSettingsSnapshot = (
  doc: HydratedDocument<DeckDb>,
  acl: ResolvedAcl,
) => ({
  title: doc.title,
  ownerId: doc.ownerId.toString(),
  projectId: doc.projectId.toString(),
  visibility: acl.visibility,
  accessInherited: acl.inherited,
  templateId: doc.templateId,
  seedContext: doc.seedContext,
  generationFreedom: doc.generationFreedom,
  language: doc.language,
  ttsVoice: doc.ttsVoice,
  studyLabel: doc.studyLabel,
  refineIdentifySpeakers: doc.refineIdentifySpeakers,
  refineSlidesEnabled: doc.refineSlidesEnabled,
  refineSlidesLevel: doc.refineSlidesLevel,
  refineTranscriptEnabled: doc.refineTranscriptEnabled,
  refineTranscriptLevel: doc.refineTranscriptLevel,
  viewers: people(acl.viewers),
  editors: people(acl.editors),
})
