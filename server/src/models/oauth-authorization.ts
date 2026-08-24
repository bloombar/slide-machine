/**
 * One authorization in flight: from the moment an assistant sends the user
 * here, to the moment its code is exchanged for a token (docs/MCP.md §5).
 *
 * A single document covers both halves of the flow, because they are the same
 * request at two moments:
 *
 *   - **Pending** — the assistant has asked, the user has not yet answered.
 *     `userId` and `codeHash` are absent. The document's id is what appears in
 *     the consent screen's URL, so the parameters the assistant sent are read
 *     from the database rather than carried through the browser where they
 *     could be tampered with.
 *   - **Approved** — the user said yes. `userId` records who, and `codeHash`
 *     is the authorization code they were sent back with.
 *
 * Codes are single-use and short-lived: `redeemedAt` is stamped on exchange,
 * and a second attempt is refused. That matters more than it looks — a
 * replayed code is a stolen session, and the usual way one leaks is a redirect
 * URI that was not checked, which is why `redirectUri` is stored here and
 * compared on exchange rather than taken from the token request.
 */
import { Schema, model, Types } from 'mongoose'

export interface OAuthAuthorizationDb {
  clientId: string
  /** Where the response goes. Validated against the client at request time,
   * and compared again at exchange time (OAuth 2.1 requires both). */
  redirectUri: string
  /** Opaque value the client uses to tie the response to its own request. */
  state?: string
  scopes: string[]
  /** PKCE S256 challenge. Required — OAuth 2.1 has no flow without it. */
  codeChallenge: string
  /** RFC 8707 resource indicator: which server the token is for. */
  resource?: string
  /** Who approved it. Absent while the request is still pending. */
  userId?: Types.ObjectId
  /** HMAC of the authorization code. Absent until approval. */
  codeHash?: string
  /** When the code was exchanged. Set once; a second exchange is refused. */
  redeemedAt?: Date
  createdAt: Date
  expiresAt: Date
}

const oauthAuthorizationSchema = new Schema<OAuthAuthorizationDb>({
  clientId: { type: String, required: true, index: true },
  redirectUri: { type: String, required: true },
  state: { type: String },
  scopes: { type: [String], required: true },
  codeChallenge: { type: String, required: true },
  resource: { type: String },
  userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  codeHash: { type: String, index: true, sparse: true },
  redeemedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
})

// TTL index: an abandoned consent screen cleans itself up. Validity is still
// checked in every query, because the sweep only runs about once a minute.
oauthAuthorizationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const OAuthAuthorizationModel = model<OAuthAuthorizationDb>(
  'OAuthAuthorization',
  oauthAuthorizationSchema,
)
