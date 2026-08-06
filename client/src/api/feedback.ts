/**
 * The "Send feedback" form's one call. Not an action like most of the API:
 * actions require a signed-in caller, and this form is on a public page — a
 * visitor who cannot get past a bug is exactly the person worth hearing
 * from. The server identifies the sender from the access token when there is
 * one, which apiFetch attaches automatically.
 */
import type { FeedbackRequest, FeedbackResponse } from '@slide-machine/shared'
import { apiFetch } from './http'

export const sendFeedback = (
  input: FeedbackRequest,
): Promise<FeedbackResponse> =>
  apiFetch<FeedbackResponse>('/api/feedback', {
    method: 'POST',
    body: JSON.stringify(input),
  })
