/**
 * Admin API client. The wire types mirror the ones exported by
 * server/src/routes/admin.ts (the server is the source of truth); move
 * both into the shared workspace once the admin surface is wired in.
 */
import type {
  AdminLogsResponse,
  AdminPlanGrant,
  AdminPlanGrantInput,
  AdminUserSettingsPatch,
  PlanTier,
  Project,
  SafeUser,
  SeedAsset,
  SettingsLogsResponse,
  Visibility,
} from '@slide-machine/shared'
import { apiFetch, apiFetchBlob } from './http'

/**
 * Every admin read surface carries the tombstone (ADMIN-6): soft-deleted
 * records are listed alongside live ones so the console can badge them
 * with <DeletedBadge>, rather than being hidden as they are from every
 * product read (P-10). Absent = live, an ISO timestamp = soft-deleted.
 */
type Tombstone = string | undefined

/** One row of the admin user directory. */
export interface AdminUserSummary {
  id: string
  email: string
  displayName: string
  emailVerified: boolean
  planTier: string
  createdAt: string
  /** Soft-delete timestamp; absent while the account is live (ADMIN-6). */
  deletedAt?: Tombstone
}

/** A column the user directory can be ordered by. */
export type AdminUsersSortField = 'email' | 'handle' | 'joined'
export type AdminUsersSortDir = 'asc' | 'desc'
/** Wire value for the `sort` query param: `${field}:${dir}`. */
export type AdminUsersSort = `${AdminUsersSortField}:${AdminUsersSortDir}`

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
  /** What the account's own billing entitles it to — `user.planTier` is the
   * effective tier, which a complimentary grant can raise (ADMIN-9). This is
   * where it lands when the grant ends. */
  billingTier: PlanTier
  /** The standing complimentary grant, lapsed ones included; `inEffect` says
   * whether it is deciding anything right now. */
  planGrant?: AdminPlanGrant
  /** Soft-delete timestamp; absent while the account is live (ADMIN-6).
   * It sits on the envelope rather than inside `user` so the tombstone
   * never leaks into the shared User type the product reads. */
  deletedAt?: Tombstone
}

/** A project as listed under its owner's admin page: the product shape
 * plus its tombstone, so a deleted project stays listed and badged. */
export interface AdminUserProject extends Project {
  deletedAt?: Tombstone
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
  /** Soft-delete timestamp; absent while the lecture is live (ADMIN-6). */
  deletedAt?: Tombstone
}

/** A person referenced from an admin page (a row's owner, a lecture's
 * owner): enough to link and label, plus their tombstone. */
export interface AdminOwnerRef {
  id: string
  email: string
  displayName: string
  deletedAt?: Tombstone
}

/** One project opened in the admin console, with its lectures. */
export interface AdminProjectDetailResponse {
  project: Project
  /** The project's owner, for the back link and the page header. */
  owner: AdminOwnerRef
  decks: AdminDeckSummary[]
  /** Soft-delete timestamp; absent while the project is live (ADMIN-6).
   * On the envelope, not inside `project`, so the tombstone stays out of
   * the shared Project type. */
  deletedAt?: Tombstone
}

/** An uploaded seed asset as the admin console sees it: the product shape
 * plus its tombstone, so material the owner removed is still listed. */
export interface AdminSeedAsset extends SeedAsset {
  deletedAt?: Tombstone
}

/** Seed material at one level — the lecture's own, or its project's:
 * the free-text seed notes plus the uploaded files/images. */
export interface AdminSeedLevel {
  /** Trimmed seed notes (seedContext); absent when empty. */
  notes?: string
  /** Uploaded seed assets at this level, newest first. */
  assets: AdminSeedAsset[]
}

/** One lecture opened in the admin console; every lecture, private or
 * not, is always listed and readable for an admin. */
export interface AdminDeckDetailResponse {
  deck: AdminDeckSummary
  /** The project the lecture lives in, for the back link; its tombstone
   * tells the page whether the parent went away too. */
  project: { id: string; title: string; deletedAt?: Tombstone }
  /** The lecture's owner — not necessarily the project's owner. */
  owner: AdminOwnerRef
  /** The seed material that fed this lecture's generation. The lecture's
   * own material stacks on top of the project's, so both are surfaced. */
  seed: { lecture: AdminSeedLevel; project: AdminSeedLevel }
}

