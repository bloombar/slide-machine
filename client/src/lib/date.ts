/**
 * Timestamp formatting shared by the admin console tables.
 *
 * The admin console is deliberately English-only (docs/I18N.md), so this
 * is pinned to en-US rather than following the interface locale. That
 * also makes the admin tests' "locale-independent" assumption true by
 * construction instead of by luck of the runner's system locale.
 * User-facing screens format through i18n/format.ts instead.
 */
const ADMIN_LOCALE = 'en-US'

/** A directory timestamp, e.g. "Jul 23, 2026, 04:15 PM". */
export const formatAdminDate = (iso: string): string =>
  new Date(iso).toLocaleString(ADMIN_LOCALE, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
