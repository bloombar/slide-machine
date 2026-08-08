/**
 * Access policies for seed material (SPEC TECH-14).
 *
 * Seed assets hang off either a lecture or a project, and which one is not a
 * property of the action — it is a property of the asset. So the resource
 * type is chosen at run time, and the level that admitted the caller is
 * reported back rather than left for `execute` to guess.
 */
import { SeedAssetModel } from '../../models/seed-asset'
import { DeckModel, loadDeckAcl } from '../../models/deck'
import { ProjectModel, projectAcl } from '../../models/project'
import { canEditAcl } from '../../lib/access'
import { ActionForbiddenError } from '../dispatch'
import { definePolicy, type AccessPolicy } from './policy'
import { requireUser } from './common'
import type { SeedAssetAccess, SeedAssetLevel } from './types'

/**
 * The level an asset lives at, gated for editing. A lecture id wins when one
 * is given — an asset attached to a lecture is that lecture's, whatever
 * project it sits in.
 */
const editableLevel = async (
  userId: string,
  projectId: string | undefined,
  deckId: string | undefined,
): Promise<SeedAssetLevel> => {
  if (deckId) {
    const deck = await DeckModel.findById(deckId).catch(() => null)
    if (!deck) throw new ActionForbiddenError()
    const acl = await loadDeckAcl(deck)
    if (!canEditAcl(acl, userId)) throw new ActionForbiddenError()
    return { kind: 'deck', deck, acl }
  }
  const project = await ProjectModel.findById(projectId).catch(() => null)
  if (!project) throw new ActionForbiddenError()
  const acl = projectAcl(project)
  if (!canEditAcl(acl, userId)) throw new ActionForbiddenError()
  return { kind: 'project', project, acl }
}

/** Assets named by the level they belong to — seedAsset.list. */
export const seedAssetLevel = <
  I extends { projectId?: string; deckId?: string },
>(): AccessPolicy<I, { userId: string; level: SeedAssetLevel }> =>
  definePolicy({ resource: 'seedAsset', level: 'edit' }, async (ctx, input) => {
    const userId = requireUser(ctx)
    return {
      userId,
      level: await editableLevel(userId, input.projectId, input.deckId),
    }
  })

/** One asset by id, gated at whichever level it hangs off. */
export const seedAssetEditor = <I extends { assetId: string }>(): AccessPolicy<
  I,
  SeedAssetAccess
> =>
  definePolicy({ resource: 'seedAsset', level: 'edit' }, async (ctx, input) => {
    const userId = requireUser(ctx)
    const asset = await SeedAssetModel.findById(input.assetId).catch(() => null)
    if (!asset) throw new ActionForbiddenError()
    const level = await editableLevel(
      userId,
      asset.projectId.toString(),
      asset.deckId?.toString(),
    )
    return { userId, asset, level }
  })
