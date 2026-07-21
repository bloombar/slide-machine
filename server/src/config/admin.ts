/**
 * Admin allowlist. Admin status is granted by the ADMIN_EMAILS environment
 * variable — a comma-separated list of account emails — rather than a role
 * field on the User model, so no user-facing schema or DTO changes.
 * ADMIN_EMAILS is read on every check (not captured at import) so the
 * allowlist needs no zod plumbing and tests can set it per run.
 */

/** Normalizes a comma-separated email list into a lowercase set. */
export const parseAdminEmails = (raw: string | undefined): Set<string> =>
  new Set(
    (raw ?? '')
      .split(',')
      .map(email => email.trim().toLowerCase())
      .filter(email => email.length > 0),
  )

/** Whether the given account email is on the admin allowlist. */
export const isAdminEmail = (email: string): boolean =>
  parseAdminEmails(process.env.ADMIN_EMAILS).has(email.trim().toLowerCase())
