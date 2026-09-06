/**
 * A share offered to an email address with no account yet (SHARE-3).
 *
 * Access control keys on user ids, and an invited person has none — so the
 * grant is parked here, on the lecture or project it was made on, until
 * someone registers with that address and claims it (lib/share-invites.ts).
 * Nothing in lib/access.ts reads these: an invitation confers no access on
 * its own, which is what keeps "invited" and "has access" distinct.
 */
import { Schema } from 'mongoose'
import type { ShareRole } from '@slide-machine/shared'

export interface ShareInviteDb {
  /** Lowercased, trimmed — the same form accounts store, so the claim at
   * registration is a plain equality match. */
  email: string
  role: ShareRole
  invitedAt: Date
}

/** Strict, id-less subdocument, embedded by both deck and project. */
export const shareInviteSchema = new Schema<ShareInviteDb>(
  {
    email: { type: String, required: true },
    role: { type: String, enum: ['viewer', 'editor'], required: true },
    invitedAt: { type: Date, default: () => new Date() },
  },
  { _id: false },
)
