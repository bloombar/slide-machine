/**
 * Admin API: the user directory (each user's projects and lectures),
 * the admin action audit log and the settings change log (each with a
 * CSV export), the moderation endpoints (delete user/project/lecture,
 * ban an email, reset a password), and complimentary plan grants
 * (ADMIN-9, ./admin-plan.ts) — every mutation records itself in the
 * admin action log; settings edits also land in the settings log. Every
 * route is guarded inside the router by requireAuth + requireAdmin
 * (ADMIN_EMAILS allowlist), so mounting it is safe on its own. Intended
 * mount point: /api/admin — see docs/ADMINISTRATION.md.
 *
 * Admin reads deliberately bypass lib/access.ts ACLs: the allowlist gate
 * is the authorization. They also see soft-deleted records, which every
 * product read hides (P-10): tombstoned rows stay listed with a
 * `deletedAt` so the console can badge them, opening one is audited, and
 * they can be restored until the retention sweep purges them (ADMIN-6).
 * The wire types below are the contract mirrored
 * by client/src/api/admin.ts; move them into the shared workspace once
 * the admin surface is wired into the apps (the audit-log DTOs already
 * live there).
 */
import { Router } from 'express'
import {
  isValidObjectId,
  Types,
  type HydratedDocument,
  type PipelineStage,
} from 'mongoose'
import { z } from 'zod'
import type {
  AdminAction,
  AdminLogsResponse,
  AdminPlanGrant,
  PlanTier,
  Project,
  SafeUser,
  SeedAsset,
  UsageSummaryResponse,
  Visibility,
} from '@slide-machine/shared'
import { UserModel, toUserDto, type UserDb } from '../models/user'
import { adminPlanGrant, effectivePlanTier } from '../billing/plan-grant'
import { accountUsage } from '../billing/usage-view'
import { ProjectModel, toProjectDto, type ProjectDb } from '../models/project'
import { DeckModel, loadDeckAcls, type DeckDb } from '../models/deck'
import {
  SeedAssetModel,
  toSeedAssetDto,
  type SeedAssetDb,
} from '../models/seed-asset'
import {
  AdminActionLogModel,
  toAdminLogEntryDto,
} from '../models/admin-action-log'
import { BannedEmailModel, isEmailBanned } from '../models/banned-email'
import { csvRow } from '../audit/csv'
import { logAdminAction } from '../audit/log'
import { logDeletedView as logAdminDeletedView } from '../lib/admin-view'
import {
  deleteDeckCascade,
  deleteProjectCascade,
  deleteUserCascade,
  restoreDeckCascade,
  restoreProjectCascade,
  restoreUserCascade,
} from '../lib/cascade'
import { revokeAllSessions } from '../auth/refresh-store'
import { hashPassword } from '../auth/password'
import type { ResolvedAcl } from '../lib/access'
import { requireAuth } from '../middleware/auth'
import { requireAdmin } from '../middleware/admin'
import { HttpError } from '../middleware/error'
import {
  actor,
  loadAnyDeck,
  loadAnyProject,
  loadAnyUser,
  loadDeck,
  loadProject,
  loadUser,
  loadDeletedDeck,
  loadDeletedProject,
  loadDeletedUser,
  rejectAdminTarget,
} from './admin-targets'
import { adminPlanRouter } from './admin-plan'
import { adminCostRouter } from './admin-cost'
import { adminTelemetryRouter } from './admin-telemetry'
import { adminResearchRouter } from './admin-research'
import { adminSettingsRouter } from './admin-settings'
import { adminSettingsLogsRouter } from './admin-settings-logs'

/**
 * Every admin read surface carries the tombstone (ADMIN-6): soft-deleted
 * records are listed alongside live ones so the console can badge them,
 * rather than being hidden as they are from every product read (P-10).
 * Absent = live, an ISO timestamp = soft-deleted at that moment.
 */
type Tombstone = string | undefined

/** The tombstone as it goes on the wire; absent while the record is live. */
const tombstone = (at?: Date | null): Tombstone => at?.toISOString()

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
  /**
   * The tier the account's own billing entitles it to (BILL-2) — what
   * `user.planTier` would be without a complimentary grant, and what it
   * returns to when one ends (ADMIN-9). Equal to `user.planTier` unless a
   * grant is in effect.
   */
  billingTier: PlanTier
  /** The standing complimentary grant, if the account has ever had one —
   * including a lapsed one, which stays on the record as history until it
   * is replaced (ADMIN-9). `inEffect` says whether it is deciding anything. */
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

export interface AdminUserProjectsResponse {
  projects: AdminUserProject[]
}

/** A lecture as listed in the admin view; permalinkSlug links to /d/:slug. */
export interface AdminDeckSummary {
  id: string
  projectId: string
  title: string
  permalinkSlug: string
  // Effective visibility (the lecture's override, else its project's), so
  // the admin table can badge each lecture without resolving ACLs itself.
  visibility: Visibility
  slideCount: number
  createdAt: string
  updatedAt: string
  /** Soft-delete timestamp; absent while the lecture is live (ADMIN-6). */
  deletedAt?: Tombstone
}

