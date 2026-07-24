/** Timestamp formatting shared by the admin console tables. */

/** A directory timestamp, e.g. "Jul 23, 2026, 04:15 PM". */
export const formatAdminDate = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
