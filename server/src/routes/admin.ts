/**
 * Admin API: the user directory (each user's projects and lectures),
 * the admin action audit log with its CSV export, and the moderation
 * endpoints (delete user/project/lecture, ban an email, reset a
 * password) — every mutation records itself in the audit log. Every
 * route is guarded inside the router by requireAuth + requireAdmin
 * (ADMIN_EMAILS allowlist), so mounting it is safe on its own. Intended
 * mount point: /api/admin — see docs/ADMINISTRATION.md.
 *
 * Admin reads deliberately bypass lib/access.ts ACLs: the allowlist gate
 * is the authorization. The wire types below are the contract mirrored
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
  AdminLogsResponse,
  Project,
  SafeUser,
  SeedAsset,
  Visibility,
} from '@slide-machine/shared'
import { UserModel, toUserDto, type UserDb } from '../models/user'
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
import {
  deleteDeckCascade,
  deleteProjectCascade,
  deleteUserCascade,
} from '../lib/cascade'
import { revokeAllSessions } from '../auth/refresh-store'
import { hashPassword } from '../auth/password'
import { isAdminEmail } from '../config/admin'
import type { ResolvedAcl } from '../lib/access'
import { requireAuth } from '../middleware/auth'
import { requireAdmin } from '../middleware/admin'
import { HttpError } from '../middleware/error'

/** One row of the admin user directory. */
export interface AdminUserSummary {
  id: string
  email: string
  displayName: string
  emailVerified: boolean
  planTier: string
  createdAt: string
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
}

export interface AdminUserProjectsResponse {
  projects: Project[]
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
}

export interface AdminUserDecksResponse {
  decks: AdminDeckSummary[]
}

/** One project opened in the admin console, with its lectures. */
export interface AdminProjectDetailResponse {
  project: Project
  /** The project's owner, for the back link and the page header. */
  owner: { id: string; email: string; displayName: string }
  decks: AdminDeckSummary[]
}

/** Seed material at one level — the lecture's own, or its project's:
 * the free-text seed notes plus the uploaded files/images. */
export interface AdminSeedLevel {
  /** Trimmed seed notes (seedContext); absent when empty. */
  notes?: string
  /** Uploaded seed assets at this level, newest first. */
  assets: SeedAsset[]
}

/** One lecture opened in the admin console; every lecture, private or
 * not, is always listed and readable — the allowlist gate is the
 * authorization, mirroring the always-on admin viewer bypass. */
export interface AdminDeckDetailResponse {
  deck: AdminDeckSummary
  /** The project the lecture lives in, for the back link. */
  project: { id: string; title: string }
  /** The lecture's owner — not necessarily the project's owner. */
  owner: { id: string; email: string; displayName: string }
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
  /** Number of lectures in the project. */
  deckCount: number
  createdAt: string
  updatedAt: string
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
  planTier: doc.planTier,
  createdAt: doc.createdAt.toISOString(),
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
    assets: assets.map(toSeedAssetDto),
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
const SORTS = {
  'email:asc': { email: 1 },
  'email:desc': { email: -1 },
  'handle:asc': { displayName: 1 },
  'handle:desc': { displayName: -1 },
  'joined:asc': { createdAt: 1 },
  'joined:desc': { createdAt: -1 },
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
 * the join keeps whole lecture documents out of the pipeline. */
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

/** Resolves a :id route param to an existing user or 404s. */
const loadUser = async (id: string): Promise<HydratedDocument<UserDb>> => {
  const notFound = new HttpError(404, 'not_found', 'User not found')
  if (!isValidObjectId(id)) throw notFound
  const user = await UserModel.findById(id)
  if (!user) throw notFound
  return user
}

export const adminRouter = Router()
adminRouter.use(requireAuth, requireAdmin)

/** Reachable only through the guards above, so 200 means "is an admin";
 * the client uses it to decide whether to show admin navigation. */
adminRouter.get('/status', (_req, res) => {
  res.json({ isAdmin: true })
})

adminRouter.get('/users', async (req, res) => {
  const { page, limit, sort } = parseListQuery(listQuerySchema, req.query)

  const [users, total] = await Promise.all([
    UserModel.find()
      .sort(SORTS[sort])
      .skip((page - 1) * limit)
      .limit(limit),
    UserModel.countDocuments(),
  ])

  const body: AdminUsersResponse = {
    users: users.map(toAdminUserSummary),
    total,
    page,
    limit,
  }
  res.json(body)
})

// Audit-log listing query. Extension point for future filters
// (action, actorId, date range): add optional fields here and fold
// them into the Mongo filter below.
const logsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(250).default(25),
  sort: z.enum(['newest', 'oldest']).default('newest'),
})

