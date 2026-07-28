/**
 * DTOs for the admin settings editors (ADMIN-5): the PATCH bodies for
 * `/api/admin/users/:id`, `/projects/:id`, and `/decks/:id`, plus the
 * lecture settings shape those pages read back.
 *
 * The wire rule every patch below depends on: `JSON.stringify` DROPS
 * `undefined` properties, so an **absent** field means "leave it alone"
 * and an explicit **`null`** means "clear this level so the value is
 * inherited again". The server parses with `z.strictObject`, so any field
 * not listed here is rejected with 400 `invalid_input` rather than being
 * silently ignored. See docs/ADMINISTRATION.md ("Editing settings").
 */
import type { Locale } from '../types/locale'
import type { ProfileVisibility } from '../types/user'
import type { Visibility } from '../types/deck'

/** Admin-editable profile fields of a user account. Billing state (plan
 * tier), the email, and the password have their own paths and are not
 * editable here. */
export interface AdminUserSettingsPatch {
  displayName?: string
  /** Empty string clears the bio. */
  bio?: string
  profileVisibility?: ProfileVisibility
  /** UI locale; always stored (no inherit). */
  locale?: Locale
  /** Lecturing language; null clears it back to the browser default. */
  language?: Locale | null
}

/** Admin-editable settings of a project. Title, seed material, template,
 * ownership, and the sharing lists are not editable here. */
export interface AdminProjectSettingsPatch {
  visibility?: Visibility
  /** null clears back to the server default (GENERATION_FREEDOM). */
  generationFreedom?: number | null
  /** null clears back to the owner's profile language. */
  language?: Locale | null
  /** null clears back to the server default voice. */
  ttsVoice?: string | null
}

/**
 * A lecture's admin-editable settings as they currently resolve — also
 * the vocabulary the audit entry's `changes` speaks. `visibility` is the
 * EFFECTIVE one; `accessInherited` says whether it came from the project,
 * which is what makes "set it to the value it already inherits" a real
 * change (the lecture stops following its project).
 */
export interface AdminDeckSettings {
  visibility: Visibility
  /** True while the lecture still follows its project's access settings. */
  accessInherited: boolean
  generationFreedom?: number
  language?: Locale
  ttsVoice?: string
  refineIdentifySpeakers?: boolean
  refineSlidesEnabled?: boolean
  refineSlidesLevel?: number
  refineTranscriptEnabled?: boolean
  refineTranscriptLevel?: number
}

/** What the admin lecture detail read returns: the settings above plus
 * the project-level AI freedom the lecture inherits while unset, which
 * the freedom slider needs to render its "inherited" position. */
export interface AdminDeckSettingsView extends AdminDeckSettings {
  effectiveGenerationFreedom: number
}

/** Admin-editable settings of a lecture. Title, template, seed material,
 * permalink, ownership, and the sharing lists are not editable here. */
export interface AdminDeckSettingsPatch {
  /** null drops the lecture's own access override so it follows its
   * project again; a value pins the lecture's own visibility. */
  visibility?: Visibility | null
  /** null clears back to the project's AI freedom. */
  generationFreedom?: number | null
  /** null clears back to the project's language. */
  language?: Locale | null
  /** null clears back to the project's narration voice. */
  ttsVoice?: string | null
  /** null clears each refine setting back to its inherited default. */
  refineIdentifySpeakers?: boolean | null
  refineSlidesEnabled?: boolean | null
  refineSlidesLevel?: number | null
  refineTranscriptEnabled?: boolean | null
  refineTranscriptLevel?: number | null
}
