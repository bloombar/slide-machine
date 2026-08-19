/**
 * Research-export API client (SPEC EVAL-2). Admin-only — the bundle spans
 * every account, so the server gates it behind the allowlist and there is
 * deliberately no user-facing equivalent.
 */
import { apiFetchBlob } from './http'
import type { CostWindowQuery } from './cost'

const query = (window: CostWindowQuery = {}): string => {
  const params = new URLSearchParams()
  if (window.from) params.set('from', window.from)
  if (window.to) params.set('to', window.to)
  const encoded = params.toString()
  return encoded ? `?${encoded}` : ''
}

/** Where the zip lives; exported for the page's tests. */
export const researchExportPath = (window: CostWindowQuery = {}): string =>
  `/api/admin/research/export${query(window)}`

/** The bundle as a blob — fetched rather than plain-linked, because a
 * plain <a href> can't send the Bearer token the admin API requires. */
export const downloadResearchBundle = (
  window: CostWindowQuery = {},
): Promise<Blob> => apiFetchBlob(researchExportPath(window))
