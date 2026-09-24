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
   *
   * **Optional, not required** (rework round 2's must-fix 1): every row this
   * server writes from here on carries one, but a row written before this
   * field existed carries none, and refresh tokens live 182 days — long
   * enough that "no migration, fails closed" (the right call for the much
   * shorter-lived `browserNonceHash`) would instead mean an unpredictable mix
   * of forced re-auths and, on one specific timing, an uncaught 500 for every
   * pre-existing connection for months after a deploy. `rotateTokens` upgrades
   * a legacy row to a real family on its next rotation; `endFamily` falls back
   * to `disconnect` for the rarer case where one needs revoking before that
   * happens.
   */
  familyId?: string
  /**
   * Set on a `kind: 'refresh'` row the moment it is rotated away from,
   * instead of being deleted immediately (finding 3 / root cause B). Read
   * together with `usableUntil`: presenting the token again before that
   * closes is an ordinary retry (the SDK client has no single-flight around
   * refresh — a lost response's retry is the *only* copy the honest caller
   * has); presenting it again after is treated as reuse, because a live
   * token has no legitimate reason to be replayed. Stamped unconditionally
   * the first time a token is rotated, independent of whether `usableUntil`
   * actually moves (rework round 2's must-fix 2) — they record two different
   * facts, and a token rotated within its own last moments still needs to be
   * marked, or a later replay of it is undetectable.
   */
  supersededAt?: Date
  /**
   * When a `kind: 'refresh'` row stops being spendable — separate from
   * `expiresAt`, which is retention: how long the row itself is kept, read by
   * the TTL index below (rework round 2's must-fix 3). The two used to be the
   * same field, so marking a token superseded shortened `expiresAt` to the
   * grace window, and the TTL reaper removed the row roughly a minute after
   * that — meaning reuse detection protected a window a couple of minutes
   * wide against a threat (a leaked or stolen token) that plays out over
   * days. Now `expiresAt` stays at its original value (up to 182 days for a
   * refresh token) and only `usableUntil` moves, so a superseded row survives
   * long enough for a realistic replay to still find it.
   *
   * Optional for the same reason `familyId` is: a row written before this
   * field existed has none, and the spendability check falls back to
   * `expiresAt` for those. Only meaningful on `kind: 'refresh'` rows.
   */
  usableUntil?: Date
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
  familyId: { type: String, index: true },
  supersededAt: { type: Date },
  usableUntil: { type: Date },
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
