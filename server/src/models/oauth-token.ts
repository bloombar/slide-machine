/**
 * An access or refresh token issued to an assistant on a user's behalf
 * (docs/MCP.md §5).
 *
 * Opaque random strings, stored only as HMACs — the same arrangement session
 * refresh tokens use (models/refresh-token.ts), and for the same reason: a
 * database leak must not yield anything that can be replayed.
 *
 * Deliberately *not* a self-contained JWT. A signed token that carries its own
 * claims cannot be withdrawn before it expires, and revocation is most of what
 * this feature promises the user: disconnect one assistant, stay signed in
 * everywhere else. Checking the database on every call is the price of being
 * able to say no afterwards.
 *
 * `clientId` + `userId` together are what the connected-assistants list shows
 * and what disconnecting deletes, so a revocation covers every token that pair
 * ever issued rather than only the one presented.
 */
import { Schema, model, Types } from 'mongoose'

export type OAuthTokenKind = 'access' | 'refresh'

export interface OAuthTokenDb {
  tokenHash: string
  kind: OAuthTokenKind
  clientId: string
  userId: Types.ObjectId
  scopes: string[]
  /** RFC 8707 resource this token is valid for, when the client named one. */
  resource?: string
  /**
   * Groups every access and refresh token descended from one authorization
   * grant (rework round 1's root cause A, docs/plans/OAUTH_CONSENT_SECURITY.md).
   * For a grant's first token pair this is the authorization code's own
   * `codeHash`; rotation (`rotateTokens`) carries the presented token's
   * `familyId` forward onto its replacement, so the value is identical across
   * any number of rotations. Revoking a compromised chain is then
   * `deleteMany({ familyId })` — it survives rotation (unlike a hash
   * snapshot taken once and never updated) and never reaches an unrelated
   * connection through the same (user, client) pair (unlike `disconnect`,
   * which is keyed on exactly that pair and was shown to take out a
   * bystander's live connection in rework round 1's review).
   */
  familyId: string
  /**
   * Set on a `kind: 'refresh'` row the moment it is rotated away from,
   * instead of being deleted immediately (finding 3 / root cause B). Read
   * together with a shortened `expiresAt`: presenting the token again before
   * that shortened expiry is an ordinary retry (the SDK client has no
   * single-flight around refresh — a lost response's retry is the *only*
   * copy the honest caller has); presenting it again after is treated as
   * reuse, because a live token has no legitimate reason to be replayed.
   */
  supersededAt?: Date
  createdAt: Date
  expiresAt: Date
}

const oauthTokenSchema = new Schema<OAuthTokenDb>({
  tokenHash: { type: String, required: true, unique: true },
  kind: { type: String, required: true, enum: ['access', 'refresh'] },
  clientId: { type: String, required: true },
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  scopes: { type: [String], required: true },
  resource: { type: String },
  familyId: { type: String, required: true, index: true },
  supersededAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
})

// One connection is (client, user); the list and the disconnect both key on it.
oauthTokenSchema.index({ clientId: 1, userId: 1 })
oauthTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const OAuthTokenModel = model<OAuthTokenDb>(
  'OAuthToken',
  oauthTokenSchema,
)
