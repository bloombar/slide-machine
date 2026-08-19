/**
 * Cost-reporting API client (SPEC BILL-7). Read-only, admin-only — the ledger
 * spans every account, so the server gates all of it behind the allowlist and
 * there is deliberately no user-facing equivalent.
 */
import type {
  CostOverviewResponse,
  CostSummaryResponse,
  UsageWindow,
} from '@slide-machine/shared'
import { apiFetch } from './http'

/** Which entity a summary is about. */
export type CostScope =
  | { kind: 'user'; id: string }
  | { kind: 'project'; id: string }
  | { kind: 'deck'; id: string }

const PATHS: Record<CostScope['kind'], string> = {
  user: 'users',
  project: 'projects',
  deck: 'decks',
}

/** An optional reporting window: a named one (`window` — the payer's current
 * billing period, or the whole ledger) or an ad-hoc `from`/`to` pair. A named
 * window wins over the pair, mirroring the server. */
export interface CostWindowQuery {
  window?: UsageWindow
  from?: string
  to?: string
}

const query = (window: CostWindowQuery = {}): string => {
  const params = new URLSearchParams()
  if (window.window) params.set('window', window.window)
  if (window.from) params.set('from', window.from)
  if (window.to) params.set('to', window.to)
  const encoded = params.toString()
  return encoded ? `?${encoded}` : ''
}

export const fetchCostSummary = (
  scope: CostScope,
  window: CostWindowQuery = {},
): Promise<CostSummaryResponse> =>
  apiFetch<CostSummaryResponse>(
    `/api/admin/cost/${PATHS[scope.kind]}/${scope.id}${query(window)}`,
  )

export const fetchCostOverview = (
  window: CostWindowQuery = {},
): Promise<CostOverviewResponse> =>
  apiFetch<CostOverviewResponse>(`/api/admin/cost${query(window)}`)

/** Where the CSV lives. A plain link rather than a fetch: the export streams,
 * and the browser's own download handling is better at a long response than
 * holding one in memory would be. */
export const costExportPath = (window: CostWindowQuery = {}): string =>
  `/api/admin/cost/export${query(window)}`
