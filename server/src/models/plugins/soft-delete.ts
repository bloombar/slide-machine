/**
 * Soft-delete plugin (SPEC §15 "Soft delete" / P-10). Applied to every deletable
 * entity, it adds a `deletedAt` tombstone and makes deletion recoverable:
 *
 *   - A `deletedAt` field (null = live, a Date = tombstoned).
 *   - Query middleware that transparently excludes tombstoned records from every
 *     read and update it covers — so callers never have to remember to filter.
 *     The escape hatch is `.setOptions({ withDeleted: true })`, used by admin
 *     recovery (ADMIN-6), the restore path, and the retention purge.
 *   - The filter is injected on reads (`find`, `findOne`, `countDocuments`) and
 *     updates (`updateOne`, `updateMany`, `findOneAndUpdate`) — exactly the ops
 *     in `FILTERED_OPS` below, which is the list to read rather than this
 *     sentence. `distinct` and `exists` are NOT among them and do see tombstoned
 *     records; `withDeleted` on such a query is accepted but changes nothing.
 *     It is also deliberately not injected on `deleteOne`/`deleteMany`/
 *     `findOneAndDelete`, so the purge job, test cleanup, and the dev seed
 *     reset still hard-delete everything.
 *
 * To tombstone, set `deletedAt` (on a loaded doc, or via `updateMany` — the
 * injected `deletedAt: null` filter then only tombstones still-live records). To
 * restore, update with `{ withDeleted: true }` so the tombstoned rows are matched.
 */
import type { Schema, Query, MongooseQueryMiddleware } from 'mongoose'

declare module 'mongoose' {
  interface QueryOptions {
    /** Opt a query into seeing tombstoned (soft-deleted) records (P-10). */
    withDeleted?: boolean
  }
}

/** Query ops whose filter should exclude tombstoned records by default. Deletes
 * are intentionally absent — hard-delete must reach tombstoned rows (purge/tests). */
const FILTERED_OPS: readonly MongooseQueryMiddleware[] = [
  'countDocuments',
  'find',
  'findOne',
  'findOneAndUpdate',
  'updateOne',
  'updateMany',
]

/** True when the query opted into seeing tombstoned records. */
const wantsDeleted = (query: Query<unknown, unknown>): boolean =>
  Boolean(query.getOptions().withDeleted)

export function softDeletePlugin(schema: Schema): void {
  schema.add({
    deletedAt: { type: Date, default: null, index: true },
  })

  // Exclude tombstoned records unless the query opted in via `.withDeleted()`.
  // Only add the filter when the query hasn't already constrained `deletedAt`
  // (the purge queries it explicitly, always with withDeleted).
  for (const op of FILTERED_OPS) {
    schema.pre(op, function (this: Query<unknown, unknown>) {
      if (wantsDeleted(this)) return
      if (this.getFilter().deletedAt === undefined) {
        this.where({ deletedAt: null })
      }
    })
  }
}
