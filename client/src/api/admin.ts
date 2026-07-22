/**
 * Admin API client. The wire types mirror the ones exported by
 * server/src/routes/admin.ts (the server is the source of truth); move
 * both into the shared workspace once the admin surface is wired in.
 */
import type {
  AdminLogsResponse,
  Project,
  SafeUser,
  Visibility,
} from '@slide-machine/shared'
import { apiFetch, apiFetchBlob } from './http'

/** One row of the admin user directory. */
export interface AdminUserSummary {
  id: string
  email: string
  displayName: string
  emailVerified: boolean
  planTier: string
  createdAt: string
}

export type AdminUsersSort = 'newest' | 'oldest' | 'email'

export interface AdminUsersResponse {
  users: AdminUserSummary[]
  total: number
  page: number
  limit: number
}

export interface AdminUserDetailResponse {
  user: SafeUser
  projectCount: number
  deckCount: number
  /** Whether the account's email is on the banned list. */
  banned: boolean
  /** Whether the requesting admin has enabled viewing this user's
   * private lectures (the audited private-view grant). */
  privateAccess: boolean
}

/** A lecture as listed in the admin view; permalinkSlug links to /d/:slug. */
export interface AdminDeckSummary {
  id: string
  projectId: string
  title: string
  permalinkSlug: string
  // Effective visibility (override, else inherited from the project).
  visibility: Visibility
  slideCount: number
  createdAt: string
  updatedAt: string
}

/** Selectable directory page sizes; the server caps `limit` at 100. */
export const ADMIN_USERS_PAGE_SIZES = [10, 25, 50, 100] as const
export const ADMIN_USERS_PAGE_SIZE = 25

/** 200 only for admins; non-admins receive a 403 ApiError. */
export const fetchAdminStatus = (): Promise<{ isAdmin: boolean }> =>
  apiFetch<{ isAdmin: boolean }>('/api/admin/status')

export const listAdminUsers = (
  page = 1,
  sort: AdminUsersSort = 'newest',
  limit: number = ADMIN_USERS_PAGE_SIZE,
): Promise<AdminUsersResponse> =>
  apiFetch<AdminUsersResponse>(
    `/api/admin/users?page=${page}&limit=${limit}&sort=${sort}`,
  )

export const fetchAdminUser = (
  userId: string,
): Promise<AdminUserDetailResponse> =>
  apiFetch<AdminUserDetailResponse>(`/api/admin/users/${userId}`)

export const fetchAdminUserProjects = (
  userId: string,
): Promise<{ projects: Project[] }> =>
  apiFetch<{ projects: Project[] }>(`/api/admin/users/${userId}/projects`)

export const fetchAdminUserDecks = (
  userId: string,
): Promise<{ decks: AdminDeckSummary[] }> =>
  apiFetch<{ decks: AdminDeckSummary[] }>(`/api/admin/users/${userId}/decks`)

/** Selectable audit-log page sizes; same cap as the user directory. */
export const ADMIN_LOGS_PAGE_SIZES = ADMIN_USERS_PAGE_SIZES
export const ADMIN_LOGS_PAGE_SIZE = 25

/** Newest-first page of the admin action audit log. */
export const listAdminLogs = (
  page = 1,
  limit: number = ADMIN_LOGS_PAGE_SIZE,
): Promise<AdminLogsResponse> =>
  apiFetch<AdminLogsResponse>(`/api/admin/logs?page=${page}&limit=${limit}`)

/** The full audit log as a CSV blob, for a client-side download. */
export const downloadAdminLogsCsv = (): Promise<Blob> =>
  apiFetchBlob('/api/admin/logs/export')

// Moderation endpoints. All resolve on a 204; failures surface as
// ApiError (e.g. 400 target_is_admin when moderating an allowlisted
// account). Each is recorded in the admin audit log server-side.

/** Deletes the account and all of its data. Irreversible. */
export const deleteAdminUser = (userId: string): Promise<void> =>
  apiFetch<void>(`/api/admin/users/${userId}`, { method: 'DELETE' })

/** Bans the account's email from registering or signing in. */
export const banAdminUserEmail = (
  userId: string,
  reason?: string,
): Promise<void> =>
  apiFetch<void>(`/api/admin/users/${userId}/ban`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })

/** Sets a new password (min 8 chars) and ends all their sessions. */
export const resetAdminUserPassword = (
  userId: string,
  password: string,
): Promise<void> =>
  apiFetch<void>(`/api/admin/users/${userId}/password`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  })

/** Turns the audited private-lecture viewing grant on or off for the
 * requesting admin. Enabling (and disabling) is recorded in the audit
 * log, as is every private lecture actually viewed under the grant. */
export const setAdminPrivateAccess = (
  userId: string,
  enabled: boolean,
): Promise<void> =>
  apiFetch<void>(`/api/admin/users/${userId}/private-access`, {
    method: enabled ? 'POST' : 'DELETE',
  })

/** Deletes a project and everything in it. Irreversible. */
export const deleteAdminProject = (projectId: string): Promise<void> =>
  apiFetch<void>(`/api/admin/projects/${projectId}`, { method: 'DELETE' })

/** Deletes a lecture and everything under it. Irreversible. */
export const deleteAdminDeck = (deckId: string): Promise<void> =>
  apiFetch<void>(`/api/admin/decks/${deckId}`, { method: 'DELETE' })
