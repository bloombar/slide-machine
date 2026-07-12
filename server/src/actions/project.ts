/**
 * Project actions (SPEC PROJ-1/PROJ-2 via TECH-13). The authorize hooks
 * enforce ownership (P-4) — the first real use of the action pipeline.
 * project.delete cascades through decks, slides, and seed material.
 */
import { z } from 'zod'
import type {
  Project,
  ProjectCreateInput,
  ProjectDeleteInput,
  ProjectUpdateInput,
} from '@slide-machine/shared'
import { defineAction } from './define'
import { registerAction, ActionForbiddenError } from './dispatch'
import type { ActionContext } from './context'
import { ProjectModel, toProjectDto } from '../models/project'
import { DeckModel } from '../models/deck'
import { SlideModel } from '../models/slide'
import { SeedAssetModel } from '../models/seed-asset'
import { getStorage } from '../storage'

/** Returns the acting user's id or throws; actions requiring auth start here. */
const requireUser = (ctx: ActionContext): string => {
  if (!ctx.userId) throw new ActionForbiddenError('Sign in to continue')
  return ctx.userId
}

export const projectCreate = defineAction<ProjectCreateInput, Project>({
  name: 'project.create',
  input: z.object({
    title: z.string().trim().min(1),
    course: z.string().optional(),
    description: z.string().optional(),
    seedContext: z.string().optional(),
  }),
  execute: async (ctx, input) => {
    const doc = await ProjectModel.create({
      ...input,
      ownerId: requireUser(ctx),
    })
    return toProjectDto(doc)
  },
})

export const projectList = defineAction<Record<string, never>, Project[]>({
  name: 'project.list',
  input: z.object({}),
  execute: async ctx => {
    const docs = await ProjectModel.find({ ownerId: requireUser(ctx) }).sort({
      createdAt: -1,
    })
    return docs.map(toProjectDto)
  },
})

export const projectGet = defineAction<{ projectId: string }, Project>({
  name: 'project.get',
  input: z.object({ projectId: z.string().min(1) }),
  execute: async (ctx, input) => {
    const userId = requireUser(ctx)
    const doc = await ProjectModel.findById(input.projectId).catch(() => null)
    if (!doc || doc.ownerId.toString() !== userId)
      throw new ActionForbiddenError()
    return toProjectDto(doc)
  },
})

export const projectUpdate = defineAction<ProjectUpdateInput, Project>({
  name: 'project.update',
  input: z.object({
    projectId: z.string().min(1),
    title: z.string().trim().min(1).optional(),
    course: z.string().optional(),
    description: z.string().optional(),
    seedContext: z.string().max(20_000).optional(),
  }),
  execute: async (ctx, input) => {
    const userId = requireUser(ctx)
    const doc = await ProjectModel.findById(input.projectId).catch(() => null)
    if (!doc || doc.ownerId.toString() !== userId)
      throw new ActionForbiddenError()
    if (input.title !== undefined) doc.title = input.title
    if (input.course !== undefined) doc.course = input.course
    if (input.description !== undefined) doc.description = input.description
    if (input.seedContext !== undefined) doc.seedContext = input.seedContext
    await doc.save()
    return toProjectDto(doc)
  },
})

export const projectDelete = defineAction<
  ProjectDeleteInput,
  { deleted: true }
>({
  name: 'project.delete',
  input: z.object({ projectId: z.string().min(1) }),
  authorize: async (ctx, input) => {
    const userId = requireUser(ctx)
    const doc = await ProjectModel.findById(input.projectId)
    if (!doc || doc.ownerId.toString() !== userId) {
      // Same error for missing and foreign projects: no existence leaks
      throw new ActionForbiddenError()
    }
  },
  execute: async (_ctx, input) => {
    // Cascade: every deck in the project, their slides, all seed
    // material at both levels (including stored files), then the project
    const decks = await DeckModel.find({ projectId: input.projectId })
    const deckIds = decks.map(d => d._id)
    const assets = await SeedAssetModel.find({ projectId: input.projectId })
    const storage = getStorage()
    await Promise.all(
      assets
        .filter(a => a.storageKey)
        .map(a =>
          storage.delete(a.storageKey!).catch(() => {
            // A dangling file is preferable to a failed delete
          }),
        ),
    )
    await Promise.all([
      SlideModel.deleteMany({ deckId: { $in: deckIds } }),
      SeedAssetModel.deleteMany({ projectId: input.projectId }),
      DeckModel.deleteMany({ projectId: input.projectId }),
    ])
    await ProjectModel.deleteOne({ _id: input.projectId })
    return { deleted: true }
  },
})

registerAction(projectCreate)
registerAction(projectList)
registerAction(projectGet)
registerAction(projectUpdate)
registerAction(projectDelete)
