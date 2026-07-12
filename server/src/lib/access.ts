/**
 * The access-control core (SHARE-1), shared by projects and lectures:
 * every access decision runs through one resolved ACL shape. A
 * project's ACL is its own; a lecture's is its override when one exists
 * (copy-on-write, created the first time its privacy settings are
 * touched), otherwise its project's — so project changes cascade to
 * every inheriting lecture automatically.
 */
import type { Visibility } from '@slide-machine/shared'

/** One resolved access-control list; decisions never look elsewhere. */
export interface ResolvedAcl {
  ownerId: string
  visibility: Visibility
  viewers: string[]
  editors: string[]
  /** True when this ACL was inherited (a lecture without an override). */
  inherited: boolean
}

/** True when `userId` may edit: the owner, or a listed editor. */
export const canEditAcl = (acl: ResolvedAcl, userId?: string): boolean => {
  if (!userId) return false
  return acl.ownerId === userId || acl.editors.includes(userId)
}

/** True when `userId` (or anonymous) may view: public general access,
 * any person with access (viewer or editor), or the owner. */
export const canViewAcl = (acl: ResolvedAcl, userId?: string): boolean => {
  if (acl.visibility === 'public') return true
  if (canEditAcl(acl, userId)) return true
  return !!userId && acl.viewers.includes(userId)
}

/** True when `userId` is on the ACL at all — owner, editor, or listed
 * viewer. Unlike canViewAcl this ignores public visibility: it gates
 * management surfaces (project pages, member lists), where "public"
 * means the CONTENT is viewable by link, not that the entity's
 * management data is open to any signed-in stranger. */
export const isAclMember = (acl: ResolvedAcl, userId?: string): boolean => {
  if (!userId) return false
  return canEditAcl(acl, userId) || acl.viewers.includes(userId)
}
