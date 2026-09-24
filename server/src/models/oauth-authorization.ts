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
 *
 * A replayed code also revokes what it minted (finding 2, rework round 1's
 * root cause A). `codeHash` itself is used as the **token family id**
 * (`OAuthTokenDb.familyId`) rather than snapshotting the minted tokens'
 * hashes onto this row after the fact — a snapshot written in a second,
 * non-atomic update left a window where a genuinely concurrent double
 * exchange's loser found nothing to revoke, because the winner had not
 * finished writing yet. `codeHash` is known before any database round trip
 * and never changes, so it needs no snapshot and the race closes on its own.
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
  /**
   * HMAC of the nonce set in the browser-binding cookie when this request was
   * parked (docs/plans/OAUTH_CONSENT_SECURITY.md, finding 1a). Proves the
   * browser reading, approving or denying this request is the one `authorize`
   * sent to the consent screen in the first place — the id alone is a Mongo
   * ObjectId, not a secret, so without this a parked request could be
   * approved by whoever the link was forwarded to.
   */
  browserNonceHash: string
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
  browserNonceHash: { type: String, required: true },
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
