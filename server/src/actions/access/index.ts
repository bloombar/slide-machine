/**
 * The access vocabulary an action declares from (SPEC TECH-14).
 *
 * One import for every policy constructor, so an action definition reads as
 * a statement of its rule rather than a tour of the modules behind it.
 */
export {
  definePolicy,
  type AccessPolicy,
  type AccessDescriptor,
  type AccessResource,
  type AccessLevel,
  type AccessCapability,
  type PickId,
} from './policy'

export * from './types'

export { requireUser, overrideActor } from './common'
export {
  deckEditor,
  deckViewer,
  deckOwner,
  deckSettings,
  deckSettingsAdmin,
  deckSettingsView,
} from './deck'
export {
  projectEditor,
  projectViewer,
  projectMember,
  projectOwner,
  projectSettings,
  projectSettingsView,
} from './project'
export { slideEditor, refineJobEditor } from './slide'
export { seedAssetEditor, seedAssetLevel } from './seed-asset'
export {
  templateReadable,
  templateReadableBySlug,
  templateAuthor,
} from './template'
export { self, signedIn, open, custom } from './self'
export {
  isConnected,
  type GoogleSurface,
  withGoogleAccount,
  requiresGoogleDrive,
  alsoRequires,
  verifiedEmailWhenPublic,
} from './capabilities'
