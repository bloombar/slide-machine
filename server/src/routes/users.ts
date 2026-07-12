/**
 * Public profile route (SHARE-1 / AUTH-5): GET /api/users/:id. Private
 * profiles resolve only for their owner (optional auth); missing and
 * private both read as 404 so existence never leaks. The body lists the
 * user's lectures the requester can view, grouped by project — projects
 * with nothing visible are omitted, and seed notes never leave the API.
 */
import { Router, type NextFunction, type Request, type Response } from 'express'
import { isValidObjectId } from 'mongoose'
import type { Deck, ProfileResponse } from '@slide-machine/shared'
import { UserModel, toPublicUserDto } from '../models/user'
import { ProjectModel } from '../models/project'
import {
  DeckModel,
  loadDeckAcls,
  toSharedDeckDto,
  toDeckDto,
} from '../models/deck'
import { canViewAcl } from '../lib/access'
import { verifyAccessToken } from '../auth/tokens'
import { HttpError } from '../middleware/error'

/** Attaches userId when a valid Bearer token is present; never rejects. */
const optionalAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) {
    try {
      req.userId = (
        await verifyAccessToken(header.slice('Bearer '.length))
      ).userId
    } catch {
      // Anonymous access is fine here; invalid tokens are simply ignored
    }
  }
  next()
}

export const usersRouter = Router()

usersRouter.get('/users/:id', optionalAuth, async (req, res) => {
  const notFound = new HttpError(404, 'not_found', 'Profile not found')
  const id = String(req.params.id)
  if (!isValidObjectId(id)) throw notFound

  const user = await UserModel.findById(id)
  if (!user) throw notFound
  const isSelf = req.userId === id
  if (user.profileVisibility === 'private' && !isSelf) throw notFound

  const [projects, decks] = await Promise.all([
    ProjectModel.find({ ownerId: id }),
    DeckModel.find({ ownerId: id }).sort({ updatedAt: -1 }),
  ])
  const acls = await loadDeckAcls(decks)
  const visible = decks.filter(deck =>
    canViewAcl(acls.get(deck._id.toString())!, req.userId),
  )
  const byProject = new Map<string, Deck[]>()
  for (const deck of visible) {
    const acl = acls.get(deck._id.toString())!
    const dto = isSelf ? toDeckDto(deck, acl) : toSharedDeckDto(deck, acl)
    const list = byProject.get(dto.projectId) ?? []
    list.push(dto)
    byProject.set(dto.projectId, list)
  }

  const grouped: ProfileResponse['projects'] = projects
    .filter(project => byProject.has(project._id.toString()))
    .map(project => ({
      project: {
        id: project._id.toString(),
        title: project.title,
        course: project.course,
        description: project.description,
      },
      decks: byProject.get(project._id.toString())!,
    }))

  // Decks owned here but living in someone else's project (ownership
  // was transferred in) still deserve a home on the page
  const ownProjectIds = new Set(projects.map(p => p._id.toString()))
  const other = [...byProject.entries()]
    .filter(([projectId]) => !ownProjectIds.has(projectId))
    .flatMap(([, list]) => list)
  if (other.length > 0) {
    grouped.push({
      project: { id: 'other', title: 'Other lectures' },
      decks: other,
    })
  }

  const body: ProfileResponse = {
    user: toPublicUserDto(user),
    projects: grouped,
  }
  res.json(body)
})