/** One row of the site-wide admin project directory. */
export interface AdminProjectSummary {
  id: string
  ownerId: string
  /** Empty string while the owner is mid-cascade-deletion. */
  ownerEmail: string
  title: string
  visibility: Visibility
  /** Number of lectures in the project, tombstoned ones included — it
   * matches the row count the project's admin page lists (ADMIN-6). */
  deckCount: number
  createdAt: string
  updatedAt: string
  /** Soft-delete timestamp; absent while the project is live (ADMIN-6). */
  deletedAt?: Tombstone
}

/** A column the project directory can be ordered by — every column the
 * table shows. Ordering happens server-side, over all projects. */
export type AdminProjectsSortField =
  'title' | 'owner' | 'visibility' | 'lectures' | 'created' | 'updated'
/** Wire value for the `sort` query param: `${field}:${dir}`. */
export type AdminProjectsSort = `${AdminProjectsSortField}:${AdminUsersSortDir}`

export interface AdminProjectsResponse {
  projects: AdminProjectSummary[]
  total: number
  page: number
  limit: number
}

/** One row of the site-wide admin lecture directory: the per-user row
 * shape plus the owner and project context a global list needs. */
export interface AdminDeckListItem extends AdminDeckSummary {
  ownerId: string
  /** Empty string while the owner is mid-cascade-deletion. */
  ownerEmail: string
  /** Empty string while the project is mid-cascade-deletion. */
  projectTitle: string
}

/** A column the lecture directory can be ordered by — every column the
 * table shows, including the ones it borrows from the lecture's project
 * and owner. */
export type AdminDecksSortField =
  | 'title'
  | 'project'
  | 'owner'
  | 'visibility'
  | 'slides'
  | 'created'
  | 'updated'
export type AdminDecksSort = `${AdminDecksSortField}:${AdminUsersSortDir}`

export interface AdminDecksResponse {
  decks: AdminDeckListItem[]
  total: number
  page: number
  limit: number
}

/** Selectable directory page sizes; the server caps `limit` at 250. */
export const ADMIN_USERS_PAGE_SIZES = [10, 25, 50, 100, 250] as const
export const ADMIN_USERS_PAGE_SIZE = 100

/** 200 only for admins; non-admins receive a 403 ApiError. */
export const fetchAdminStatus = (): Promise<{ isAdmin: boolean }> =>
  apiFetch<{ isAdmin: boolean }>('/api/admin/status')

export const listAdminUsers = (
  page = 1,
  sort: AdminUsersSort = 'joined:desc',
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
): Promise<{ projects: AdminUserProject[] }> =>
  apiFetch<{ projects: AdminUserProject[] }>(
    `/api/admin/users/${userId}/projects`,
  )

export const fetchAdminUserDecks = (
  userId: string,
): Promise<{ decks: AdminDeckSummary[] }> =>
  apiFetch<{ decks: AdminDeckSummary[] }>(`/api/admin/users/${userId}/decks`)

/** Selectable project-directory page sizes; same cap as users. */
export const ADMIN_PROJECTS_PAGE_SIZES = ADMIN_USERS_PAGE_SIZES
export const ADMIN_PROJECTS_PAGE_SIZE = 100

/** One page of the site-wide project directory. */
export const listAdminProjects = (
  page = 1,
  sort: AdminProjectsSort = 'updated:desc',
  limit: number = ADMIN_PROJECTS_PAGE_SIZE,
): Promise<AdminProjectsResponse> =>
  apiFetch<AdminProjectsResponse>(
    `/api/admin/projects?page=${page}&limit=${limit}&sort=${sort}`,
  )

/** Selectable lecture-directory page sizes; same cap as users. */
export const ADMIN_DECKS_PAGE_SIZES = ADMIN_USERS_PAGE_SIZES
export const ADMIN_DECKS_PAGE_SIZE = 100

/** One page of the site-wide lecture directory. */
export const listAdminDecks = (
  page = 1,
  sort: AdminDecksSort = 'updated:desc',
  limit: number = ADMIN_DECKS_PAGE_SIZE,
): Promise<AdminDecksResponse> =>
  apiFetch<AdminDecksResponse>(
    `/api/admin/decks?page=${page}&limit=${limit}&sort=${sort}`,
  )

