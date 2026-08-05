/**
 * Feedback DTOs — what the "Send feedback" page posts to the API, which
 * emails it to the address the server is configured with (FEEDBACK_EMAIL).
 * Nothing is stored: the message is relayed and forgotten.
 */

/** What the sender says the message is. Only the wording of the email's
 * subject line depends on it, but it lets whoever reads the inbox sort. */
export const FEEDBACK_KINDS = ['bug', 'feature', 'other'] as const

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]

/** Longest message the API accepts. Generous — a good bug report is long —
 * but bounded, because this endpoint is open to anyone. */
export const FEEDBACK_MESSAGE_MAX = 5000

export interface FeedbackRequest {
  kind: FeedbackKind
  /** One-line summary; becomes the email's subject. */
  subject: string
  message: string
  /** Where to write back. Optional for a signed-in sender, whose account
   * email is used instead; anonymous senders may leave it blank and get no
   * reply. */
  email?: string
  /** The page the sender was on when they opened the form, so a bug report
   * carries its own context. Client-supplied, so it is quoted in the email
   * as information rather than trusted as a fact. */
  page?: string
}

/** Accepted for delivery. There is nothing to return but the fact of it. */
export interface FeedbackResponse {
  sent: true
}