/** A person referenced from an admin page (a row's owner, a lecture's
 * owner): enough to link and label, plus their tombstone so the page can
 * badge an owner who was deleted along with their content. */
export interface AdminOwnerRef {
  id: string
  email: string
  displayName: string
  deletedAt?: Tombstone
}

export interface AdminUserDecksResponse {
  decks: AdminDeckSummary[]
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
 * plus its tombstone, so material the owner removed is still listed and
 * badged rather than silently missing (ADMIN-6). */
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
 * not, is always listed and readable — the allowlist gate is the
 * authorization, mirroring the always-on admin viewer bypass. */
export interface AdminDeckDetailResponse {
  deck: AdminDeckSummary
  /** The project the lecture lives in, for the back link; its tombstone
   * tells the page whether the parent went away too. */
  project: { id: string; title: string; deletedAt?: Tombstone }
  /** The lecture's owner — not necessarily the project's owner. */
  owner: AdminOwnerRef
  /** The seed material that fed this lecture's generation. The lecture's
   * own material (deckId set) stacks on top of the project's (deckId
   * absent), so both levels are surfaced. */
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

export interface AdminDecksResponse {
  decks: AdminDeckListItem[]
  total: number
  page: number
  limit: number
}

const toAdminUserSummary = (
  doc: HydratedDocument<UserDb>,
): AdminUserSummary => ({
  id: doc._id.toString(),
  email: doc.email,
  displayName: doc.displayName,
  emailVerified: doc.emailVerified,
  // The effective tier, so the directory lists what each account may
  // actually spend rather than what it happens to be paying for (ADMIN-9).
  planTier: effectivePlanTier(doc),
  createdAt: doc.createdAt.toISOString(),
  deletedAt: tombstone(doc.deletedAt),
})

/** A project row on its owner's admin page: the product DTO plus its
 * tombstone. */
const toAdminUserProject = (
  doc: HydratedDocument<ProjectDb>,
): AdminUserProject => ({
  ...toProjectDto(doc),
  deletedAt: tombstone(doc.deletedAt),
})

/** An owner as referenced from another admin page. */
const toAdminOwnerRef = (doc: HydratedDocument<UserDb>): AdminOwnerRef => ({
  id: doc._id.toString(),
  email: doc.email,
  displayName: doc.displayName,
  deletedAt: tombstone(doc.deletedAt),
})

const toAdminDeckSummary = (
  doc: HydratedDocument<DeckDb>,
  acl: ResolvedAcl,
): AdminDeckSummary => ({
  id: doc._id.toString(),
  projectId: doc.projectId.toString(),
  title: doc.title,
  permalinkSlug: doc.permalinkSlug,
  visibility: acl.visibility,
  slideCount: doc.slideOrder.length,
  createdAt: doc.createdAt.toISOString(),
  // Fall back for documents created before updatedAt was enabled.
  updatedAt: (doc.updatedAt ?? doc.createdAt).toISOString(),
  deletedAt: tombstone(doc.deletedAt),
})

/** Packs one level's seed material (notes + uploaded assets) into its
 * wire shape; blank notes collapse to undefined so the client can test
 * presence with a single check. */
const toAdminSeedLevel = (
  notes: string | undefined,
  assets: Array<HydratedDocument<SeedAssetDb>>,
): AdminSeedLevel => {
  const trimmed = notes?.trim()
  return {
    notes: trimmed ? trimmed : undefined,
    assets: assets.map(asset => ({
      ...toSeedAssetDto(asset),
      deletedAt: tombstone(asset.deletedAt),
    })),
  }
}

const toAdminProjectSummary = (
  doc: HydratedDocument<ProjectDb>,
  ownerEmail: string,
  deckCount: number,
): AdminProjectSummary => ({
  id: doc._id.toString(),
  ownerId: doc.ownerId.toString(),
  ownerEmail,
  title: doc.title,
  // Projects sit at the top of the ACL tree, so their stored visibility
  // is the effective one (no inheritance to resolve).
  visibility: doc.visibility,
  deckCount,
  createdAt: doc.createdAt.toISOString(),
  // Fall back for documents created before updatedAt was enabled.
  updatedAt: (doc.updatedAt ?? doc.createdAt).toISOString(),
  deletedAt: tombstone(doc.deletedAt),
})

/** Builds the page/limit/sort query schema every listing route shares. */
const listQuery = <K extends string>(sortKeys: K[], defaultSort: K) =>
  z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(250).default(25),
    sort: z.enum(sortKeys as [K, ...K[]]).default(defaultSort),
  })

/** Parses a listing query or 400s with the offending fields listed. */
const parseListQuery = <T extends z.ZodTypeAny>(
  schema: T,
  query: unknown,
): z.output<T> => {
  const parsed = schema.safeParse(query)
  if (!parsed.success) {
    throw new HttpError(
      400,
      'invalid_input',
      'Invalid list query',
      parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
    )
  }
  return parsed.data
}

