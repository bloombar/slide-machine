/**
 * Admin project directory: every project on the platform in a table
 * (title, owner, visibility, lecture count, timestamps), paginated and
 * sortable by every column. Rows link to the per-project admin view,
 * owners to theirs. Soft-deleted projects are listed too, badged and
 * muted, so they can be inspected or restored (ADMIN-6).
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  listAdminProjects,
  ADMIN_PROJECTS_PAGE_SIZE,
  ADMIN_PROJECTS_PAGE_SIZES,
  type AdminProjectsResponse,
  type AdminProjectsSort,
} from '../api/admin'
import SortHeader from '../components/admin/SortHeader'
import { formatAdminDate } from '../lib/date'
import DeletedBadge, {
  deletedTextClass,
} from '../components/admin/DeletedBadge'
import { VisibilityBadge } from '../components/admin/LectureTable'

export default function AdminProjectsPage() {
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<AdminProjectsSort>('updated:desc')
  const [limit, setLimit] = useState(ADMIN_PROJECTS_PAGE_SIZE)
  const [data, setData] = useState<AdminProjectsResponse | null>(null)
  const [error, setError] = useState(false)

  // No reset on refetch: the error view unmounts every control that could
  // trigger one, so a stale error can never linger past a new response
  useEffect(() => {
    let cancelled = false
    listAdminProjects(page, sort, limit)
      .then(res => {
        if (!cancelled) setData(res)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [page, sort, limit])

  if (error) {
    return <p className="text-red-600">Could not load projects.</p>
  }
  if (!data) {
    return <p className="text-slate-500">Loading…</p>
  }

  const pageCount = Math.max(1, Math.ceil(data.total / data.limit))

  // Any sort change starts the listing over from the first page.
  const changeSort = (next: AdminProjectsSort) => {
    setSort(next)
    setPage(1)
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">
          Projects{' '}
          <span className="text-base font-normal text-slate-500">
            ({data.total})
          </span>
        </h1>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Per page
          <select
            aria-label="Projects per page"
            value={limit}
            onChange={e => {
              setLimit(Number(e.target.value))
              setPage(1)
            }}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            {ADMIN_PROJECTS_PAGE_SIZES.map(size => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 uppercase">
            <tr>
              <SortHeader
                label="Title"
                field="title"
                sort={sort}
                onSort={changeSort}
              />
              <SortHeader
                label="Owner"
                field="owner"
                sort={sort}
                onSort={changeSort}
              />
              <SortHeader
                label="Visibility"
                field="visibility"
                sort={sort}
                onSort={changeSort}
              />
              <SortHeader
                label="Lectures"
                field="lectures"
                sort={sort}
                onSort={changeSort}
                align="right"
              />
              <SortHeader
                label="Created"
                field="created"
                sort={sort}
                onSort={changeSort}
              />
              <SortHeader
                label="Updated"
                field="updated"
                sort={sort}
                onSort={changeSort}
              />
            </tr>
          </thead>
          <tbody>
            {data.projects.map(project => (
              <tr
                key={project.id}
                className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
              >
                <td className="px-4 py-2.5">
                  <Link
                    to={`/app/admin/projects/${project.id}`}
                    className={`font-medium hover:underline ${
                      project.deletedAt ? deletedTextClass : 'text-slate-900'
                    }`}
                  >
                    {project.title.trim() || 'Untitled project'}
                  </Link>{' '}
                  <DeletedBadge deletedAt={project.deletedAt} />
                </td>
                <td className="px-4 py-2.5">
                  {project.ownerEmail ? (
                    <Link
                      to={`/app/admin/users/${project.ownerId}`}
                      className="text-slate-700 hover:underline"
                    >
                      {project.ownerEmail}
                    </Link>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <VisibilityBadge visibility={project.visibility} />
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                  {project.deckCount}
                </td>
                <td className="px-4 py-2.5 text-slate-500">
                  {formatAdminDate(project.createdAt)}
                </td>
                <td className="px-4 py-2.5 text-slate-500">
                  {formatAdminDate(project.updatedAt)}
                </td>
              </tr>
            ))}
            {data.projects.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-slate-500">
                  No projects on this page.
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
