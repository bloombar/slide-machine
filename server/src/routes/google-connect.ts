/**
 * Google connect handling (SPEC EXP-4 / QUIZ-4). Google returns here after the
 * instructor grants Forms/Drive access. The signed `state` proves who started
 * the flow (CSRF + identity); we exchange the code for a refresh token, store
 * it encrypted on that user, and send the browser back to where they started.
 * The connect flow itself is kicked off by the quiz.connectGoogle action.
 *
 * The connect uses the SIGN-IN redirect URI (see connectRedirectUri), so the
 * primary entry point is the sign-in callback (routes/auth.ts), which detects
 * a connect state and calls `storeGoogleConnect` below. The dedicated
 * `/google/connect/callback` route here is kept as a fallback in case that URI
 * is ever registered in the Console too.
 */
import { Router } from 'express'
import { env } from '../config/env'
import {
  verifyConnectState,
  exchangeConnectCode,
  grantedDriveAccess,
  type ConnectState,
} from '../auth/google-connect'
import { encryptToken } from '../lib/token-crypto'
import { UserModel } from '../models/user'

export const googleConnectRouter = Router()

/** Only redirect back to a localhost origin (dev only) or the app's own
 * origin — never an attacker-supplied external URL. Exported for the
 * sign-in callback, which shares the connect completion.
 *
 * Compares whole origins, not string prefixes: `startsWith` would have let
 * `https://slides.example.edu.attacker.test/` through when
 * `PUBLIC_BASE_URL=https://slides.example.edu`, handing the freshly
 * signed-in visitor to an attacker's page. */
export const safeReturnTo = (returnTo: string): string => {
  const fallback = env.PUBLIC_BASE_URL ?? '/'
  // A bare same-origin path (one `/`, not `//` or `/\`, both of which a
  // browser resolves as a different origin) can never leave our origin, so
  // it is always safe and needs no URL parsing.
  if (/^\/(?!\/|\\)/.test(returnTo)) return returnTo
  try {
    const target = new URL(returnTo)
    const allowedLocalhost =
      env.NODE_ENV !== 'production' &&
      (target.hostname === 'localhost' || target.hostname === '127.0.0.1')
    const allowedOwnOrigin =
      env.PUBLIC_BASE_URL !== undefined &&
      target.origin === new URL(env.PUBLIC_BASE_URL).origin
    return allowedLocalhost || allowedOwnOrigin ? returnTo : fallback
  } catch {
    // Not a parseable URL (or PUBLIC_BASE_URL isn't) — reject, don't throw.
    return fallback
  }
}

/**
 * Exchanges the authorization code for a refresh token and stores it, encrypted,
 * on the connecting user. Shared by the dedicated connect callback and the
 * sign-in callback (which reuses the same registered redirect URI). Throws on
 * failure so the caller can still redirect the user back.
 *
 * Returns whether Drive access was actually granted. If the user connected but
 * unticked the Drive permissions (Google's granular consent), the token would
 * 403 on every Drive call, so we do NOT record it — any existing good
 * connection is left intact — and report the shortfall so the UI can prompt a
 * reconnect rather than dead-ending in the folder picker.
 */
export const storeGoogleConnect = async (
  code: string,
  decoded: ConnectState,
): Promise<boolean> => {
  const { refreshToken, scope } = await exchangeConnectCode(
    code,
    env.PUBLIC_BASE_URL ?? '',
  )
  if (!grantedDriveAccess(scope)) return false
  await UserModel.updateOne(
    { _id: decoded.userId },
    {
      googleConnected: true,
      googleQuizRefreshToken: encryptToken(refreshToken),
    },
  )
  return true
}

/**
 * The URL to send the browser back to after connect. When Drive access was not
 * granted, a `connect=drive_denied` flag is added so the Quiz/Export tab can
 * explain what happened and offer to reconnect.
 */
export const connectReturnUrl = (
  returnTo: string,
  driveGranted: boolean,
): string => {
  if (driveGranted) return returnTo
  try {
    const url = new URL(returnTo)
    url.searchParams.set('connect', 'drive_denied')
    return url.toString()
  } catch {
    return returnTo
  }
}

googleConnectRouter.get('/google/connect/callback', async (req, res) => {
  const { code, state } = req.query
  let returnTo = env.PUBLIC_BASE_URL ?? '/'
  try {
    if (typeof code !== 'string' || typeof state !== 'string') {
      throw new Error('missing code or state')
    }
    const decoded = await verifyConnectState(state)
    returnTo = safeReturnTo(decoded.returnTo)
    const granted = await storeGoogleConnect(code, decoded)
    res.redirect(connectReturnUrl(returnTo, granted))
  } catch {
    // Send them back regardless; the Quiz tab will show still-not-connected.
    res.redirect(returnTo)
  }
})
