/**
 * The mock Drive the import picker browses when there is no Google to ask
 * (EXP-3/EXP-4).
 *
 * Live, the user chooses in Google's own Picker: the app holds only
 * `drive.file`, which cannot list somebody's Drive, and the pick is what
 * grants access to the one file they chose. That happens entirely in the
 * browser, so no action here is involved.
 *
 * A dev machine and the test suite have no Picker and no credentials, so the
 * client falls back to a finder-style dialog over the tree below — the same
 * mock every other Google surface here has, for the same reason: the whole
 * flow can be exercised without talking to Google.
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
import { googleLive } from '../lib/export-mode'
import { HttpError } from '../middleware/error'

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
  execute: async (_ctx, input) => {
    // Refused rather than answered with fiction: a live deployment that
    // reached this call has a client that failed to open Google's Picker, and
    // handing it a fabricated tree would present files that do not exist.
    if (googleLive()) {
      throw new HttpError(
        400,
        'drive_picker_required',
        'Live Drive browsing is done in the Google Picker',
      )
    }
    return mockTree[input.parentId ?? 'root'] ?? { folders: [], files: [] }
  },
})

registerAction(driveImportables)
