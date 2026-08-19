/**
 * Per-account study ids for the de-identified research export (SPEC EVAL-2,
 * P-14). Every record in an export bundle is keyed by this pseudonym rather
 * than by user id, email, or display name.
 *
 * Ids are random rather than derived: a hash of the user id would tie every
 * account's pseudonym to one secret's lifecycle, and rotating that secret
 * would silently re-key a longitudinal dataset mid-study. A stored random id
 * has no key to lose — re-identification requires the database itself, which
 * the export never ships.
 */
import { randomBytes } from 'node:crypto'
import { Types } from 'mongoose'
import { UserModel } from '../models/user'

/** A fresh pseudonym: 64 random bits as 16 hex chars — meaningless on its
 * own, and far too sparse a space for two accounts to collide in. */
const mintStudyId = (): string => randomBytes(8).toString('hex')

/**
 * Resolves the study id for every referenced account, assigning one to any
 * account that has none yet, and returns userId → studyId.
 *
 * Assignment is guarded on the field still being absent, so a concurrent
 * export can never overwrite an id already in use — whichever write lands
 * first sticks, and both exports read the same winner back.
 *
 * Soft-deleted accounts resolve too (their lectures' sessions still
 * happened); an id that no longer resolves at all — purged mid-export —
 * is simply absent from the map, and its rows export a blank pseudonym,
 * mirroring how the cost ledger renders an anonymous actor.
 */
export const ensureStudyIds = async (
  userIds: Iterable<Types.ObjectId | string>,
): Promise<Map<string, string>> => {
  const ids = [...new Set([...userIds].map(id => id.toString()))].filter(id =>
    Types.ObjectId.isValid(id),
  )
  if (ids.length === 0) return new Map()

  // bulkWrite bypasses query middleware, so tombstoned accounts are covered
  // without a withDeleted flag; the $exists guard makes each op a no-op for
  // accounts already keyed.
  await UserModel.bulkWrite(
    ids.map(id => ({
      updateOne: {
        filter: { _id: new Types.ObjectId(id), studyId: { $exists: false } },
        update: { $set: { studyId: mintStudyId() } },
      },
    })),
    { ordered: false },
  )

  const users = await UserModel.find({ _id: { $in: ids } })
    .select('_id +studyId')
    .setOptions({ withDeleted: true })
  return new Map(
    users.flatMap(user =>
      user.studyId ? [[user._id.toString(), user.studyId]] : [],
    ),
  )
}