// Sort keys are `${field}:${dir}`: one per column, each direction. The
// default (joined:desc) is newest-first, as the directory has always been.
// Every sort ends in `_id` so equal keys (accounts created in the same
// millisecond, duplicate handles) keep a stable order across page queries.
const SORTS = {
  'email:asc': { email: 1, _id: 1 },
  'email:desc': { email: -1, _id: -1 },
  'handle:asc': { displayName: 1, _id: 1 },
  'handle:desc': { displayName: -1, _id: -1 },
  'joined:asc': { createdAt: 1, _id: 1 },
  'joined:desc': { createdAt: -1, _id: -1 },
} as const

const listQuerySchema = listQuery(
  Object.keys(SORTS) as (keyof typeof SORTS)[],
  'joined:desc',
)

/**
 * How one directory column is ordered: the aggregation expression that
 * produces its value, plus any $lookup stages that expression needs.
 * Every column the client shows is sortable, including ones not stored
 * on the row's own document (owner email, lecture counts, a lecture's
 * inherited visibility) — those join first, so the order covers the
 * whole collection rather than the page that happens to be loaded.
 */
interface SortColumn {
  value: PipelineStage.Project['$project'][string]
  stages?: PipelineStage[]
}

/** Joins each row to its owner as `sortOwner` (Owner columns). */
const ownerLookup: PipelineStage = {
  $lookup: {
    from: UserModel.collection.name,
    localField: 'ownerId',
    foreignField: '_id',
    as: 'sortOwner',
  },
}

/** Joins each lecture to its project as `sortProject` (Project column,
 * and the inherited half of the Visibility column). */
const deckProjectLookup: PipelineStage = {
  $lookup: {
    from: ProjectModel.collection.name,
    localField: 'projectId',
    foreignField: '_id',
    as: 'sortProject',
  },
}

/** Counts each project's lectures as `sortDeckCount`. Counting inside
 * the join keeps whole lecture documents out of the pipeline. Tombstoned
 * lectures are counted: the admin console lists them (ADMIN-6), so the
 * count has to match the rows the project's page shows. */
const deckCountLookup: PipelineStage = {
  $lookup: {
    from: DeckModel.collection.name,
    let: { projectId: '$_id' },
    pipeline: [
      { $match: { $expr: { $eq: ['$projectId', '$$projectId'] } } },
      { $count: 'count' },
    ],
    as: 'sortDeckCount',
  },
}

/** An owner's email, blank while the owner is mid-cascade-deletion —
 * matching the blank the row itself carries. */
const ownerEmailValue = { $ifNull: [{ $first: '$sortOwner.email' }, ''] }

/** Ordering that mirrors the displayed timestamp: rows predating the
 * updatedAt field fall back to createdAt, exactly as the row DTO does. */
const updatedValue = { $ifNull: ['$updatedAt', '$createdAt'] }

// Both directories default to most-recently-edited first.
const PROJECT_COLUMNS: Record<string, SortColumn> = {
  title: { value: '$title' },
  owner: { value: ownerEmailValue, stages: [ownerLookup] },
  visibility: { value: '$visibility' },
  lectures: {
    value: { $ifNull: [{ $first: '$sortDeckCount.count' }, 0] },
    stages: [deckCountLookup],
  },
  created: { value: '$createdAt' },
  updated: { value: updatedValue },
}

const DECK_COLUMNS: Record<string, SortColumn> = {
  title: { value: '$title' },
  project: {
    value: { $ifNull: [{ $first: '$sortProject.title' }, ''] },
    stages: [deckProjectLookup],
  },
  owner: { value: ownerEmailValue, stages: [ownerLookup] },
  // Effective visibility: the lecture's own override, else its project's
  // — and a dangling project reads as restricted, as resolveDeckAcl does.
  visibility: {
    value: {
      $ifNull: [
        '$accessOverride.visibility',
        { $ifNull: [{ $first: '$sortProject.visibility' }, 'restricted'] },
      ],
    },
    stages: [deckProjectLookup],
  },
  slides: { value: { $size: { $ifNull: ['$slideOrder', []] } } },
  created: { value: '$createdAt' },
  updated: { value: updatedValue },
}

/** Every `${column}:${dir}` key a directory accepts, for its query schema. */
const sortKeys = (columns: Record<string, SortColumn>): string[] =>
  Object.keys(columns).flatMap(field => [`${field}:asc`, `${field}:desc`])

const projectsQuerySchema = listQuery(sortKeys(PROJECT_COLUMNS), 'updated:desc')
const decksQuerySchema = listQuery(sortKeys(DECK_COLUMNS), 'updated:desc')

/**
 * The pipeline that orders a whole collection by one column and cuts out
 * a page, returning ids only — the caller hydrates them. Everything is
 * reduced to a single `sortKey` before the sort, so only that key and an
 * id are held in memory. `_id` breaks ties, without which a low-cardinality
 * column (visibility) could repeat or skip rows across pages.
 *
 * Soft-deleted rows are deliberately NOT filtered out: an admin sees
 * tombstoned content alongside live content, badged (ADMIN-6). Aggregation
 * bypasses the exclusion middleware, so that just means adding no
 * `deletedAt` stage — but the `find`/`countDocuments` calls around this
 * pipeline do need `withDeleted`, or the page would come back short.
 */
