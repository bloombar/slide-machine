/**
 * Settings change log read API: the paginated newest-first listing and
 * the CSV export of every settings change on the platform. Mounted inside
 * adminRouter (routes/admin.ts) after requireAuth + requireAdmin, so the
 * allowlist gate covers it — the log spans every account, so only
 * operators may read it.
 *
 * Read-only on purpose: the log is append-only, written solely through
 * audit/settings-log.ts, and no endpoint anywhere edits or deletes an
 * entry. See docs/ADMINISTRATION.md ("Settings change log").
 */
import { Router } from 'express'
import { z } from 'zod'
import {
  SETTINGS_ENTITY_TYPES,
  type SettingsLogsResponse,
} from '@slide-machine/shared'
import {
  SettingsChangeLogModel,
  toSettingsLogEntryDto,
} from '../models/settings-change-log'
import { csvRow } from '../audit/csv'
import { HttpError } from '../middleware/error'

export const adminSettingsLogsRouter = Router()

// Filters are optional and combine: `entityType` narrows to accounts,
// projects, or lectures; `entityId` and `ownerId` follow one record's or
// one account's settings history. Each is indexed on the collection.
const logsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(250).default(25),
  sort: z.enum(['newest', 'oldest']).default('newest'),
  entityType: z.enum(SETTINGS_ENTITY_TYPES).optional(),
  entityId: z.string().min(1).optional(),
  ownerId: z.string().min(1).optional(),
})

const LOG_SORTS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
} as const

/** Parses the listing query or 400s with the offending fields listed. */
const parseQuery = (query: unknown): z.output<typeof logsQuerySchema> => {
  const parsed = logsQuerySchema.safeParse(query)
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

/** The Mongo filter for a parsed query; absent params drop out. */
const filterOf = (
  query: z.output<typeof logsQuerySchema>,
): Record<string, string> => {
  const filter: Record<string, string> = {}
  if (query.entityType) filter.entityType = query.entityType
  if (query.entityId) filter.entityId = query.entityId
  if (query.ownerId) filter.ownerId = query.ownerId
  return filter
}

adminSettingsLogsRouter.get('/settings-logs', async (req, res) => {
  const query = parseQuery(req.query)
  const { page, limit, sort } = query
  const filter = filterOf(query)

  const [logs, total] = await Promise.all([
    SettingsChangeLogModel.find(filter)
      .sort(LOG_SORTS[sort])
      .skip((page - 1) * limit)
      .limit(limit),
    SettingsChangeLogModel.countDocuments(filter),
  ])

  const body: SettingsLogsResponse = {
    logs: logs.map(toSettingsLogEntryDto),
    total,
    page,
    limit,
  }
  res.json(body)
})

/** Streams the log, newest first, as a CSV download. The same filters
 * apply, so an export can be narrowed to one account or record. A
 * Mongoose cursor keeps memory flat however large the log grows. */
adminSettingsLogsRouter.get('/settings-logs/export', async (req, res) => {
  const filter = filterOf(parseQuery(req.query))
  const date = new Date().toISOString().slice(0, 10)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="settings-change-log-${date}.csv"`,
  )
  res.write(
    csvRow([
      'createdAt',
      'actorEmail',
      'actorId',
      'actorRole',
      'entityType',
      'entityId',
      'entityName',
      'ownerId',
      'changes',
    ]),
  )
  const cursor = SettingsChangeLogModel.find(filter)
    .sort({ createdAt: -1 })
    .cursor()
  for await (const doc of cursor) {
    res.write(
      csvRow([
        doc.createdAt.toISOString(),
        doc.actorEmail,
        doc.actorId.toString(),
        doc.actorRole,
        doc.entityType,
        doc.entityId,
        doc.entityName,
        doc.ownerId,
        JSON.stringify(doc.changes),
      ]),
    )
  }
  res.end()
})