export const fetchAdminProject = (
  projectId: string,
): Promise<AdminProjectDetailResponse> =>
  apiFetch<AdminProjectDetailResponse>(`/api/admin/projects/${projectId}`)

export const fetchAdminDeck = (
  deckId: string,
): Promise<AdminDeckDetailResponse> =>
  apiFetch<AdminDeckDetailResponse>(`/api/admin/decks/${deckId}`)

/** Selectable audit-log page sizes; same cap as the user directory. */
export const ADMIN_LOGS_PAGE_SIZES = ADMIN_USERS_PAGE_SIZES
export const ADMIN_LOGS_PAGE_SIZE = 100

/** A column the audit log can be ordered by — every column the table
 * shows but Details, whose action-specific context has no order. Ordering
 * happens server-side, over the whole log rather than the loaded page. */
export type AdminLogsSortField = 'time' | 'admin' | 'action' | 'target'
export type AdminLogsSort = `${AdminLogsSortField}:${AdminUsersSortDir}`

/** One page of the admin action audit log, newest first by default. */
export const listAdminLogs = (
  page = 1,
  limit: number = ADMIN_LOGS_PAGE_SIZE,
  sort: AdminLogsSort = 'time:desc',
): Promise<AdminLogsResponse> =>
  apiFetch<AdminLogsResponse>(
    `/api/admin/logs?page=${page}&limit=${limit}&sort=${sort}`,
  )

/** The full audit log as a CSV blob, for a client-side download. */
export const downloadAdminLogsCsv = (): Promise<Blob> =>
  apiFetchBlob('/api/admin/logs/export')

// Settings change log: every settings edit on the platform, whoever made
// it (a separate log from the admin audit log above, which covers only
// what admins do). Read-only — nothing writes to it from the client.

/** Narrows the settings log to one kind of entity. */
export type SettingsLogEntityFilter = 'user' | 'project' | 'deck'

/** Selectable settings-log page sizes; same cap as the user directory. */
export const SETTINGS_LOGS_PAGE_SIZES = ADMIN_USERS_PAGE_SIZES
export const SETTINGS_LOGS_PAGE_SIZE = 100

/** The `entityType` query param, omitted when nothing is filtered. */
const entityTypeParam = (entityType?: SettingsLogEntityFilter): string =>
  entityType ? `&entityType=${entityType}` : ''

/** A column the settings log can be ordered by — every column the table
 * shows but "What changed", a set of fields with no meaningful order.
 * `actor` is the Changed by column, `entity` the Settings column. */
export type SettingsLogsSortField = 'time' | 'actor' | 'entity'
export type SettingsLogsSort = `${SettingsLogsSortField}:${AdminUsersSortDir}`

/** One page of the settings change log, newest first by default. */
export const listSettingsLogs = (
  page = 1,
  limit: number = SETTINGS_LOGS_PAGE_SIZE,
  entityType?: SettingsLogEntityFilter,
  sort: SettingsLogsSort = 'time:desc',
): Promise<SettingsLogsResponse> =>
  apiFetch<SettingsLogsResponse>(
    `/api/admin/settings-logs?page=${page}&limit=${limit}&sort=${sort}${entityTypeParam(entityType)}`,
  )

/** The settings change log as a CSV blob, honouring the same filter as
 * the listing so an export matches what is on screen. */
export const downloadSettingsLogsCsv = (
  entityType?: SettingsLogEntityFilter,
): Promise<Blob> =>
  apiFetchBlob(
    `/api/admin/settings-logs/export?page=1${entityTypeParam(entityType)}`,
  )

// Moderation endpoints. All resolve on a 204; failures surface as
// ApiError (e.g. 400 target_is_admin when moderating an allowlisted
// account). Each is recorded in the admin audit log server-side.

/** Deletes the account and all of its data. Recoverable until purged. */
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

/** Lifts an email ban so the account can sign in and register again. */
export const unbanAdminUserEmail = (userId: string): Promise<void> =>
  apiFetch<void>(`/api/admin/users/${userId}/ban`, { method: 'DELETE' })

/** Sets a new password (min 8 chars) and ends all their sessions. */
export const resetAdminUserPassword = (
  userId: string,
  password: string,
): Promise<void> =>
  apiFetch<void>(`/api/admin/users/${userId}/password`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  })

