/**
 * One-time backfill: fold a template's retired three-way visibility down to
 * the two-way vocabulary a lecture uses (TMPL-26).
 *
 * A template used to be `private` (nobody else), `unlisted` (anyone with the
 * link) or `public` (listed). The people list this slice adds replaces
 * `unlisted`'s job — sharing is now who is on the list, not a link anyone can
 * hold — so both `private` and `unlisted` collapse to `restricted` and
 * `public` is untouched.
 *
 * Runs at startup rather than as a migration because the project has no
 * migration runner (see `jobs/pin-template-versions.ts`), and the work is
 * bounded by how many templates still hold a retired value, which only ever
 * falls. Idempotent: a second run's query matches nothing NEW — though it is
 * not literally nothing forever. The soft-delete plugin's query middleware
 * excludes tombstoned rows from `updateMany` by default (P-10), so a
 * template deleted before this ran keeps its legacy value until the
 * retention purge removes the row outright; that is fine, because
 * `toTemplateDto`'s `legacyVisibility` maps the same two values on every
 * read, tombstoned or not — a template is never served with a value nothing
 * in the app still returns, whether or not this pass ever reaches its row.
 */
import { TemplateModel } from '../models/template'

/** Updates every template still holding a retired visibility value,
 * returning how many were changed. */
export const backfillTemplateVisibility = async (): Promise<number> => {
  const result = await TemplateModel.updateMany(
    { visibility: { $in: ['private', 'unlisted'] } },
    { $set: { visibility: 'restricted' } },
  )
  return result.modifiedCount
}

/** Fire-and-forget wrapper for startup: a failure here must not stop the
 * server, since `toTemplateDto`'s read-time mapping already covers the
 * documents this pass has not reached yet. */
export const startTemplateVisibilityBackfill = (): void => {
  backfillTemplateVisibility()
    .then(count => {
      if (count)
        console.log(`Migrated ${count} template(s) to restricted/public`)
    })
    .catch(error => {
      console.error('Template visibility backfill failed (continuing):', error)
    })
}
