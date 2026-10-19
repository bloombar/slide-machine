/**
 * Session-telemetry API client (SPEC EVAL-1). Read-only, admin-only — the
 * record spans every lecture, so the server gates all of it behind the
 * allowlist and there is deliberately no user-facing equivalent.
 */
import type {
  TelemetryDeckResponse,
  TelemetryOverviewResponse,
} from '@slide-machine/shared'
import { apiFetch, apiFetchBlob } from './http'

/** An optional reporting window; both ends open by default, because
 * "everything so far" is the question an operator asks first. */
export interface TelemetryWindowQuery {
  from?: string
  to?: string
}

const query = (window: TelemetryWindowQuery = {}): string => {
  const params = new URLSearchParams()
  if (window.from) params.set('from', window.from)
  if (window.to) params.set('to', window.to)
  const encoded = params.toString()
  return encoded ? `?${encoded}` : ''
}

export const fetchTelemetryOverview = (
  window: TelemetryWindowQuery = {},
): Promise<TelemetryOverviewResponse> =>
  apiFetch<TelemetryOverviewResponse>(`/api/admin/telemetry${query(window)}`)

export const fetchDeckTelemetry = (
  deckId: string,
  window: TelemetryWindowQuery = {},
): Promise<TelemetryDeckResponse> =>
  apiFetch<TelemetryDeckResponse>(
    `/api/admin/telemetry/decks/${deckId}${query(window)}`,
  )

/** The session CSV as a blob (SPEC EVAL-1) — fetched rather than
 * plain-linked, because a plain <a href> can't send the Bearer token the
 * admin API needs. */
export const downloadTelemetryExport = (
  window: TelemetryWindowQuery = {},
): Promise<Blob> => apiFetchBlob(`/api/admin/telemetry/export${query(window)}`)
