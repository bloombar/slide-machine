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
  canViewDeck,
  toSharedDeckDto,
  toDeckDto,
} from '../models/deck'
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
  const visible = decks.filter(deck => canViewDeck(deck, req.userId))
  const byProject = new Map<string, Deck[]>()
  for (const deck of visible) {
    const dto = isSelf ? toDeckDto(deck) : toSharedDeckDto(deck)
    const list = byProject.get(dto.projectId) ?? []
    list.push(dto)
    byProject.set(dto.projectId, list)
  }

  const body: ProfileResponse = {
    user: toPublicUserDto(user),
    projects: projects
      .filter(project => byProject.has(project._id.toString()))
      .map(project => ({
        project: {
          id: project._id.toString(),
          title: project.title,
          course: project.course,
          description: project.description,
        },
        decks: byProject.get(project._id.toString())!,
      })),
  }
  res.json(body)
})
