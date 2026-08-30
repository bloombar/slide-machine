/**
 * A short-lived Drive access token for Google's Picker (EXP-4).
 *
 * The Picker runs in the browser and needs an OAuth token of its own —
 * everything else in this app reads Drive server-side from the stored refresh
 * token, so there is nothing for the page to send. This mints one from that
 * same stored grant and hands it over.
 *
 * What is handed over is the user's own token, carrying the app's single
 * `drive.file` scope: it can reach files this app created and files that same
 * user picks, and nothing else in their Drive. It is minted per open and
 * expires on Google's own schedule (about an hour), and it is never stored by
 * the client.
 */
import { z } from 'zod'
import { defineAction } from './define'
import {
  requiresGoogleDrive,
  signedIn,
  type Signed,
  type WithGoogle,
} from './access'
import { registerAction } from './dispatch'
import { accessTokenFor } from '../auth/google-connect'
import { decryptToken } from '../lib/token-crypto'
import { googleLive } from '../lib/export-mode'
import { HttpError } from '../middleware/error'

export const drivePickerToken = defineAction<
  Record<string, never>,
  { accessToken: string },
  WithGoogle<Signed>
>({
  name: 'drive.pickerToken',
  // The same grant, and the same surface, as the saves and imports this token
  // is opened in service of.
  access: requiresGoogleDrive(signedIn(), 'export'),
  input: z.object({}).strict(),
  execute: async (_ctx, _input, { googleUser: user }) => {
    // Mock mode has no Google to mint against, and its client draws its own
    // dialog rather than the Picker — so a request here is a client that took
    // the wrong branch, and saying so beats returning a token-shaped lie.
    if (!googleLive()) {
      throw new HttpError(
        400,
        'drive_picker_unavailable',
        'The Google Picker is not used in mock mode',
      )
    }
    return {
      accessToken: await accessTokenFor(
        decryptToken(user.googleQuizRefreshToken!),
      ),
    }
  },
})

registerAction(drivePickerToken)
