/**
 * User model (SPEC §15). The DB shape mirrors the shared User type; the
 * DTO mapper's return type is the compile-time contract with the client.
 * passwordHash is select:false — only the login path asks for it.
 */
import { Schema, model, type HydratedDocument } from 'mongoose'
import {
  LOCALES,
  PLAN_TIERS,
  type SafeUser,
  type User,
} from '@slide-machine/shared'

export interface UserDb extends Omit<User, 'id' | 'createdAt'> {
  createdAt: Date
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
    emailVerified: { type: Boolean, default: false },
    bio: String,
    avatarUrl: String,
    locale: { type: String, enum: LOCALES, default: 'en' },
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

/** Maps a user document to the wire shape; never exposes passwordHash. */
export const toUserDto = (doc: HydratedDocument<UserDb>): SafeUser => ({
  id: doc._id.toString(),
  email: doc.email,
  displayName: doc.displayName,
  emailVerified: doc.emailVerified,
  bio: doc.bio,
  avatarUrl: doc.avatarUrl,
  locale: doc.locale,
  projectDefaults: doc.projectDefaults,
  planTier: doc.planTier,
  billingProvider: doc.billingProvider,
  billingCustomerId: doc.billingCustomerId,
  createdAt: doc.createdAt.toISOString(),
})
