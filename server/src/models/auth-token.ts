/**
 * Single-use tokens mailed to a user (AUTH-3 / AUTH-4): the link that proves
 * they own an address, and the link that lets them set a new password.
 *
 * Only an HMAC hash of the token is stored, the same way refresh sessions are
 * (models/refresh-token), so a database leak cannot forge or replay a link.
 * `purpose` is part of what is hashed, so a verification link can never be
 * presented as a password reset. Mongo's TTL monitor sweeps expired documents,
 * but validity is always re-checked in the query because the sweep only runs
 * about once a minute.
 */
import { Schema, model, Types } from 'mongoose'

/** What a mailed token entitles its holder to do. */
export type AuthTokenPurpose = 'verify-email' | 'password-reset'

export const AUTH_TOKEN_PURPOSES: AuthTokenPurpose[] = [
  'verify-email',
  'password-reset',
]

export interface AuthTokenDb {
  userId: Types.ObjectId
  purpose: AuthTokenPurpose
  tokenHash: string
  createdAt: Date
  expiresAt: Date
}

const authTokenSchema = new Schema<AuthTokenDb>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  purpose: { type: String, enum: AUTH_TOKEN_PURPOSES, required: true },
  tokenHash: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
})

// TTL index: mongod deletes documents once expiresAt passes
authTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const AuthTokenModel = model<AuthTokenDb>('AuthToken', authTokenSchema)
