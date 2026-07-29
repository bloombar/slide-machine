/**
 * Shared helpers for the admin routers: resolving a `:id` route param to
 * the user, project, or lecture it names (404 otherwise), reading the
 * acting admin off the request, and refusing actions aimed at an
 * allowlisted account. Kept in its own module so routes/admin.ts and
 * routes/admin-settings.ts can both use them without importing each
 * other. See docs/ADMINISTRATION.md.
 */
import { isValidObjectId, type HydratedDocument } from 'mongoose'
import { UserModel, type UserDb } from '../models/user'
import { ProjectModel, type ProjectDb } from '../models/project'
import { DeckModel, type DeckDb } from '../models/deck'
import { isAdminEmail } from '../config/admin'
import { HttpError } from '../middleware/error'

/** Resolves a :id route param to an existing user or 404s. */
export const loadUser = async (
  id: string,
): Promise<HydratedDocument<UserDb>> => {
  const notFound = new HttpError(404, 'not_found', 'User not found')
  if (!isValidObjectId(id)) throw notFound
  const user = await UserModel.findById(id)
  if (!user) throw notFound
  return user
}

/** Resolves a :id route param to an existing project or 404s. */
export const loadProject = async (
  id: string,
): Promise<HydratedDocument<ProjectDb>> => {
  const notFound = new HttpError(404, 'not_found', 'Project not found')
  if (!isValidObjectId(id)) throw notFound
  const project = await ProjectModel.findById(id)
  if (!project) throw notFound
  return project
}

/** Resolves a :id route param to an existing lecture or 404s. */
export const loadDeck = async (
  id: string,
): Promise<HydratedDocument<DeckDb>> => {
  const notFound = new HttpError(404, 'not_found', 'Lecture not found')
  if (!isValidObjectId(id)) throw notFound
  const deck = await DeckModel.findById(id)
  if (!deck) throw notFound
  return deck
}

/** Resolves a :id to a **soft-deleted** user/project/lecture for restore
 * (ADMIN-6). 404s if the id is unknown or the record is still live. */
export const loadDeletedUser = async (
  id: string,
): Promise<HydratedDocument<UserDb>> => {
  const notFound = new HttpError(404, 'not_found', 'Deleted user not found')
  if (!isValidObjectId(id)) throw notFound
  const user = await UserModel.findById(id).setOptions({ withDeleted: true })
  if (!user?.deletedAt) throw notFound
  return user
}

export const loadDeletedProject = async (
  id: string,
): Promise<HydratedDocument<ProjectDb>> => {
  const notFound = new HttpError(404, 'not_found', 'Deleted project not found')
  if (!isValidObjectId(id)) throw notFound
  const project = await ProjectModel.findById(id).setOptions({
    withDeleted: true,
  })
  if (!project?.deletedAt) throw notFound
  return project
}

export const loadDeletedDeck = async (
  id: string,
): Promise<HydratedDocument<DeckDb>> => {
  const notFound = new HttpError(404, 'not_found', 'Deleted lecture not found')
  if (!isValidObjectId(id)) throw notFound
  const deck = await DeckModel.findById(id).setOptions({ withDeleted: true })
  if (!deck?.deletedAt) throw notFound
  return deck
}

/** The acting admin, guaranteed by requireAdmin on the admin router. */
export const actor = (req: { adminUser?: { id: string; email: string } }) => {
  const admin = req.adminUser
  if (!admin) throw new HttpError(403, 'forbidden', 'Admin access required')
  return admin
}

/** Admin accounts moderate; they are not moderated. Deleting, banning,
 * resetting, or editing the settings of an allowlisted account (including
 * yourself) — or of a project/lecture an allowlisted account OWNS — is
 * refused; it would be a lockout, not moderation. */
export const rejectAdminTarget = (email: string) => {
  if (isAdminEmail(email)) {
    throw new HttpError(
      400,
      'target_is_admin',
      'Admin accounts cannot be moderated; remove the email from ADMIN_EMAILS first',
    )
  }
}
