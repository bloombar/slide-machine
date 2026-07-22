/**
 * Admin API client. The wire types mirror the ones exported by
 * server/src/routes/admin.ts (the server is the source of truth); move
 * both into the shared workspace once the admin surface is wired in.
 */
import type { Project, SafeUser, Visibility } from '@slide-machine/shared'
import { apiFetch } from './http'

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
