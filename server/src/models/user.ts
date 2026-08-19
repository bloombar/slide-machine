/**
 * User model (SPEC §15). The DB shape mirrors the shared User type; the
 * DTO mapper's return type is the compile-time contract with the client.
 * passwordHash is select:false — only the login path asks for it.
 */
import { Schema, model, type HydratedDocument } from 'mongoose'
import {
  ACCOUNT_TYPES,
  LOCALES,
  PLAN_TIERS,
  type PublicUser,
  type SafeUser,
  type User,
} from '@slide-machine/shared'
import {
  effectivePlanTier,
  planGrantView,
  type PlanGrantDb,
} from '../billing/plan-grant'
import { softDeletePlugin } from './plugins/soft-delete'

export interface UserDb extends Omit<User, 'id' | 'createdAt' | 'planGrant'> {
  createdAt: Date
  /**
   * A complimentary plan an admin gave this account (ADMIN-9), stored beside
   * `planTier` rather than in it — `planTier` stays whatever the account's
   * own billing entitles it to. Kept after it lapses, as history, until it is
   * replaced or revoked; billing/plan-grant.ts decides when one counts.
   */
  planGrant?: PlanGrantDb | null
  /** Soft-delete tombstone (P-10); null/absent = live. */
  deletedAt?: Date | null
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
  /**
   * Opaque research pseudonym (EVAL-2): the only key the de-identified
   * research export uses for this account. Random, assigned lazily the
   * first time an export references the account, and stable ever after so
   * exports of different windows still join. select:false — a pseudonym
   * listed beside the identity it stands in for stops being one.
   */
  studyId?: string
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
    // No default: absent is what makes the prompt appear after sign-in
    // (AUTH-6), so accounts that predate the question are asked too.
    accountType: { type: String, enum: ACCOUNT_TYPES },
    bio: String,
    avatarUrl: String,
    // Interface language: stored ONLY when explicitly chosen (no default)
    // — absent falls through to the browser's language, re-matched
    // against LOCALES on each visit so a newly supported language is
    // picked up without touching stored accounts
    locale: { type: String, enum: LOCALES },
    // Lecturing/generation language: stored ONLY when explicitly chosen
    // (no default) — absent falls through to the browser's language
    language: { type: String, enum: LOCALES },
    // Whether the account wants the advisory "you are close to a limit"
    // email (BILL-8). Stored as an opt-OUT: everyone gets the warning until
    // they say otherwise, because the whole point of it is reaching people who
    // were not expecting a cap. The exhaustion notice has no switch — it
    // explains why something the user just attempted did not happen.
    notifyCapWarnings: { type: Boolean, default: true },
    projectDefaults: {
      type: { manualSlideAdvance: Boolean, animatedTransitions: Boolean },
      default: undefined,
      _id: false,
    },
    planTier: { type: String, enum: PLAN_TIERS, default: 'free' },
    // A complimentary plan (ADMIN-9). `default: undefined` so an account
    // that was never granted one carries no empty subdocument, and the
    // absence is what every read tests.
    planGrant: {
      type: {
        tier: { type: String, enum: PLAN_TIERS, required: true },
        expiresAt: { type: Date, required: true },
        grantedAt: { type: Date, required: true },
        grantedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        grantedByEmail: { type: String, required: true },
        note: String,
      },
      default: undefined,
      _id: false,
    },
    billingProvider: String,
    billingCustomerId: String,
    // Research pseudonym (EVAL-2). Sparse + unique: most accounts never
    // appear in an export and share the absent value; two accounts sharing
    // a pseudonym would silently merge in every study dataset.
    studyId: { type: String, unique: true, sparse: true, select: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

// Finding people by name (SOC-2). Profiles are public, so a name is how you
// reach someone's work; indexed so the lookup does not scan every account.
userSchema.index({ displayName: 'text' }, { name: 'user_text' })

userSchema.plugin(softDeletePlugin)

export const UserModel = model<UserDb>('User', userSchema)

/** The stranger-safe subset of a user for public profile pages. */
export const toPublicUserDto = (doc: HydratedDocument<UserDb>): PublicUser => ({
  id: doc._id.toString(),
  displayName: doc.displayName,
  bio: doc.bio,
  avatarUrl: doc.avatarUrl,
  createdAt: doc.createdAt.toISOString(),
})

/**
 * Maps a user document to the wire shape; never exposes passwordHash.
 *
 * `planTier` is the **effective** tier — what the account may actually
 * spend against, which is the granted tier while a complimentary grant is
 * in effect (ADMIN-9). Everything downstream reads the tier to decide what
 * to allow or display, so sending the stored one would have every usage bar
 * and plan badge quoting a plan the server is not enforcing.
 */
export const toUserDto = (doc: HydratedDocument<UserDb>): SafeUser => ({
  id: doc._id.toString(),
  email: doc.email,
  displayName: doc.displayName,
  emailVerified: doc.emailVerified,
  profileVisibility: doc.profileVisibility,
  accountType: doc.accountType,
  bio: doc.bio,
  avatarUrl: doc.avatarUrl,
  locale: doc.locale,
  language: doc.language,
  projectDefaults: doc.projectDefaults,
  notifyCapWarnings: doc.notifyCapWarnings !== false,
  planTier: effectivePlanTier(doc),
  planGrant: planGrantView(doc),
  billingProvider: doc.billingProvider,
  // `billingCustomerId` is deliberately absent: the provider issued it, the
  // client has no use for it, and P-8 keeps vendor references server-side.
  createdAt: doc.createdAt.toISOString(),
})
