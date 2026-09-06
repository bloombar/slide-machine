/**
 * Pending share invitations (SHARE-3): shares offered to an address that has
 * no account yet, and the claim that turns them into real access the moment
 * one exists.
 *
 * Access control keys on user ids, so an invitation cannot be an ACL entry —
 * it is parked on the lecture or project (models/share-invite.ts) and read
 * only here and by the share lists. `claimShareInvites` runs wherever an
 * address becomes **proven** — confirming it (AUTH-3), completing a password
 * reset sent to it, or signing in with Google, which verified it — never at
 * registration, since anyone can type any address into a sign-up form.
 */
import type { ShareRole } from '@slide-machine/shared'
import { DeckModel } from '../models/deck'
import { ProjectModel } from '../models/project'
import { UserModel } from '../models/user'
import { isEmailBanned } from '../models/banned-email'
import type { ShareInviteDb } from '../models/share-invite'

/** The stored form of an address: what both accounts and invites hold. */
export const normalizeEmail = (email: string): string =>
  email.toLowerCase().trim()

/**
 * Whether an address could ever claim an invitation.
 *
 * Two addresses look claimable and are not. A deleted account keeps its row
 * and its unique email index (P-10 tombstones rather than removes), so
 * nobody can register it again; and a banned address is refused at
 * registration and at sign-in. Inviting either would strand the share and
 * mail someone who may have asked to be forgotten, so the share actions
 * refuse instead.
 *
 * A live account that has simply never confirmed its address is perfectly
 * claimable — confirming is exactly what it has left to do — so only the
 * tombstone counts here, not the mere existence of a row.
 */
export const invitable = async (email: string): Promise<boolean> => {
  const address = normalizeEmail(email)
  if (await isEmailBanned(address)) return false
  const existing = await UserModel.findOne({ email: address })
    .setOptions({ withDeleted: true })
    .catch(() => null)
  return !existing?.deletedAt
}

/**
 * Records an invitation on a list, replacing any invitation already held for
 * the same address — one role per person, exactly as a granted share has one
 * role. Returns the list so a caller can assign it back.
 */
export const upsertInvite = (
  invites: ShareInviteDb[] | undefined,
  email: string,
  role: ShareRole,
): ShareInviteDb[] => [
  ...(invites ?? []).filter(i => i.email !== normalizeEmail(email)),
  { email: normalizeEmail(email), role, invitedAt: new Date() },
]

/** Drops any invitation held for an address. */
export const removeInvite = (
  invites: ShareInviteDb[] | undefined,
  email: string,
): ShareInviteDb[] =>
  (invites ?? []).filter(i => i.email !== normalizeEmail(email))

/** Moves one invited address onto a viewer/editor list, one role only. */
const grantOn = (
  viewers: string[],
  editors: string[],
  userId: string,
  role: ShareRole,
): void => {
  const list = role === 'editor' ? editors : viewers
  const other = role === 'editor' ? viewers : editors
  if (!list.includes(userId)) list.push(userId)
  const index = other.indexOf(userId)
  if (index >= 0) other.splice(index, 1)
}

/**
 * Grants every invitation held for `email` to the account that now owns it,
 * and clears them. Returns how many were claimed, for the caller's log.
 *
 * Best-effort by design: a failure here must not fail the registration that
 * triggered it — the person still has an account, and the invitation is
 * still on the document for the next sign-in to claim.
 */
export const claimShareInvites = async (
  userId: string,
  email: string,
): Promise<number> => {
  const address = normalizeEmail(email)
  let claimed = 0

  const decks = await DeckModel.find({
    'accessOverride.invites.email': address,
  })
  for (const deck of decks) {
    const override = deck.accessOverride
    if (!override) continue
    const invite = (override.invites ?? []).find(i => i.email === address)
    if (!invite) continue
    // An invited person is never the owner: the share actions refuse the
    // owner's own address, so this cannot demote them to a viewer.
    grantOn(override.viewers, override.editors, userId, invite.role)
    override.invites = removeInvite(override.invites, address)
    deck.markModified('accessOverride')
    await deck.save()
    claimed += 1
  }

  const projects = await ProjectModel.find({ 'invites.email': address })
  for (const project of projects) {
    const invite = (project.invites ?? []).find(i => i.email === address)
    if (!invite) continue
    grantOn(project.viewers, project.editors, userId, invite.role)
    project.invites = removeInvite(project.invites, address)
    await project.save()
    claimed += 1
  }

  return claimed
}
