/**
 * The people-with-access list for any resolved ACL (SHARE-1): user ids
 * joined with display names and emails, one role per person. Shared by
 * lecture and project share actions.
 */
import type { DeckShare } from '@slide-machine/shared'
import { UserModel } from '../models/user'
import type { ResolvedAcl } from './access'

export const sharesOfAcl = async (acl: ResolvedAcl): Promise<DeckShare[]> => {
  const ids = [...new Set([...acl.viewers, ...acl.editors])]
  const users = await UserModel.find({ _id: { $in: ids } })
  const byId = new Map(users.map(u => [u._id.toString(), u]))
  const entry = (userId: string, role: DeckShare['role']): DeckShare | null => {
    const user = byId.get(userId)
    if (!user) return null
    return { userId, displayName: user.displayName, email: user.email, role }
  }
  return [
    ...acl.viewers.map(id => entry(id, 'viewer')),
    ...acl.editors.map(id => entry(id, 'editor')),
  ].filter((share): share is DeckShare => share !== null)
}
