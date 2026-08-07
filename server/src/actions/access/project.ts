/**
 * Access policies for actions that operate on a project (SPEC TECH-14).
 *
 * A project's ACL is always its own — unlike a lecture, which may inherit —
 * so these resolve with `projectAcl` and never reach for a parent.
 */
import { ProjectModel, projectAcl } from '../../models/project'
import { canEditAcl, canViewAcl, isAclMember } from '../../lib/access'
import { ActionForbiddenError } from '../dispatch'
import { definePolicy, type AccessPolicy, type PickId } from './policy'
import { requireUser, overrideActor } from './common'
import type { ProjectAccess, ProjectSettingsAccess } from './types'

/** Loads the project named by `pick` and its ACL, or refuses. */
const loadProject = async (
  userId: string,
  projectId: string,
): Promise<ProjectAccess> => {
  const project = await ProjectModel.findById(projectId).catch(() => null)
  if (!project) throw new ActionForbiddenError()
  return { userId, project, acl: projectAcl(project) }
}

/** The owner or an editor. */
export const projectEditor = <I>(
  pick: PickId<I>,
): AccessPolicy<I, ProjectAccess> =>
  definePolicy({ resource: 'project', level: 'edit' }, async (ctx, input) => {
    const access = await loadProject(requireUser(ctx), pick(input))
    if (!canEditAcl(access.acl, access.userId)) throw new ActionForbiddenError()
    return access
  })

/** Anyone who may read it — including anyone at all when it is public. */
export const projectViewer = <I>(
  pick: PickId<I>,
): AccessPolicy<I, ProjectAccess> =>
  definePolicy({ resource: 'project', level: 'view' }, async (ctx, input) => {
    const access = await loadProject(requireUser(ctx), pick(input))
    if (!canViewAcl(access.acl, access.userId)) throw new ActionForbiddenError()
    return access
  })

/**
 * Named on the ACL — owner, editor or listed viewer. Ignores public
 * visibility, which says the CONTENT is readable, not that the project's
 * management data is open to any signed-in stranger.
 */
export const projectMember = <I>(
  pick: PickId<I>,
): AccessPolicy<I, ProjectAccess> =>
  definePolicy({ resource: 'project', level: 'member' }, async (ctx, input) => {
    const access = await loadProject(requireUser(ctx), pick(input))
    if (!isAclMember(access.acl, access.userId))
      throw new ActionForbiddenError()
    return access
  })

/** The owner alone — deleting a project or handing it on. */
export const projectOwner = <I>(
  pick: PickId<I>,
): AccessPolicy<I, ProjectAccess> =>
  definePolicy({ resource: 'project', level: 'own' }, async (ctx, input) => {
    const access = await loadProject(requireUser(ctx), pick(input))
    if (access.acl.ownerId !== access.userId) throw new ActionForbiddenError()
    return access
  })

/** An owner or editor, otherwise an allowlisted admin overriding (ADMIN-5). */
export const projectSettings = <I>(
  pick: PickId<I>,
): AccessPolicy<I, ProjectSettingsAccess> =>
  definePolicy(
    { resource: 'project', level: 'settings' },
    async (ctx, input) => {
      const access = await loadProject(requireUser(ctx), pick(input))
      const admin = canEditAcl(access.acl, access.userId)
        ? null
        : await overrideActor(access.userId, access.acl.ownerId)
      return { ...access, admin }
    },
  )
