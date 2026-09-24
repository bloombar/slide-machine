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
   * HMAC of the refresh token this one replaced, kept for exactly one
   * generation (finding 3, docs/plans/OAUTH_CONSENT_SECURITY.md). Rotation
   * deletes the superseded row, so without this a stolen token that gets
   * rotated first leaves no trace: the legitimate client's next refresh just
   * fails, and nobody is told why. Only set on `kind: 'refresh'` rows.
   */
  previousTokenHash?: string
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
  previousTokenHash: { type: String },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
})

// One connection is (client, user); the list and the disconnect both key on it.
oauthTokenSchema.index({ clientId: 1, userId: 1 })
oauthTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
// Reuse detection looks up "who replaced this token", not "who does this
// token belong to" — a second index, sparse because only rotated-in refresh
// tokens carry the field at all.
oauthTokenSchema.index({ previousTokenHash: 1 }, { sparse: true })

export const OAuthTokenModel = model<OAuthTokenDb>(
  'OAuthToken',
  oauthTokenSchema,
)
