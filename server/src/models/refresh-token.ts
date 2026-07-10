/**
 * Refresh-token session store (SPEC AUTH-2). One document per live
 * session; only an HMAC hash of the token is stored, so a database leak
 * cannot forge or replay sessions. Mongo's TTL monitor garbage-collects
 * expired docs, but validity is always re-checked in queries because the
 * sweep only runs about once a minute.
 */
import { Schema, model, Types } from 'mongoose'

export interface RefreshTokenDb {
  userId: Types.ObjectId
  tokenHash: string
  createdAt: Date
  expiresAt: Date
}

const refreshTokenSchema = new Schema<RefreshTokenDb>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  tokenHash: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
})

// TTL index: mongod deletes docs once expiresAt passes
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const RefreshTokenModel = model<RefreshTokenDb>(
  'RefreshToken',
  refreshTokenSchema,
)