const pageIdPipeline = (
  columns: Record<string, SortColumn>,
  sort: string,
  page: number,
  limit: number,
): PipelineStage[] => {
  const [field = '', dir] = sort.split(':')
  // The query schema only admits known columns, so this always resolves.
  const column = columns[field]!
  const order = dir === 'asc' ? 1 : -1
  return [
    ...(column.stages ?? []),
    { $project: { sortKey: column.value } },
    { $sort: { sortKey: order, _id: 1 } },
    { $skip: (page - 1) * limit },
    { $limit: limit },
    { $project: { _id: 1 } },
  ]
}

/** Restores the pipeline's order over documents fetched by id, which
 * come back in whatever order the database found them. */
const inIdOrder = <T extends { _id: Types.ObjectId }>(
  ids: Types.ObjectId[],
  docs: T[],
): T[] => {
  const byId = new Map(docs.map(doc => [doc._id.toString(), doc]))
  return ids.flatMap(id => byId.get(id.toString()) ?? [])
}

/**
 * Read options that let an admin query see tombstoned records. Every admin
 * read carries them: the console lists soft-deleted content alongside live
 * content so it can be inspected and restored during the retention window
 * (ADMIN-6), which is the one exception to P-10's blanket exclusion.
 */
const seen = { withDeleted: true } as const

/**
 * Records that an admin opened a soft-deleted record in the console — one
 * entry per opening, on the shared writer the product's own view paths use
 * (lib/admin-view.ts), so a tombstone opened here and one opened in the
 * viewer read the same way in the log. A live record logs nothing, and only
 * the primary detail reads call this: the directories merely badge their
 * rows, and logging every page of them would bury the log.
 */
const logDeletedView = (
  req: { adminUser?: { id: string; email: string } },
  action: AdminAction,
  targetType: string,
  targetId: string,
  details: Record<string, unknown>,
): Promise<void> =>
  logAdminDeletedView(actor(req), action, targetType, targetId, details)

export const adminRouter = Router()
adminRouter.use(requireAuth, requireAdmin)

// The audited settings-editing endpoints (ADMIN-5), the complimentary
// plan-grant endpoints (ADMIN-9), and the settings change log's read
// endpoints mount here, after the guards above, so they are covered by
// exactly the same authorization.
adminRouter.use(adminSettingsRouter)
adminRouter.use(adminPlanRouter)
adminRouter.use(adminSettingsLogsRouter)
// Cost reporting (BILL-7): read-only, behind the same allowlist gate.
adminRouter.use(adminCostRouter)
// Session telemetry (EVAL-1): read-only, behind the same allowlist gate.
adminRouter.use(adminTelemetryRouter)
// De-identified research export (EVAL-2), behind the same allowlist gate.
adminRouter.use(adminResearchRouter)

/** Reachable only through the guards above, so 200 means "is an admin";
 * the client uses it to decide whether to show admin navigation. */
adminRouter.get('/status', (_req, res) => {
  res.json({ isAdmin: true })
})

adminRouter.get('/users', async (req, res) => {
  const { page, limit, sort } = parseListQuery(listQuerySchema, req.query)

  // Tombstoned accounts stay listed, badged by the console (ADMIN-6), so
  // both the page and the total have to see them.
  const [users, total] = await Promise.all([
    UserModel.find()
      .sort(SORTS[sort])
      .skip((page - 1) * limit)
      .limit(limit)
      .setOptions(seen),
    UserModel.countDocuments().setOptions(seen),
  ])

  const body: AdminUsersResponse = {
    users: users.map(toAdminUserSummary),
    total,
    page,
    limit,
  }
  res.json(body)
})

// One sort key per sortable column of the Logs page, in the directories'
// `${column}:${dir}` form. Details is the exception: it holds whatever
// context an action recorded, which has no meaningful order.
//
// Every key ends in `createdAt`/`_id`, and the timestamp sort ends in
// `_id` alone. Entries written in the same millisecond — routine, since
// one admin action can log several — otherwise come back in an arbitrary
// order, which both scrambles the order on screen and lets a row repeat
// on one page and vanish from the next. ObjectIds carry a monotonic
// counter, so they order same-millisecond writes by when they happened.
//
// Target sorts by kind first and then by the name the column displays,
// which the entry snapshotted into its details: an email for users, a
// title for projects and lectures. Kind leads, so the two never
// interleave and each group reads alphabetically, exactly as the cell
// renders it.
const LOG_SORTS = {
  'time:desc': { createdAt: -1, _id: -1 },
  'time:asc': { createdAt: 1, _id: 1 },
  'admin:asc': { actorEmail: 1, createdAt: -1, _id: -1 },
  'admin:desc': { actorEmail: -1, createdAt: -1, _id: -1 },
  'action:asc': { action: 1, createdAt: -1, _id: -1 },
  'action:desc': { action: -1, createdAt: -1, _id: -1 },
  'target:asc': {
    targetType: 1,
    'details.email': 1,
    'details.title': 1,
    createdAt: -1,
    _id: -1,
  },
  'target:desc': {
    targetType: -1,
    'details.email': -1,
    'details.title': -1,
    createdAt: -1,
    _id: -1,
  },
} as const

// Audit-log listing query. Extension point for future filters
// (action, actorId, date range): add optional fields here and fold
// them into the Mongo filter below.
const logsQuerySchema = listQuery(
  Object.keys(LOG_SORTS) as (keyof typeof LOG_SORTS)[],
  'time:desc',
)

