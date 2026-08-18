/**
 * The one writer for session-telemetry rows (SPEC EVAL-1).
 *
 * Fire-and-forget by construction: it returns void rather than a promise so
 * no call site in the live capture path can be tempted to await it, and every
 * failure is logged rather than raised. Losing a telemetry row costs the
 * study one data point; failing a live lecture costs a speaker their class.
 *
 * Deliberately not gated by any env flag. The record is un-backfillable —
 * a session run while telemetry was "off" has no reliability record, forever
 * — so there is no off.
 */
import { Types } from 'mongoose'
import {
  SessionTelemetryEventModel,
  type SessionTelemetryEventDb,
  type TelemetryKind,
} from '../models/session-telemetry-event'

export type SessionEventInput = Omit<
  SessionTelemetryEventDb,
  'deckId' | 'at'
> & {
  kind: TelemetryKind
  deckId?: string | null
}

/** Appends one telemetry row; never throws, never blocks the caller. */
export const recordSessionEvent = (event: SessionEventInput): void => {
  const { deckId, ...fields } = event
  void SessionTelemetryEventModel.create({
    ...fields,
    deckId: deckId ? new Types.ObjectId(deckId) : null,
    at: new Date(),
  }).catch((error: unknown) => {
    console.error(
      `Failed to record telemetry ${event.kind} for session ${event.sessionId}:`,
      error,
    )
  })
}
