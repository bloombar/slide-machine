/**
 * Admin API: the read-only user directory (each user's projects and
 * lectures) plus the admin action audit log and its CSV export. Every
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
import { isValidObjectId, type HydratedDocument } from 'mongoose'
import { z } from 'zod'
import type {
  AdminLogsResponse,
  Project,
  SafeUser,
  Visibility,
} from '@slide-machine/shared'
import { UserModel, toUserDto, type UserDb } from '../models/user'
import { ProjectModel, toProjectDto } from '../models/project'
import { DeckModel, loadDeckAcls, type DeckDb } from '../models/deck'
import {
  AdminActionLogModel,
  toAdminLogEntryDto,
} from '../models/admin-action-log'
import { csvRow } from '../audit/csv'
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

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(['newest', 'oldest', 'email']).default('newest'),
})

const SORTS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  email: { email: 1 },
} as const

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
  const parsed = listQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    throw new HttpError(
      400,
      'invalid_input',
      'Invalid list query',
      parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
    )
  }
  const { page, limit, sort } = parsed.data

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
  limit: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(['newest', 'oldest']).default('newest'),
})

const LOG_SORTS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
} as const

adminRouter.get('/logs', async (req, res) => {
  const parsed = logsQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    throw new HttpError(
      400,
      'invalid_input',
      'Invalid list query',
      parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
    )
  }
  const { page, limit, sort } = parsed.data

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
  const [projectCount, deckCount] = await Promise.all([
    ProjectModel.countDocuments({ ownerId: user._id }),
    DeckModel.countDocuments({ ownerId: user._id }),
  ])

  const body: AdminUserDetailResponse = {
    user: toUserDto(user),
    projectCount,
    deckCount,
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

  const body: AdminUserDecksResponse = {
    decks: decks.map(deck =>
      toAdminDeckSummary(deck, acls.get(deck._id.toString())!),
    ),
  }
  res.json(body)
})
