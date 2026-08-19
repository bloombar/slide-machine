/**
 * The reporting window shared by the admin report and export routes
 * (cost, telemetry, research): an optional `?from=`/`?to=` pair of ISO
 * dates. Extracted here so every report answers "over what period" the
 * same way instead of each router keeping its own copy.
 */
import { HttpError } from '../middleware/error'

/** A reporting window; both ends optional and open-ended, because
 * "everything so far" is the question an operator asks first. */
export interface ReportWindow {
  from?: Date
  to?: Date
}

/**
 * The window a report covers, from `?from=`/`?to=` query values. An
 * unparseable date is refused rather than ignored — silently reporting
 * the wrong period is worse than an error.
 */
export const windowFrom = (query: Record<string, unknown>): ReportWindow => {
  const parse = (value: unknown, name: string): Date | undefined => {
    if (value === undefined || value === '') return undefined
    const date = new Date(String(value))
    if (Number.isNaN(date.getTime())) {
      throw new HttpError(400, 'invalid_input', `Invalid ${name} date`)
    }
    return date
  }
  return { from: parse(query.from, 'from'), to: parse(query.to, 'to') }
}

/** A Mongo filter clause bounding `field` to the window; empty when the
 * window is fully open, so it can be spread into any query filter. */
export const windowFilter = (
  field: string,
  window: ReportWindow,
): Record<string, unknown> =>
  window.from || window.to
    ? {
        [field]: {
          ...(window.from ? { $gte: window.from } : {}),
          ...(window.to ? { $lte: window.to } : {}),
        },
      }
    : {}
