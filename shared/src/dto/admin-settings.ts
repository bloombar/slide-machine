/**
 * DTO for the admin account settings editor (ADMIN-5): the PATCH body for
 * `/api/admin/users/:id`.
 *
 * The wire rule the patch depends on: `JSON.stringify` DROPS `undefined`
 * properties, so an **absent** field means "leave it alone" and an
 * explicit **`null`** means "clear it so the value is inherited again".
 * The server parses with `z.strictObject`, so any field not listed here
 * is rejected with 400 `invalid_input` rather than being silently
 * ignored.
 *
 * Projects and lectures have no patch of their own: an admin edits their
 * settings in the owner-facing settings modal, through the same actions
 * the owner uses. See docs/ADMINISTRATION.md ("Editing settings").
 */
import type { Locale } from '../types/locale'
import type { ProfileVisibility } from '../types/user'

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
