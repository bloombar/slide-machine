/**
 * One displayable message for a failed API call (TECH-12).
 *
 * The server's error messages are authored in English and stay that way
 * (docs/I18N.md), so the client translates rather than rendering
 * `err.message`. Codes alone are not enough — `not_found` is thrown at a
 * dozen sites and would flatten "Lecture not found" and "Profile not
 * found" into one sentence — so the rule is two-tier:
 *
 * 1. A handful of codes mean the same thing wherever they are thrown and
 *    get their own `errors.<code>` message.
 * 2. Everything else falls back to the call site's key, which is the one
 *    that knows what the user was trying to do.
 */
import type { TFunction } from 'i18next'
import { ApiError } from '../api/http'

/** Codes whose meaning does not depend on where they were thrown. */
export const GLOBAL_ERROR_CODES = [
  'invalid_credentials',
  'account_banned',
  'unauthorized',
  'forbidden',
  'internal_error',
  'unknown_error',
] as const

const isGlobalCode = (code: string): boolean =>
  (GLOBAL_ERROR_CODES as readonly string[]).includes(code)

/**
 * @param err       whatever was thrown — anything that is not an ApiError
 *                  with a globally meaningful code uses the fallback
 * @param t         the caller's translate function
 * @param fallbackKey  the call site's own wording, e.g. `deck.errors.load`
 */
export const apiErrorMessage = (
  err: unknown,
  t: TFunction,
  fallbackKey: string,
): string =>
  err instanceof ApiError && isGlobalCode(err.code)
    ? t(`errors.${err.code}`)
    : t(fallbackKey)