adminRouter.get('/logs', async (req, res) => {
  const { page, limit, sort } = parseListQuery(logsQuerySchema, req.query)

  const [logs, total] = await Promise.all([
    AdminActionLogModel.find()
      .sort(LOG_SORTS[sort])
      .skip((page - 1) * limit)
      .limit(limit),
    AdminActionLogModel.countDocuments(),
  ])

  const body: AdminLogsResponse = {
    logs: logs.map(toAdminLogEntryDto),
    total,
    page,
    limit,
  }
  res.json(body)
})

/** Streams the whole audit log, newest first, as a CSV download. A
 * Mongoose cursor keeps memory flat however large the log grows. */
adminRouter.get('/logs/export', async (_req, res) => {
  const date = new Date().toISOString().slice(0, 10)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="admin-audit-log-${date}.csv"`,
  )
  res.write(
    csvRow([
      'createdAt',
      'actorEmail',
      'actorId',
      'action',
      'targetType',
      'targetId',
      'details',
    ]),
  )
  // Same tiebreaker as LOG_SORTS, so the export's "newest first" matches the
  // order the Logs page shows rather than drifting for same-millisecond rows.
  const cursor = AdminActionLogModel.find()
    .sort(LOG_SORTS['time:desc'])
    .cursor()
  for await (const doc of cursor) {
    res.write(
      csvRow([
        doc.createdAt.toISOString(),
        doc.actorEmail,
        doc.actorId.toString(),
        doc.action,
        doc.targetType,
        doc.targetId,
        doc.details === undefined ? undefined : JSON.stringify(doc.details),
      ]),
    )
  }
  res.end()
})

adminRouter.get('/users/:id', async (req, res) => {
  const user = await loadAnyUser(String(req.params.id))
  // Counts include tombstoned rows, matching the lists below them.
  const [projectCount, deckCount, banned] = await Promise.all([
    ProjectModel.countDocuments({ ownerId: user._id }).setOptions(seen),
    DeckModel.countDocuments({ ownerId: user._id }).setOptions(seen),
    isEmailBanned(user.email),
  ])
  if (user.deletedAt) {
    await logDeletedView(
      req,
      'user.deleted_view',
      'user',
      user._id.toString(),
      {
        email: user.email,
        deletedAt: user.deletedAt.toISOString(),
      },
    )
  }

  const body: AdminUserDetailResponse = {
    user: toUserDto(user),
    projectCount,
    deckCount,
    banned,
    // `user.planTier` is the effective tier; these two are how the console
    // explains it — what the account itself pays for, and the grant sitting
    // on top of it (ADMIN-9).
    billingTier: user.planTier,
    planGrant: adminPlanGrant(user),
    deletedAt: tombstone(user.deletedAt),
  }
  res.json(body)
})

adminRouter.get('/users/:id/projects', async (req, res) => {
  const user = await loadAnyUser(String(req.params.id))
  const projects = await ProjectModel.find({ ownerId: user._id })
    .sort({ updatedAt: -1 })
    .setOptions(seen)

  const body: AdminUserProjectsResponse = {
    projects: projects.map(toAdminUserProject),
  }
  res.json(body)
})

adminRouter.get('/users/:id/decks', async (req, res) => {
  const user = await loadAnyUser(String(req.params.id))
  const projectId = req.query.projectId
  const filter: Record<string, unknown> = { ownerId: user._id }
  if (projectId !== undefined) {
    if (typeof projectId !== 'string' || !isValidObjectId(projectId)) {
      throw new HttpError(400, 'invalid_input', 'Invalid projectId filter')
    }
    filter.projectId = projectId
  }
  const decks = await DeckModel.find(filter)
    .sort({ updatedAt: -1 })
    .setOptions(seen)
  // One batched project query resolves the effective visibility of every
  // inheriting lecture; the rest read their own override.
  const acls = await loadDeckAcls(decks, seen)

  // Every lecture is listed, private or not, deleted or not — the
  // allowlist gate is the authorization, mirroring the always-on admin
  // viewer bypass.
  const body: AdminUserDecksResponse = {
    decks: decks.map(deck =>
      toAdminDeckSummary(deck, acls.get(deck._id.toString())!),
    ),
  }
  res.json(body)
})

/**
 * One account's metered usage against its caps — the same summary the
 * account's own footer badge reads (BILL-4), through the allowlist gate
 * instead of the self-only `user.usage` action, which deliberately takes no
 * target. `?window=all` totals every period instead of the current one.
 */
adminRouter.get('/users/:id/usage', async (req, res) => {
  const window = req.query.window ?? 'period'
  if (window !== 'period' && window !== 'all') {
    throw new HttpError(400, 'invalid_input', 'Invalid usage window')
  }
  const user = await loadAnyUser(String(req.params.id))
  const body: UsageSummaryResponse = await accountUsage(
    user._id.toString(),
    effectivePlanTier(user),
    window,
  )
  res.json(body)
})

/** The site-wide project directory: every project on the platform,
 * paginated and sortable by any column, each row carrying its owner's
 * email and its lecture count. Owner emails and lecture counts come from
 * one batched query each — never one per row. */
adminRouter.get('/projects', async (req, res) => {
  const { page, limit, sort } = parseListQuery(projectsQuerySchema, req.query)

  const pageIds = await ProjectModel.aggregate<{ _id: Types.ObjectId }>(
    pageIdPipeline(PROJECT_COLUMNS, sort, page, limit),
  ).then(rows => rows.map(row => row._id))
  const [found, total] = await Promise.all([
    ProjectModel.find({ _id: { $in: pageIds } }).setOptions(seen),
    ProjectModel.countDocuments().setOptions(seen),
  ])
  const projects = inIdOrder(pageIds, found)

  const ownerIds = [...new Set(projects.map(p => p.ownerId.toString()))]
  const projectIds = projects.map(p => p._id)
  const [owners, deckCounts] = await Promise.all([
    ownerIds.length
      ? UserModel.find({ _id: { $in: ownerIds } }).setOptions(seen)
      : [],
    projectIds.length
      ? DeckModel.aggregate<{ _id: Types.ObjectId; count: number }>([
          // Tombstoned lectures are counted, as deckCountLookup does: the
          // console lists them, so the count matches the rows shown.
          { $match: { projectId: { $in: projectIds } } },
          { $group: { _id: '$projectId', count: { $sum: 1 } } },
        ])
      : [],
  ])
  const emailById = new Map(owners.map(u => [u._id.toString(), u.email]))
  const countById = new Map(deckCounts.map(c => [c._id.toString(), c.count]))

  const body: AdminProjectsResponse = {
    // A row whose owner cannot be resolved even with tombstones visible
    // (mid-purge) is still listed, with a blank email — a directory never
    // drops rows.
    projects: projects.map(project =>
      toAdminProjectSummary(
        project,
        emailById.get(project.ownerId.toString()) ?? '',
        countById.get(project._id.toString()) ?? 0,
      ),
    ),
    total,
    page,
    limit,
  }
  res.json(body)
})

adminRouter.get('/projects/:id', async (req, res) => {
  const project = await loadAnyProject(String(req.params.id))
  // Cascades keep projects ownerless-free, and a soft-deleted owner still
  // resolves here, so a missing owner means the account has been purged;
  // treat the project as gone with it.
  const owner = await UserModel.findById(project.ownerId).setOptions(seen)
  if (!owner) throw new HttpError(404, 'not_found', 'Project not found')

  const decks = await DeckModel.find({ projectId: project._id })
    .sort({ updatedAt: -1 })
    .setOptions(seen)
  const acls = await loadDeckAcls(decks, seen)
  if (project.deletedAt) {
    await logDeletedView(
      req,
      'project.deleted_view',
      'project',
      project._id.toString(),
      {
        title: project.title,
        ownerId: project.ownerId.toString(),
        deletedAt: project.deletedAt.toISOString(),
      },
    )
  }

  const body: AdminProjectDetailResponse = {
    project: toProjectDto(project),
    owner: toAdminOwnerRef(owner),
    // Every lecture is listed, private or not, deleted or not (same
    // always-on rule as /users/:id/decks).
    decks: decks.map(deck =>
      toAdminDeckSummary(deck, acls.get(deck._id.toString())!),
    ),
    deletedAt: tombstone(project.deletedAt),
  }
  res.json(body)
})

/**
 * Records that an admin opened a PRIVATE project in the product view.
 * The "View project" link on the project admin page calls this before
 * navigating; public projects skip it (nothing to expose). Every private
 * view is its own audit entry — an access record, one per opening. A
 * public project reaching here is a client bug, not an exposure, so it
 * 400s rather than logging.
 */
adminRouter.post('/projects/:id/private-view', async (req, res) => {
  const project = await loadProject(String(req.params.id))
  const admin = actor(req)
  // Projects sit at the top of the ACL tree, so their stored visibility
  // is the effective one (no inheritance to resolve).
  if (project.visibility === 'public') {
    throw new HttpError(400, 'not_private', 'Project is not private')
  }

  await logAdminAction({
    actorId: admin.id,
    actorEmail: admin.email,
    action: 'project.private_view',
    targetType: 'project',
    targetId: project._id.toString(),
    details: {
      title: project.title,
      ownerId: project.ownerId.toString(),
      visibility: project.visibility,
    },
  })
  res.status(204).end()
})

/** The site-wide lecture directory: every lecture on the platform,
 * paginated and sortable by any column, each row carrying its effective
 * visibility, its owner's email, and its project's title. Three batched
 * queries (ACLs, owners, projects) cover the whole page — never one per
 * row. */
adminRouter.get('/decks', async (req, res) => {
  const { page, limit, sort } = parseListQuery(decksQuerySchema, req.query)

  const pageIds = await DeckModel.aggregate<{ _id: Types.ObjectId }>(
    pageIdPipeline(DECK_COLUMNS, sort, page, limit),
  ).then(rows => rows.map(row => row._id))
  const [found, total] = await Promise.all([
    DeckModel.find({ _id: { $in: pageIds } }).setOptions(seen),
    DeckModel.countDocuments().setOptions(seen),
  ])
  const decks = inIdOrder(pageIds, found)

  const ownerIds = [...new Set(decks.map(d => d.ownerId.toString()))]
  const projectIds = [...new Set(decks.map(d => d.projectId.toString()))]
  // loadDeckAcls fetches projects internally but only for inheriting
  // lectures, so project titles need their own batched lookup.
  const [acls, owners, projects] = await Promise.all([
    loadDeckAcls(decks, seen),
    ownerIds.length
      ? UserModel.find({ _id: { $in: ownerIds } }).setOptions(seen)
      : [],
    projectIds.length
      ? ProjectModel.find({ _id: { $in: projectIds } }).setOptions(seen)
      : [],
  ])
  const emailById = new Map(owners.map(u => [u._id.toString(), u.email]))
  const titleById = new Map(projects.map(p => [p._id.toString(), p.title]))

  // Every lecture is listed, private or not, deleted or not — the
  // allowlist gate is the authorization. Rows whose owner or project
  // cannot be resolved even with tombstones visible (mid-purge) stay
  // listed with blank fields.
  const body: AdminDecksResponse = {
    decks: decks.map(deck => ({
      ...toAdminDeckSummary(deck, acls.get(deck._id.toString())!),
      ownerId: deck.ownerId.toString(),
      ownerEmail: emailById.get(deck.ownerId.toString()) ?? '',
      projectTitle: titleById.get(deck.projectId.toString()) ?? '',
    })),
    total,
    page,
    limit,
  }
  res.json(body)
})

adminRouter.get('/decks/:id', async (req, res) => {
  const deck = await loadAnyDeck(String(req.params.id))
  // A tombstoned project or owner still resolves here, so a missing parent
  // means it has been purged; treat the lecture as gone with it.
  const [project, owner] = await Promise.all([
    ProjectModel.findById(deck.projectId).setOptions(seen),
    UserModel.findById(deck.ownerId).setOptions(seen),
  ])
  if (!project || !owner)
    throw new HttpError(404, 'not_found', 'Lecture not found')
  // Effective seed material: the lecture's own (deckId set) plus the
  // project's (deckId absent), which stacks underneath it at generation.
  // Material the owner removed is listed too, badged as deleted (ADMIN-6).
  const [acls, lectureAssets, projectAssets] = await Promise.all([
    loadDeckAcls([deck], seen),
    SeedAssetModel.find({ deckId: deck._id })
      .sort({ createdAt: -1 })
      .setOptions(seen),
    SeedAssetModel.find({
      projectId: project._id,
      deckId: { $exists: false },
    })
      .sort({ createdAt: -1 })
      .setOptions(seen),
  ])
  if (deck.deletedAt) {
    await logDeletedView(
      req,
      'deck.deleted_view',
      'deck',
      deck._id.toString(),
      {
        title: deck.title,
        ownerId: deck.ownerId.toString(),
        deletedAt: deck.deletedAt.toISOString(),
      },
    )
  }

  const acl = acls.get(deck._id.toString())!
  const body: AdminDeckDetailResponse = {
    deck: toAdminDeckSummary(deck, acl),
    project: {
      id: project._id.toString(),
      title: project.title,
      deletedAt: tombstone(project.deletedAt),
    },
    owner: toAdminOwnerRef(owner),
    seed: {
      lecture: toAdminSeedLevel(deck.seedContext, lectureAssets),
      project: toAdminSeedLevel(project.seedContext, projectAssets),
    },
  }
  res.json(body)
})

/**
 * Records that an admin opened a PRIVATE lecture in the live viewer. The
 * "View slideshow" link on the lecture admin page calls this before
 * navigating; public lectures skip it (nothing to expose). Like the
 * project view log, every private view is its own audit entry — an access
 * record, one per opening. Effective visibility is resolved through the
 * ACL (the lecture's own override, else its project's), so a lecture that
 * is only private by inheritance is logged too; a public one 400s.
 */
adminRouter.post('/decks/:id/private-view', async (req, res) => {
  const deck = await loadDeck(String(req.params.id))
  const admin = actor(req)
  const acls = await loadDeckAcls([deck])
  const visibility = acls.get(deck._id.toString())!.visibility
  if (visibility === 'public') {
    throw new HttpError(400, 'not_private', 'Lecture is not private')
  }

  await logAdminAction({
    actorId: admin.id,
    actorEmail: admin.email,
    action: 'deck.private_view',
    targetType: 'deck',
    targetId: deck._id.toString(),
    details: {
      title: deck.title,
      ownerId: deck.ownerId.toString(),
      visibility,
    },
  })
  res.status(204).end()
})

// ---------------------------------------------------------------------------
// Moderation endpoints. Every mutation below records itself in the admin
// action log (audit/log.ts) before responding; the allowlist gate on the
// router is the authorization. All respond 204 on success. `actor` and
// `rejectAdminTarget` live in ./admin-targets, shared with the settings
// endpoints.

adminRouter.delete('/users/:id', async (req, res) => {
  const user = await loadUser(String(req.params.id))
  const admin = actor(req)
  rejectAdminTarget(user.email)

  await deleteUserCascade(user._id.toString())
  await logAdminAction({
    actorId: admin.id,
    actorEmail: admin.email,
    action: 'user.delete',
    targetType: 'user',
    targetId: user._id.toString(),
    details: { email: user.email },
  })
  res.status(204).end()
})

const banBodySchema = z.object({
  reason: z.string().trim().max(500).optional(),
})

adminRouter.post('/users/:id/ban', async (req, res) => {
  const user = await loadUser(String(req.params.id))
  const admin = actor(req)
  rejectAdminTarget(user.email)
  const parsed = banBodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new HttpError(400, 'invalid_input', 'Invalid ban request')
  }

  // Upsert keeps the endpoint idempotent; the first ban's reason wins
  await BannedEmailModel.updateOne(
    { email: user.email },
    {
      $setOnInsert: {
        email: user.email,
        bannedBy: admin.id,
        reason: parsed.data.reason,
      },
    },
    { upsert: true },
  )
  await revokeAllSessions(user._id.toString())
  await logAdminAction({
    actorId: admin.id,
    actorEmail: admin.email,
    action: 'user.ban_email',
    targetType: 'user',
    targetId: user._id.toString(),
    details: { email: user.email, reason: parsed.data.reason },
  })
  res.status(204).end()
})

/** Lifts an email ban so the account can register and sign in again.
 * Idempotent; only an actual removal is worth an audit entry. */
adminRouter.delete('/users/:id/ban', async (req, res) => {
  const user = await loadUser(String(req.params.id))
  const admin = actor(req)

  const removed = await BannedEmailModel.deleteOne({ email: user.email })
  if (removed.deletedCount > 0) {
    await logAdminAction({
      actorId: admin.id,
      actorEmail: admin.email,
      action: 'user.unban_email',
      targetType: 'user',
      targetId: user._id.toString(),
      details: { email: user.email },
    })
  }
  res.status(204).end()
})

const passwordBodySchema = z.object({
  // Same floor as registration (routes/auth.ts registerSchema)
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

adminRouter.post('/users/:id/password', async (req, res) => {
  const user = await loadUser(String(req.params.id))
  const admin = actor(req)
  rejectAdminTarget(user.email)
  const parsed = passwordBodySchema.safeParse(req.body)
  if (!parsed.success) {
    throw new HttpError(
      400,
      'invalid_input',
      'Invalid password',
      parsed.error.issues.map(i => i.message),
    )
  }

  user.passwordHash = await hashPassword(parsed.data.password)
  await user.save()
  // Old sessions die with the old password
  await revokeAllSessions(user._id.toString())
  await logAdminAction({
    actorId: admin.id,
    actorEmail: admin.email,
    action: 'user.password_reset',
    targetType: 'user',
    targetId: user._id.toString(),
    details: { email: user.email },
  })
  res.status(204).end()
})

adminRouter.delete('/projects/:id', async (req, res) => {
  const project = await loadProject(String(req.params.id))
  const admin = actor(req)

  await deleteProjectCascade(project._id)
  await logAdminAction({
    actorId: admin.id,
    actorEmail: admin.email,
    action: 'project.delete',
    targetType: 'project',
    targetId: project._id.toString(),
    details: { title: project.title, ownerId: project.ownerId.toString() },
  })
  res.status(204).end()
})

adminRouter.delete('/decks/:id', async (req, res) => {
  const deck = await loadDeck(String(req.params.id))
  const admin = actor(req)

  await deleteDeckCascade(deck)
  await logAdminAction({
    actorId: admin.id,
    actorEmail: admin.email,
    action: 'deck.delete',
    targetType: 'deck',
    targetId: deck._id.toString(),
    details: { title: deck.title, ownerId: deck.ownerId.toString() },
  })
  res.status(204).end()
})

// Restore soft-deleted content during the retention window (P-10 / ADMIN-6).
adminRouter.post('/users/:id/restore', async (req, res) => {
  const user = await loadDeletedUser(String(req.params.id))
  const admin = actor(req)

  await restoreUserCascade(user._id.toString())
  await logAdminAction({
    actorId: admin.id,
    actorEmail: admin.email,
    action: 'user.restore',
    targetType: 'user',
    targetId: user._id.toString(),
    details: { email: user.email },
  })
  res.status(204).end()
})

adminRouter.post('/projects/:id/restore', async (req, res) => {
  const project = await loadDeletedProject(String(req.params.id))
  const admin = actor(req)

  await restoreProjectCascade(project._id)
  await logAdminAction({
    actorId: admin.id,
    actorEmail: admin.email,
    action: 'project.restore',
    targetType: 'project',
    targetId: project._id.toString(),
    details: { title: project.title, ownerId: project.ownerId.toString() },
  })
  res.status(204).end()
})

adminRouter.post('/decks/:id/restore', async (req, res) => {
  const deck = await loadDeletedDeck(String(req.params.id))
  const admin = actor(req)

  await restoreDeckCascade(deck._id)
  await logAdminAction({
    actorId: admin.id,
    actorEmail: admin.email,
    action: 'deck.restore',
    targetType: 'deck',
    targetId: deck._id.toString(),
    details: { title: deck.title, ownerId: deck.ownerId.toString() },
  })
  res.status(204).end()
})