const LOG_SORTS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
} as const

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
  const cursor = AdminActionLogModel.find().sort({ createdAt: -1 }).cursor()
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
  const user = await loadUser(String(req.params.id))
  const [projectCount, deckCount, banned] = await Promise.all([
    ProjectModel.countDocuments({ ownerId: user._id }),
    DeckModel.countDocuments({ ownerId: user._id }),
    isEmailBanned(user.email),
  ])

  const body: AdminUserDetailResponse = {
    user: toUserDto(user),
    projectCount,
    deckCount,
    banned,
  }
  res.json(body)
})

adminRouter.get('/users/:id/projects', async (req, res) => {
  const user = await loadUser(String(req.params.id))
  const projects = await ProjectModel.find({ ownerId: user._id }).sort({
    updatedAt: -1,
  })

  const body: AdminUserProjectsResponse = {
    projects: projects.map(toProjectDto),
  }
  res.json(body)
})

adminRouter.get('/users/:id/decks', async (req, res) => {
  const user = await loadUser(String(req.params.id))
  const projectId = req.query.projectId
  const filter: Record<string, unknown> = { ownerId: user._id }
  if (projectId !== undefined) {
    if (typeof projectId !== 'string' || !isValidObjectId(projectId)) {
      throw new HttpError(400, 'invalid_input', 'Invalid projectId filter')
    }
    filter.projectId = projectId
  }
  const decks = await DeckModel.find(filter).sort({ updatedAt: -1 })
  // One batched project query resolves the effective visibility of every
  // inheriting lecture; the rest read their own override.
  const acls = await loadDeckAcls(decks)

  // Every lecture is listed, private or not — the allowlist gate is the
  // authorization, mirroring the always-on admin viewer bypass.
  const body: AdminUserDecksResponse = {
    decks: decks.map(deck =>
      toAdminDeckSummary(deck, acls.get(deck._id.toString())!),
    ),
  }
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
    ProjectModel.find({ _id: { $in: pageIds } }),
    ProjectModel.countDocuments(),
  ])
  const projects = inIdOrder(pageIds, found)

  const ownerIds = [...new Set(projects.map(p => p.ownerId.toString()))]
  const projectIds = projects.map(p => p._id)
  const [owners, deckCounts] = await Promise.all([
    ownerIds.length ? UserModel.find({ _id: { $in: ownerIds } }) : [],
    projectIds.length
      ? DeckModel.aggregate<{ _id: Types.ObjectId; count: number }>([
          { $match: { projectId: { $in: projectIds } } },
          { $group: { _id: '$projectId', count: { $sum: 1 } } },
        ])
      : [],
  ])
  const emailById = new Map(owners.map(u => [u._id.toString(), u.email]))
  const countById = new Map(deckCounts.map(c => [c._id.toString(), c.count]))

  const body: AdminProjectsResponse = {
    // A row with a missing owner (mid-cascade-deletion) is still listed,
    // with a blank email — a directory never drops rows.
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
  const notFound = new HttpError(404, 'not_found', 'Project not found')
  const id = String(req.params.id)
  if (!isValidObjectId(id)) throw notFound
  const project = await ProjectModel.findById(id)
  if (!project) throw notFound
  // Cascades keep projects ownerless-free, so a missing owner means the
  // project is mid-deletion; treat it as gone.
  const owner = await UserModel.findById(project.ownerId)
  if (!owner) throw notFound

  const decks = await DeckModel.find({ projectId: project._id }).sort({
    updatedAt: -1,
  })
  const acls = await loadDeckAcls(decks)

  const body: AdminProjectDetailResponse = {
    project: toProjectDto(project),
    owner: {
      id: owner._id.toString(),
      email: owner.email,
      displayName: owner.displayName,
    },
    // Every lecture is listed, private or not (same always-on rule as
    // /users/:id/decks).
    decks: decks.map(deck =>
      toAdminDeckSummary(deck, acls.get(deck._id.toString())!),
    ),
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
  const notFound = new HttpError(404, 'not_found', 'Project not found')
  const id = String(req.params.id)
  if (!isValidObjectId(id)) throw notFound
  const project = await ProjectModel.findById(id)
  if (!project) throw notFound
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
    DeckModel.find({ _id: { $in: pageIds } }),
    DeckModel.countDocuments(),
  ])
  const decks = inIdOrder(pageIds, found)

  const ownerIds = [...new Set(decks.map(d => d.ownerId.toString()))]
  const projectIds = [...new Set(decks.map(d => d.projectId.toString()))]
  // loadDeckAcls fetches projects internally but only for inheriting
  // lectures, so project titles need their own batched lookup.
  const [acls, owners, projects] = await Promise.all([
    loadDeckAcls(decks),
    ownerIds.length ? UserModel.find({ _id: { $in: ownerIds } }) : [],
    projectIds.length ? ProjectModel.find({ _id: { $in: projectIds } }) : [],
  ])
  const emailById = new Map(owners.map(u => [u._id.toString(), u.email]))
  const titleById = new Map(projects.map(p => [p._id.toString(), p.title]))

  // Every lecture is listed, private or not — the allowlist gate is the
  // authorization. Rows with a missing owner or project (mid-cascade-
  // deletion) stay listed with blank fields.
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
  const notFound = new HttpError(404, 'not_found', 'Lecture not found')
  const id = String(req.params.id)
  if (!isValidObjectId(id)) throw notFound
  const deck = await DeckModel.findById(id)
  if (!deck) throw notFound
  // Cascades remove decks with their project and owner, so a missing
  // parent means the lecture is mid-deletion; treat it as gone.
  const [project, owner] = await Promise.all([
    ProjectModel.findById(deck.projectId),
    UserModel.findById(deck.ownerId),
  ])
  if (!project || !owner) throw notFound
  // Effective seed material: the lecture's own (deckId set) plus the
  // project's (deckId absent), which stacks underneath it at generation.
  const [acls, lectureAssets, projectAssets] = await Promise.all([
    loadDeckAcls([deck]),
    SeedAssetModel.find({ deckId: deck._id }).sort({ createdAt: -1 }),
    SeedAssetModel.find({
      projectId: project._id,
      deckId: { $exists: false },
    }).sort({ createdAt: -1 }),
  ])

  const body: AdminDeckDetailResponse = {
    deck: toAdminDeckSummary(deck, acls.get(deck._id.toString())!),
    project: { id: project._id.toString(), title: project.title },
    owner: {
      id: owner._id.toString(),
      email: owner.email,
      displayName: owner.displayName,
    },
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
  const notFound = new HttpError(404, 'not_found', 'Lecture not found')
  const id = String(req.params.id)
  if (!isValidObjectId(id)) throw notFound
  const deck = await DeckModel.findById(id)
  if (!deck) throw notFound
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
// router is the authorization. All respond 204 on success.

/** The acting admin, guaranteed by requireAdmin on this router. */
const actor = (req: { adminUser?: { id: string; email: string } }) => {
  const admin = req.adminUser
  if (!admin) throw new HttpError(403, 'forbidden', 'Admin access required')
  return admin
}

/** Admin accounts moderate; they are not moderated. Deleting, banning,
 * or resetting an allowlisted account (including yourself) is refused —
 * it would be a lockout, not moderation. */
const rejectAdminTarget = (email: string) => {
  if (isAdminEmail(email)) {
    throw new HttpError(
      400,
      'target_is_admin',
      'Admin accounts cannot be moderated; remove the email from ADMIN_EMAILS first',
    )
  }
}

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
  const notFound = new HttpError(404, 'not_found', 'Project not found')
  const id = String(req.params.id)
  if (!isValidObjectId(id)) throw notFound
  const project = await ProjectModel.findById(id)
  if (!project) throw notFound
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
  const notFound = new HttpError(404, 'not_found', 'Lecture not found')
  const id = String(req.params.id)
  if (!isValidObjectId(id)) throw notFound
  const deck = await DeckModel.findById(id)
  if (!deck) throw notFound
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