/** Records that this admin opened a private project in the product view.
 * Every call writes its own audit entry; the "View project" link invokes
 * it only for private projects (a public one rejects with 400). */
export const logAdminProjectView = (projectId: string): Promise<void> =>
  apiFetch<void>(`/api/admin/projects/${projectId}/private-view`, {
    method: 'POST',
  })

/** Records that this admin opened a private lecture in the live viewer.
 * Every call writes its own audit entry; the "View slideshow" link invokes
 * it only for private lectures (a public one rejects with 400). */
export const logAdminDeckView = (deckId: string): Promise<void> =>
  apiFetch<void>(`/api/admin/decks/${deckId}/private-view`, { method: 'POST' })

/** Deletes a project and everything in it. Recoverable until purged. */
export const deleteAdminProject = (projectId: string): Promise<void> =>
  apiFetch<void>(`/api/admin/projects/${projectId}`, { method: 'DELETE' })

/** Deletes a lecture and everything under it. Recoverable until purged. */
export const deleteAdminDeck = (deckId: string): Promise<void> =>
  apiFetch<void>(`/api/admin/decks/${deckId}`, { method: 'DELETE' })

// Restore (ADMIN-6): lifts the tombstone from a soft-deleted record and
// everything deleted with it, putting it back in front of its owner. Only
// works during the retention window — once the purge sweep has run
// (DELETED_DATA_RETENTION_DAYS) the record is gone and these 404. They
// also 404 on a record that is still live. Audited server-side.

/** Restores a soft-deleted account and all of its content. */
export const restoreAdminUser = (userId: string): Promise<void> =>
  apiFetch<void>(`/api/admin/users/${userId}/restore`, { method: 'POST' })

/** Restores a soft-deleted project and everything deleted with it. */
export const restoreAdminProject = (projectId: string): Promise<void> =>
  apiFetch<void>(`/api/admin/projects/${projectId}/restore`, { method: 'POST' })

/** Restores a soft-deleted lecture and everything deleted with it. */
export const restoreAdminDeck = (deckId: string): Promise<void> =>
  apiFetch<void>(`/api/admin/decks/${deckId}/restore`, { method: 'POST' })

// Account settings editor (ADMIN-5), called by the settings modal on the
// user's profile page. It sends only the fields that changed:
// JSON.stringify drops `undefined`, so an absent field means "unchanged"
// and an explicit `null` means "clear it so it is inherited again".
// Resolves on a 204 and is recorded in the audit log with the exact
// before/after of every field.
//
// Project and lecture settings have no admin endpoint: an admin edits
// them in the owner-facing settings modal, through the same actions the
// owner uses (docs/ADMINISTRATION.md, "Editing settings").

/** Updates a user's profile settings (not the plan tier, email, or
 * password — those are governed elsewhere; the plan is below). */
export const updateAdminUserSettings = (
  userId: string,
  patch: AdminUserSettingsPatch,
): Promise<void> =>
  apiFetch<void>(`/api/admin/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

// Complimentary plan grants (ADMIN-9): put an account on a larger plan for
// a while at no charge. Separate from the settings patch above because a
// plan is billing state, not a profile setting — it is audited as an admin
// action, and never appears in the settings change log.

/**
 * Grants (or replaces) a complimentary plan. `expiresAt` may be a bare
 * `YYYY-MM-DD`, which the server reads as the end of that day, and must be in
 * the future; `tier` must be larger than what the account already pays for,
 * or the call fails 400 `not_an_upgrade`. Nothing is charged, and the
 * account's own subscription is untouched.
 */
export const grantAdminUserPlan = (
  userId: string,
  grant: AdminPlanGrantInput,
): Promise<void> =>
  apiFetch<void>(`/api/admin/users/${userId}/plan-grant`, {
    method: 'PUT',
    body: JSON.stringify(grant),
  })

/** Ends a grant now instead of waiting for it to lapse, dropping the account
 * to whatever its own billing entitles it to. Idempotent. */
export const revokeAdminUserPlan = (userId: string): Promise<void> =>
  apiFetch<void>(`/api/admin/users/${userId}/plan-grant`, { method: 'DELETE' })
