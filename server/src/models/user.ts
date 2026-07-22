/**
 * User model (SPEC §15). The DB shape mirrors the shared User type; the
 * DTO mapper's return type is the compile-time contract with the client.
 * passwordHash is select:false — only the login path asks for it.
 */
import { Schema, model, type HydratedDocument } from 'mongoose'
import {
  LOCALES,
  PLAN_TIERS,
  type PublicUser,
  type SafeUser,
  type User,
} from '@slide-machine/shared'

export interface UserDb extends Omit<User, 'id' | 'createdAt'> {
  createdAt: Date
  // Google's stable subject id, set when an account signs in with Google
  // (AUTH-1). Kept out of the shared User type so it never crosses the
  // wire — it is an internal identity link, not client-facing.
  googleId?: string
  // Whether the user has connected a Google account with Drive/Forms access
  // for quiz publishing (EXP-4). Set in both mock and live modes. Internal,
  // never sent to the client.
  googleConnected?: boolean
  // The connected account's Google refresh token, encrypted at rest (P-9).
  // Present only in live mode after a successful connect. Never leaves the
  // server except as an authorized client injected into the Quiz Generator.
  googleQuizRefreshToken?: string
}

const userSchema = new Schema<UserDb>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    displayName: { type: String, required: true, trim: true },
    passwordHash: { type: String, select: false },
    // Sparse + unique: at most one account per Google identity, but the
    // many password-only users share the absent value without colliding
    googleId: { type: String, unique: true, sparse: true },
    googleConnected: { type: Boolean, default: false },
    // Encrypted (never selected by default, so it can't leak via list queries)
    googleQuizRefreshToken: { type: String, select: false },
    emailVerified: { type: Boolean, default: false },
    profileVisibility: {
      type: String,
      enum: ['public', 'private'],
      default: 'public',
    },
    bio: String,
    avatarUrl: String,
    locale: { type: String, enum: LOCALES, default: 'en' },
    // Lecturing/generation language: stored ONLY when explicitly chosen
    // (no default) — absent falls through to the browser's language
    language: { type: String, enum: LOCALES },
    projectDefaults: {
      type: { manualSlideAdvance: Boolean, animatedTransitions: Boolean },
      default: undefined,
      _id: false,
    },
    planTier: { type: String, enum: PLAN_TIERS, default: 'free' },
    billingProvider: String,
    billingCustomerId: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

export const UserModel = model<UserDb>('User', userSchema)

/** The stranger-safe subset of a user for public profile pages. */
export const toPublicUserDto = (doc: HydratedDocument<UserDb>): PublicUser => ({
  id: doc._id.toString(),
  displayName: doc.displayName,
  bio: doc.bio,
  avatarUrl: doc.avatarUrl,
  createdAt: doc.createdAt.toISOString(),
})

/** Maps a user document to the wire shape; never exposes passwordHash. */
export const toUserDto = (doc: HydratedDocument<UserDb>): SafeUser => ({
  id: doc._id.toString(),
  email: doc.email,
  displayName: doc.displayName,
  emailVerified: doc.emailVerified,
  profileVisibility: doc.profileVisibility,
  bio: doc.bio,
  avatarUrl: doc.avatarUrl,
  locale: doc.locale,
  language: doc.language,
  projectDefaults: doc.projectDefaults,
  planTier: doc.planTier,
  billingProvider: doc.billingProvider,
  billingCustomerId: doc.billingCustomerId,
  createdAt: doc.createdAt.toISOString(),
})
