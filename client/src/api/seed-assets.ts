/**
 * Seed-material API (SEED-1/SEED-2): multipart upload plus thin
 * wrappers over the seedAsset actions.
 */
import type { SeedAsset } from '@slide-machine/shared'
import { apiFetch } from './http'
import { dispatchAction } from './actions'

/** Uploads one file to a project or lecture; returns the processing asset. */
export const uploadSeedAsset = (
  file: File,
  level: { projectId: string; deckId?: string },
): Promise<SeedAsset> => {
  const form = new FormData()
  form.append('file', file)
  form.append('projectId', level.projectId)
  if (level.deckId) form.append('deckId', level.deckId)
  return apiFetch<SeedAsset>('/api/seed-assets', {
    method: 'POST',
    body: form,
  })
}

export const listSeedAssets = (level: {
  projectId?: string
  deckId?: string
}): Promise<SeedAsset[]> => dispatchAction<SeedAsset[]>('seedAsset.list', level)

export const updateSeedAsset = (input: {
  assetId: string
  caption?: string
  enabled?: boolean
}): Promise<SeedAsset> => dispatchAction<SeedAsset>('seedAsset.update', input)

export const deleteSeedAsset = (assetId: string): Promise<void> =>
  dispatchAction('seedAsset.delete', { assetId }).then(() => undefined)
