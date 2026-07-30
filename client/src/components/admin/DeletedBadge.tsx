/**
 * The "Deleted" pill the admin console puts on soft-deleted content
 * (ADMIN-6). Deleted records stay listed everywhere live ones are —
 * directories, detail pages, lecture tables, seed material — so the badge
 * is what tells them apart. It renders nothing for a live record, which
 * keeps call sites to a single unconditional line.
 *
 * Deleted content is recoverable until the retention sweep purges it
 * (P-11), so the pill's tooltip carries the deletion time.
 */
import { formatAdminDate } from '../../lib/date'

/** Muted styling for a row or link whose record is soft-deleted, matching
 * the console's existing "gone" treatment on the audit-log pages. */
export const deletedTextClass = 'text-slate-400'

export default function DeletedBadge({
  deletedAt,
}: {
  /** ISO timestamp of the soft delete; absent while the record is live. */
  deletedAt?: string
}) {
  if (!deletedAt) return null
  return (
    <span
      title={`Deleted ${formatAdminDate(deletedAt)}`}
      className="inline-block rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700"
    >
      Deleted
    </span>
  )
}
