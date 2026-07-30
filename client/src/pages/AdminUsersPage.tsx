/**
 * Admin user directory: every account in a table (email, handle, time of
 * joining), paginated and sortable. Rows link to the per-user admin view.
 * Soft-deleted accounts are listed too, badged and muted, so they can be
 * inspected or restored (ADMIN-6).
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  listAdminUsers,
  ADMIN_USERS_PAGE_SIZE,
  ADMIN_USERS_PAGE_SIZES,
  type AdminUsersResponse,
  type AdminUsersSort,
} from '../api/admin'
import SortHeader from '../components/admin/SortHeader'
import { formatAdminDate } from '../lib/date'
import DeletedBadge, {
  deletedTextClass,
} from '../components/admin/DeletedBadge'

export default function AdminUsersPage() {
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<AdminUsersSort>('joined:desc')
  const [limit, setLimit] = useState(ADMIN_USERS_PAGE_SIZE)
  const [data, setData] = useState<AdminUsersResponse | null>(null)
  const [error, setError] = useState(false)

  // No reset on refetch: the error view unmounts every control that could
  // trigger one, so a stale error can never linger past a new response
  useEffect(() => {
    let cancelled = false
    listAdminUsers(page, sort, limit)
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
    return <p className="text-red-600">Could not load users.</p>
  }
  if (!data) {
    return <p className="text-slate-500">Loading…</p>
  }

  const pageCount = Math.max(1, Math.ceil(data.total / data.limit))

  // Any sort change starts the listing over from the first page.
  const changeSort = (next: AdminUsersSort) => {
    setSort(next)
    setPage(1)
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">
          Users{' '}
          <span className="text-base font-normal text-slate-500">
            ({data.total})
          </span>
        </h1>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Per page
            <select
              aria-label="Users per page"
              value={limit}
              onChange={e => {
                setLimit(Number(e.target.value))
                setPage(1)
              }}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            >
              {ADMIN_USERS_PAGE_SIZES.map(size => (
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
              <SortHeader
                label="Email"
                field="email"
                sort={sort}
                onSort={changeSort}
              />
              <SortHeader
                label="Handle"
                field="handle"
                sort={sort}
                onSort={changeSort}
              />
              <SortHeader
                label="Joined"
                field="joined"
                sort={sort}
                onSort={changeSort}
              />
            </tr>
          </thead>
          <tbody>
            {data.users.map(user => (
              <tr
                key={user.id}
                className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
              >
                <td className="px-4 py-2.5">
                  <Link
                    to={`/app/admin/users/${user.id}`}
                    className={`font-medium hover:underline ${
                      user.deletedAt ? deletedTextClass : 'text-slate-900'
                    }`}
                  >
                    {user.email}
                  </Link>{' '}
                  <DeletedBadge deletedAt={user.deletedAt} />
                </td>
                <td className="px-4 py-2.5 text-slate-700">
                  {user.displayName}
                </td>
                <td className="px-4 py-2.5 text-slate-500">
                  {formatAdminDate(user.createdAt)}
                </td>
              </tr>
            ))}
            {data.users.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-slate-500">
                  No users on this page.
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
