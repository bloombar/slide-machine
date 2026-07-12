/**
 * Project actions (SPEC PROJ-1/PROJ-2 via TECH-13). The authorize hooks
 * enforce ownership (P-4) — the first real use of the action pipeline.
 * project.delete cascades through decks, slides, and seed material.
 */
import { z } from 'zod'
import type {
  DeckShare,
  Project,
  ProjectCreateInput,
  ProjectDeleteInput,
  ProjectSetAccessInput,
  ProjectShareInput,
  ProjectSharesInput,
  ProjectTransferOwnershipInput,
  ProjectUnshareInput,
  ProjectUpdateInput,
} from '@slide-machine/shared'
import { defineAction } from './define'
import {
  registerAction,
  ActionForbiddenError,
  ActionValidationError,
} from './dispatch'
import type { ActionContext } from './context'
import {
  ProjectModel,
  projectAcl,
  toProjectDto,
  toSharedProjectDto,
  type ProjectDb,
} from '../models/project'
import { UserModel } from '../models/user'
import { canEditAcl, isAclMember } from '../lib/access'
import { sharesOfAcl } from '../lib/shares'
import type { HydratedDocument } from 'mongoose'
import { DeckModel } from '../models/deck'
import { SlideModel } from '../models/slide'
import { SeedAssetModel } from '../models/seed-asset'
import { getStorage } from '../storage'

/** Returns the acting user's id or throws; actions requiring auth start here. */
const requireUser = (ctx: ActionContext): string => {
  if (!ctx.userId) throw new ActionForbiddenError('Sign in to continue')
  return ctx.userId
}

/** Loads a project the acting user may edit (owner or editor). */
const loadEditableProject = async (
  ctx: ActionContext,
  projectId: string,
): Promise<HydratedDocument<ProjectDb>> => {
  const userId = requireUser(ctx)
  const doc = await ProjectModel.findById(projectId).catch(() => null)
  if (!doc || !canEditAcl(projectAcl(doc), userId))
    throw new ActionForbiddenError()
  return doc
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
    const acl = doc ? projectAcl(doc) : null
    // Member-only: 'public' opens the lectures, not the project page
    if (!doc || !acl || !isAclMember(acl, userId))
      throw new ActionForbiddenError()
    if (acl.ownerId === userId) return toProjectDto(doc)
    const dto = toSharedProjectDto(doc)
    // Viewers see the lecture list, not the instructor's prep notes
    if (!canEditAcl(acl, userId)) delete dto.seedContext
    return dto
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
    const doc = await loadEditableProject(ctx, input.projectId)
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

export const projectSetAccess = defineAction<ProjectSetAccessInput, Project>({
  name: 'project.setAccess',
  input: z.object({
    projectId: z.string().min(1),
    visibility: z.enum(['restricted', 'public']),
  }),
  execute: async (ctx, input) => {
    const doc = await loadEditableProject(ctx, input.projectId)
    doc.visibility = input.visibility
    await doc.save()
    return toProjectDto(doc)
  },
})

export const projectShare = defineAction<ProjectShareInput, DeckShare[]>({
  name: 'project.share',
  input: z.object({
    projectId: z.string().min(1),
    email: z.email(),
    role: z.enum(['viewer', 'editor']),
  }),
  execute: async (ctx, input) => {
    const doc = await loadEditableProject(ctx, input.projectId)
    const user = await UserModel.findOne({
      email: input.email.toLowerCase().trim(),
    })
    if (!user) {
      throw new ActionValidationError('project.share', [
        'email: no account with that email',
      ])
    }
    const userId = user._id.toString()
    if (userId === doc.ownerId.toString()) {
      throw new ActionValidationError('project.share', [
        'email: that user owns this project',
      ])
    }
    const list = input.role === 'editor' ? doc.editors : doc.viewers
    if (!list.includes(userId)) list.push(userId)
    // One role per user: granting one revokes the other
    const other = input.role === 'editor' ? doc.viewers : doc.editors
    const index = other.indexOf(userId)
    if (index >= 0) other.splice(index, 1)
    await doc.save()
    return sharesOfAcl(projectAcl(doc))
  },
})

export const projectUnshare = defineAction<ProjectUnshareInput, DeckShare[]>({
  name: 'project.unshare',
  input: z.object({
    projectId: z.string().min(1),
    userId: z.string().min(1),
    role: z.enum(['viewer', 'editor']),
  }),
  execute: async (ctx, input) => {
    const doc = await loadEditableProject(ctx, input.projectId)
    const list = input.role === 'editor' ? doc.editors : doc.viewers
    const index = list.indexOf(input.userId)
    if (index >= 0) {
      list.splice(index, 1)
      await doc.save()
    }
    return sharesOfAcl(projectAcl(doc))
  },
})

export const projectShares = defineAction<ProjectSharesInput, DeckShare[]>({
  name: 'project.shares',
  input: z.object({ projectId: z.string().min(1) }),
  execute: async (ctx, input) =>
    sharesOfAcl(projectAcl(await loadEditableProject(ctx, input.projectId))),
})

export const projectTransferOwnership = defineAction<
  ProjectTransferOwnershipInput,
  Project
>({
  name: 'project.transferOwnership',
  input: z.object({
    projectId: z.string().min(1),
    userId: z.string().min(1),
  }),
  execute: async (ctx, input) => {
    const userId = requireUser(ctx)
    const doc = await ProjectModel.findById(input.projectId).catch(() => null)
    // Owner-only, unlike the rest of access management
    if (!doc || doc.ownerId.toString() !== userId)
      throw new ActionForbiddenError()
    const target = await UserModel.findById(input.userId).catch(() => null)
    if (!target) {
      throw new ActionValidationError('project.transferOwnership', [
        'userId: no such user',
      ])
    }
    const targetId = target._id.toString()
    if (targetId === userId) {
      throw new ActionValidationError('project.transferOwnership', [
        'userId: already the owner',
      ])
    }
    // The new owner leaves the people list; the old owner stays an editor
    doc.viewers = doc.viewers.filter(id => id !== targetId)
    doc.editors = doc.editors.filter(id => id !== targetId)
    if (!doc.editors.includes(userId)) doc.editors.push(userId)
    doc.ownerId = target._id
    await doc.save()
    // The caller is no longer the owner, so share lists stay behind
    return toSharedProjectDto(doc)
  },
})

registerAction(projectCreate)
registerAction(projectList)
registerAction(projectGet)
registerAction(projectUpdate)
registerAction(projectDelete)
registerAction(projectSetAccess)
registerAction(projectShare)
registerAction(projectUnshare)
registerAction(projectShares)
registerAction(projectTransferOwnership)
