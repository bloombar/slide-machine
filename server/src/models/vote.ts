/**
 * Vote model (SPEC §15 / SOC-1). One up (+1) or down (-1) vote by a user on a
 * deck or template. The unique index makes it one vote per user per item, and
 * changeable (upsert to switch, delete to clear). The denormalized net score
 * lives on the target itself (`deck.voteScore`) so feeds can sort on it.
 */
import { Schema, model, Types } from 'mongoose'

export interface VoteDb {
  userId: Types.ObjectId
  targetType: 'deck' | 'template'
  targetId: Types.ObjectId
  value: 1 | -1
}

const voteSchema = new Schema<VoteDb>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    targetType: { type: String, enum: ['deck', 'template'], required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    value: { type: Number, enum: [1, -1], required: true },
  },
  { timestamps: true },
)

// One vote per user per item (SOC-1).
voteSchema.index({ userId: 1, targetType: 1, targetId: 1 }, { unique: true })
// Summing / clearing all votes for an item.
voteSchema.index({ targetType: 1, targetId: 1 })

export const VoteModel = model<VoteDb>('Vote', voteSchema)

/** Recomputes an item's net score from its votes. */
export const tallyVotes = async (
  targetType: 'deck' | 'template',
  targetId: Types.ObjectId,
): Promise<number> => {
  const [row] = await VoteModel.aggregate<{ score: number }>([
    { $match: { targetType, targetId } },
    { $group: { _id: null, score: { $sum: '$value' } } },
  ])
  return row?.score ?? 0
}

/** Up- and down-vote counts (and net score) for one item, shown side by side. */
export const voteBreakdown = async (
  targetType: 'deck' | 'template',
  targetId: Types.ObjectId,
): Promise<{ up: number; down: number; voteScore: number }> => {
  const [row] = await VoteModel.aggregate<{ up: number; down: number }>([
    { $match: { targetType, targetId } },
    {
      $group: {
        _id: null,
        up: { $sum: { $cond: [{ $eq: ['$value', 1] }, 1, 0] } },
        down: { $sum: { $cond: [{ $eq: ['$value', -1] }, 1, 0] } },
      },
    },
  ])
  const up = row?.up ?? 0
  const down = row?.down ?? 0
  return { up, down, voteScore: up - down }
}

/** Up/down counts for many items at once (feed rows), keyed by target id. */
export const voteBreakdowns = async (
  targetType: 'deck' | 'template',
  targetIds: Types.ObjectId[],
): Promise<Map<string, { up: number; down: number }>> => {
  if (targetIds.length === 0) return new Map()
  const rows = await VoteModel.aggregate<{
    _id: Types.ObjectId
    up: number
    down: number
  }>([
    { $match: { targetType, targetId: { $in: targetIds } } },
    {
      $group: {
        _id: '$targetId',
        up: { $sum: { $cond: [{ $eq: ['$value', 1] }, 1, 0] } },
        down: { $sum: { $cond: [{ $eq: ['$value', -1] }, 1, 0] } },
      },
    },
  ])
  return new Map(rows.map(r => [r._id.toString(), { up: r.up, down: r.down }]))
}
