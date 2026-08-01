/**
 * Settings change log: every settings change on the platform in a
 * newest-first table (time, who changed it and in what role, whose
 * settings changed, and the field-by-field before/after), paginated and
 * filterable by entity kind, with a Download CSV button that exports the
 * current filter.
 *
 * This is the companion to the Logs page, not a copy of it: that one
 * answers "what have admins done", this one "how did these settings get
 * this way" — owner edits, collaborator edits, and admin edits alike.
 * Entries appear as settings actions call recordSettingsChange server-side.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type {
  SettingsFieldChange,
  SettingsLogEntry,
  SettingsLogsResponse,
} from '@slide-machine/shared'
import {
  listSettingsLogs,
  downloadSettingsLogsCsv,
  SETTINGS_LOGS_PAGE_SIZE,
  SETTINGS_LOGS_PAGE_SIZES,
  type SettingsLogEntityFilter,
} from '../api/admin'
import { config } from '../config'

const changedAt = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

/** The entity kinds the log can be narrowed to, in filter order. */
const ENTITY_FILTERS: Array<{ value: SettingsLogEntityFilter; label: string }> =
  [
    { value: 'user', label: 'Accounts' },
    { value: 'project', label: 'Projects' },
    { value: 'deck', label: 'Lectures' },
  ]

/** What each entity kind is called in the table, and where its admin
 * detail page lives. Kinds missing here render unlinked. */
const ENTITY_KINDS: Record<string, { label: string; route: string }> = {
  user: { label: 'account', route: 'users' },
  project: { label: 'project', route: 'projects' },
  deck: { label: 'lecture', route: 'decks' },
}

/** How the actor was entitled to make the change. Only an admin's role is
 * worth calling out; owners and editors are the ordinary case. */
const ROLE_STYLES: Record<string, string> = {
  admin: 'bg-amber-100 text-amber-800',
}

/**
 * One recorded value as a short, readable string. Cleared settings are
 * stored as null (the diff normalizes undefined away), and reading "not
 * set" beats reading "null" in a table.
 */
const value = (raw: unknown): string => {
  if (raw === null || raw === undefined || raw === '') return 'not set'
  if (typeof raw === 'string') return raw
  return JSON.stringify(raw)
}

/** The Changes column: one line per changed field, old value struck
 * through and new value beside it. Every entry has at least one — a
 * change set is never recorded empty. */
function ChangesCell({ changes }: { changes: SettingsLogEntry['changes'] }) {
  const entries = Object.entries(changes) as Array<
    [string, SettingsFieldChange]
  >
  return (
    <ul className="flex flex-col gap-0.5">
      {entries.map(([field, change]) => (
        <li key={field} className="flex flex-wrap items-baseline gap-1.5">
          <span className="font-medium text-slate-700">{field}</span>
          <span className="text-slate-400 line-through">
            {value(change.from)}
          </span>
          <span aria-hidden className="text-slate-400">
            →
          </span>
          <span className="text-slate-700">{value(change.to)}</span>
        </li>
      ))}
    </ul>
  )
}

/** Placeholder for a titleless project. A deployment that sets
 * VITE_DEFAULT_PROJECT_TITLE names its default project itself and that
 * name wins; otherwise the console shows this. Hardcoded English rather
 * than the bundle's `project.untitled`: the admin console is English-only
 * (docs/I18N.md). */
const UNTITLED_PROJECT = 'Default project'

/** The Settings column: which record changed, linked to its admin page.
 * Untitled projects and lectures fall back to the same placeholders their
 * own admin pages use. */
function EntityCell({ entry }: { entry: SettingsLogEntry }) {
  const kind = ENTITY_KINDS[entry.entityType]
  const fallback =
    entry.entityType === 'project'
      ? (config.defaultProjectTitle ?? UNTITLED_PROJECT)
      : undefined
  const name = entry.entityName?.trim() || fallback || 'Untitled'

  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-xs text-slate-400 uppercase">
        {kind?.label ?? entry.entityType}
      </span>
      {kind ? (
        <Link
          to={`/app/admin/${kind.route}/${entry.entityId}`}
          className="font-medium text-slate-900 hover:underline"
        >
          {name}
        </Link>
      ) : (
        <span>{name}</span>
      )}
    </span>
  )
}

/** Fetches the CSV export and hands it to the browser as a download.
 * A plain <a href> can't send the Bearer token, so the bytes arrive as
 * a blob and leave through a temporary object-URL anchor. */
const saveCsv = async (
  entityType: SettingsLogEntityFilter | undefined,
): Promise<void> => {
  const blob = await downloadSettingsLogsCsv(entityType)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'settings-change-log.csv'
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function AdminSettingsLogsPage() {
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(SETTINGS_LOGS_PAGE_SIZE)
  const [entityType, setEntityType] = useState<
    SettingsLogEntityFilter | undefined
  >(undefined)
  const [data, setData] = useState<SettingsLogsResponse | null>(null)
  const [error, setError] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState(false)

  // No reset on refetch: the error view unmounts every control that could
  // trigger one, so a stale error can never linger past a new response
  useEffect(() => {
    let cancelled = false
    listSettingsLogs(page, limit, entityType)
      .then(res => {
        if (!cancelled) setData(res)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [page, limit, entityType])

  const onDownload = async () => {
    setDownloading(true)
    setDownloadError(false)
    try {
      await saveCsv(entityType)
    } catch {
      setDownloadError(true)
    } finally {
      setDownloading(false)
    }
  }

  if (error) {
    return <p className="text-red-600">Could not load the settings log.</p>
  }
  if (!data) {
    return <p className="text-slate-500">Loading…</p>
  }

  const pageCount = Math.max(1, Math.ceil(data.total / data.limit))

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">
          Settings changes{' '}
          <span className="text-base font-normal text-slate-500">
            ({data.total})
          </span>
        </h1>
        <div className="flex flex-wrap items-center gap-4">
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
            Show
            <select
              aria-label="Settings kind"
              value={entityType ?? 'all'}
              onChange={e => {
                const next = e.target.value
                setEntityType(
                  next === 'all'
                    ? undefined
                    : (next as SettingsLogEntityFilter),
                )
                setPage(1)
              }}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="all">Everything</option>
              {ENTITY_FILTERS.map(filter => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </label>
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
              {SETTINGS_LOGS_PAGE_SIZES.map(size => (
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
                Changed by
              </th>
              <th scope="col" className="px-4 py-3">
                Settings
              </th>
              <th scope="col" className="px-4 py-3">
                What changed
              </th>
            </tr>
          </thead>
          <tbody>
            {data.logs.map(entry => (
              <tr
                key={entry.id}
                className="border-b border-slate-100 last:border-0 align-top hover:bg-slate-50"
              >
                <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">
                  {changedAt(entry.createdAt)}
                </td>
                <td className="px-4 py-2.5">
                  <span className="inline-flex flex-wrap items-baseline gap-1.5">
                    <Link
                      to={`/app/admin/users/${entry.actorId}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {entry.actorEmail || entry.actorId}
                    </Link>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        ROLE_STYLES[entry.actorRole] ??
                        'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {entry.actorRole}
                    </span>
                  </span>
                </td>
                <td className="px-4 py-2.5 text-slate-700">
                  <EntityCell entry={entry} />
                </td>
                <td className="px-4 py-2.5 text-slate-500">
                  <ChangesCell changes={entry.changes} />
                </td>
              </tr>
            ))}
            {data.logs.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-slate-500">
                  No settings changes yet.
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
