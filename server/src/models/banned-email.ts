/**
 * Banned-email model. A listed email can neither register a new account
 * nor sign in to an existing one (password or Google) — the checks live
 * in auth/service.ts. Rows are written only by the admin ban endpoint,
 * which also records the actor in the admin action log; removing a ban
 * is a direct database operation today (docs/ADMINISTRATION.md).
 */
import { Schema, model, Types } from 'mongoose'

export interface BannedEmailDb {
  email: string
  /** The admin who imposed the ban. */
  bannedBy: Types.ObjectId
  /** Optional short note on why, shown nowhere user-facing. */
  reason?: string
  createdAt: Date
}

const bannedEmailSchema = new Schema<BannedEmailDb>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    bannedBy: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    reason: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

export const BannedEmailModel = model<BannedEmailDb>(
  'BannedEmail',
  bannedEmailSchema,
)

/** Whether this email is banned; input is normalized like User.email. */
export const isEmailBanned = async (email: string): Promise<boolean> => {
  const banned = await BannedEmailModel.exists({
    email: email.toLowerCase().trim(),
  })
  return banned !== null
}
