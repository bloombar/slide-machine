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
