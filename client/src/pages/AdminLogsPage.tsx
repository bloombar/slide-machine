/**
 * Admin audit log: every recorded admin action in a newest-first table
 * (time, acting admin, action, target, details), paginated, with a
 * Download CSV button that exports the whole log. Entries appear as
 * admin mutation features call logAdminAction on the server.
 *
 * The acting admin and the target (user, project, or lecture) both link
 * to their admin detail pages, so any entry is one click from the record
 * it describes.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { AdminLogEntry, AdminLogsResponse } from '@slide-machine/shared'
import {
  listAdminLogs,
  downloadAdminLogsCsv,
  ADMIN_LOGS_PAGE_SIZE,
  ADMIN_LOGS_PAGE_SIZES,
} from '../api/admin'
import { config } from '../config'

const loggedAt = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

/** Admin detail route for each kind of target an action can name. Kinds
 * missing from this map (future action families) render unlinked. */
const TARGET_ROUTES: Record<string, string> = {
  user: 'users',
  project: 'projects',
  deck: 'decks',
}

/** Placeholder for a titleless project. A deployment that sets
 * VITE_DEFAULT_PROJECT_TITLE names its default project itself and that
 * name wins; otherwise the console shows this. Hardcoded English rather
 * than the bundle's `project.untitled`: the admin console is English-only
 * (docs/I18N.md). */
const UNTITLED = 'Default project'

/** Reads a string field out of an entry's details, ignoring blanks. */
const detail = (entry: AdminLogEntry, key: string): string | undefined => {
  const value = entry.details?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** Display name for a target, taken from the details snapshotted when the
 * action happened: an email for users, a title for projects and lectures.
 * Untitled records fall back to the same placeholders their own admin
 * pages use. Returns undefined when nothing was recorded. */
const targetName = (entry: AdminLogEntry): string | undefined => {
  switch (entry.targetType) {
    case 'user':
      return detail(entry, 'email')
    case 'project':
      return detail(entry, 'title') ?? config.defaultProjectTitle ?? UNTITLED
    case 'deck':
      return detail(entry, 'title') ?? 'Untitled lecture'
    default:
      return detail(entry, 'title') ?? detail(entry, 'email')
  }
}

/**
 * The Target column: the kind of record acted on plus its name, linked to
 * that record's admin page. Deletions stay unlinked — the record is gone,
 * so its page would only 404. Ids stay out of the table; the linked page
 * shows them.
 */
function TargetCell({ entry }: { entry: AdminLogEntry }) {
  const { targetType, targetId } = entry
  if (!targetType) return <>—</>

  const route = TARGET_ROUTES[targetType]
  const name = targetName(entry)
  const deleted = entry.action.endsWith('.delete')
  const label = name ?? targetType

  return (
    <span className="inline-flex items-baseline gap-1.5">
      {/* Only worth a kind prefix when the name itself is shown */}
      {name && (
        <span className="text-xs text-slate-400 uppercase">{targetType}</span>
      )}
      {route && targetId && !deleted ? (
        <Link
          to={`/app/admin/${route}/${targetId}`}
          className="font-medium text-slate-900 hover:underline"
        >
          {label}
        </Link>
      ) : (
        <span className={deleted ? 'text-slate-400 line-through' : undefined}>
          {label}
        </span>
      )}
    </span>
  )
}

/** Fetches the CSV export and hands it to the browser as a download.
 * A plain <a href> can't send the Bearer token, so the bytes arrive as
 * a blob and leave through a temporary object-URL anchor. */
const saveCsv = async (): Promise<void> => {
  const blob = await downloadAdminLogsCsv()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'admin-audit-log.csv'
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function AdminLogsPage() {
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(ADMIN_LOGS_PAGE_SIZE)
  const [data, setData] = useState<AdminLogsResponse | null>(null)
  const [error, setError] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState(false)

  // No reset on refetch: the error view unmounts every control that could
  // trigger one, so a stale error can never linger past a new response
  useEffect(() => {
    let cancelled = false
    listAdminLogs(page, limit)
      .then(res => {
        if (!cancelled) setData(res)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [page, limit])

  const onDownload = async () => {
    setDownloading(true)
    setDownloadError(false)
    try {
      await saveCsv()
    } catch {
      setDownloadError(true)
    } finally {
      setDownloading(false)
    }
  }

  if (error) {
    return <p className="text-red-600">Could not load the audit log.</p>
  }
  if (!data) {
    return <p className="text-slate-500">Loading…</p>
  }

  const pageCount = Math.max(1, Math.ceil(data.total / data.limit))

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">
          Audit log{' '}
          <span className="text-base font-normal text-slate-500">
            ({data.total})
          </span>
        </h1>
        <div className="flex items-center gap-4">
          {downloadError && (
            <span className="text-sm text-red-600">Download failed.</span>
          )}
          <button
            onClick={() => void onDownload()}
            disabled={downloading}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            {downloading ? 'Preparing…' : 'Download CSV'}
          </button>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Per page
            <select
              aria-label="Log entries per page"
              value={limit}
              onChange={e => {
                setLimit(Number(e.target.value))
                setPage(1)
              }}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            >
              {ADMIN_LOGS_PAGE_SIZES.map(size => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 uppercase">
            <tr>
              <th scope="col" className="px-4 py-3">
                Time
              </th>
              <th scope="col" className="px-4 py-3">
                Admin
              </th>
              <th scope="col" className="px-4 py-3">
                Action
              </th>
              <th scope="col" className="px-4 py-3">
                Target
              </th>
              <th scope="col" className="px-4 py-3">
                Details
              </th>
            </tr>
          </thead>
          <tbody>
            {data.logs.map(entry => {
              const details =
                entry.details === undefined ? '' : JSON.stringify(entry.details)
              return (
                <tr
                  key={entry.id}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
                >
                  <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">
                    {loggedAt(entry.createdAt)}
                  </td>
                  <td className="px-4 py-2.5">
                    <Link
                      to={`/app/admin/users/${entry.actorId}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {entry.actorEmail}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                      {entry.action}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">
                    <TargetCell entry={entry} />
                  </td>
                  <td
                    title={details}
                    className="max-w-xs truncate px-4 py-2.5 text-slate-500"
                  >
                    {details || '—'}
                  </td>
                </tr>
              )
            })}
            {data.logs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-slate-500">
                  No log entries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
        <button
          onClick={() => setPage(p => p - 1)}
          disabled={page <= 1}
          className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40"
        >
          Previous
        </button>
        <span>
          Page {data.page} of {pageCount}
        </span>
        <button
          onClick={() => setPage(p => p + 1)}
          disabled={page >= pageCount}
          className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  )
}
