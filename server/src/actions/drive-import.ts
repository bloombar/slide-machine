/**
 * Browsing the connected Drive for something to import (EXP-3/EXP-4).
 *
 * Exporting has had a folder picker since QUIZ-2 — you choose where a file
 * goes. Importing is the opposite errand and had only a pasted link, so an
 * instructor who could not remember which of forty decks was the right one
 * had to go and look in another tab. This is the same picker turned around:
 * the same folder navigation, listing the files as well, because here the
 * file IS the answer.
 *
 * Only files an import could actually read are listed — presentations,
 * PowerPoint files, and the YAML this app exports. A folder of PDFs shows its
 * sub-folders and nothing else, which is a truthful "nothing here to import"
 * rather than a list of things that would fail.
 */
import { z } from 'zod'
import type { DriveFolder, DriveImportable } from '@slide-machine/shared'
import { defineAction } from './define'
import {
  requiresGoogleDrive,
  signedIn,
  type Signed,
  type WithGoogle,
} from './access'
import { registerAction } from './dispatch'
import {
  listDriveFoldersLive,
  listDriveImportablesLive,
} from '../lib/quiz-google'
import { decryptToken } from '../lib/token-crypto'
import { isLive } from '../lib/export-mode'

/** A believable Drive for mock mode, so the picker is exercised by the suite
 * and on a machine with no credentials — as every Google surface here is. */
const mockTree: Record<
  string,
  { folders: DriveFolder[]; files: DriveImportable[] }
> = {
  root: {
    folders: [{ id: 'folder-courses', name: 'Courses' }],
    files: [
      {
        id: 'mock-deck-1',
        name: 'Rainwater Harvesting',
        mimeType: 'application/vnd.google-apps.presentation',
      },
    ],
  },
  'folder-courses': {
    folders: [],
    files: [
      {
        id: 'mock-deck-2',
        name: 'Week 1 — Photosynthesis',
        mimeType: 'application/vnd.google-apps.presentation',
      },
      {
        id: 'mock-pptx-1',
        name: 'Seminar slides.pptx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      },
      {
        id: 'mock-yaml-1',
        name: 'classic.template.yaml',
        mimeType: 'application/x-yaml',
      },
    ],
  },
}

export const driveImportables = defineAction<
  { parentId?: string },
  { folders: DriveFolder[]; files: DriveImportable[] },
  WithGoogle<Signed>
>({
  name: 'drive.importables',
  // The same grant the imports themselves need, and the same surface: this is
  // the first step of one of them, not a capability of its own.
  access: requiresGoogleDrive(signedIn(), 'export'),
  input: z.object({ parentId: z.string().optional() }).strict(),
  execute: async (_ctx, input, { googleUser: user }) => {
    const parentId = input.parentId ?? 'root'
    if (!isLive()) return mockTree[parentId] ?? { folders: [], files: [] }

    const refreshToken = decryptToken(user.googleQuizRefreshToken!)
    // Both in one round trip from the caller's point of view: a picker that
    // renders folders, waits, then renders files reads as broken.
    const [folders, files] = await Promise.all([
      listDriveFoldersLive(refreshToken, parentId),
      listDriveImportablesLive(refreshToken, parentId),
    ])
    return { folders, files }
  },
})

registerAction(driveImportables)
