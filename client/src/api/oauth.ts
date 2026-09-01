/**
 * The consent screen's API (docs/MCP.md §5).
 *
 * Three calls, all requiring a signed-in session: read what an assistant is
 * asking for, then approve or decline it. Deliberately not action-layer calls
 * — an authorization request is not one of the account's own resources, and it
 * is identified by an id that only exists between the assistant's redirect and
 * the user's answer.
 */
import { apiFetch } from './http'

/** One permission being requested, with the sentence the user reads. */
export interface ConsentScope {
  scope: string
  description: string
}

export interface ConsentRequest {
  /** What the assistant called itself. A label it chose, never a verified claim. */
  clientName: string
  scopes: ConsentScope[]
}

export const getConsentRequest = (id: string): Promise<ConsentRequest> =>
  apiFetch<ConsentRequest>(`/api/oauth/authorization/${id}`)

/** Both answers return where to send the browser back to. */
const answer = (id: string, verb: 'approve' | 'deny') =>
  apiFetch<{ redirectTo: string }>(`/api/oauth/authorization/${id}/${verb}`, {
    method: 'POST',
    body: JSON.stringify({}),
  })

export const approveConsent = (id: string) => answer(id, 'approve')
export const denyConsent = (id: string) => answer(id, 'deny')
