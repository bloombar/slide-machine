/**
 * The people-with-access list for any resolved ACL (SHARE-1): user ids
 * joined with display names and emails, one role per person, followed by
 * the invitations still waiting for an account (SHARE-3). Shared by lecture
 * and project share actions.
 */
import type { DeckShare } from '@slide-machine/shared'
import { UserModel } from '../models/user'
import type { ResolvedAcl } from './access'

export const sharesOfAcl = async (acl: ResolvedAcl): Promise<DeckShare[]> => {
  // Invitations ride on the resolved ACL beside the people they will become
  // (lib/access.ts); reading them from anywhere else would give one list two
  // sources that could disagree.
  const invites = acl.invites ?? []
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
    // No account, so no id and no name to show — the address is the person.
    ...invites.map((invite): DeckShare => ({
      userId: '',
      displayName: '',
      email: invite.email,
      role: invite.role,
      pending: true,
    })),
  ].filter((share): share is DeckShare => share !== null)
}
