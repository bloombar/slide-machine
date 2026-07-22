/**
 * Google connect callback (SPEC EXP-4 / QUIZ-4). Google returns here after the
 * instructor grants Forms/Drive access. The signed `state` proves who started
 * the flow (CSRF + identity); we exchange the code for a refresh token, store
 * it encrypted on that user, and send the browser back to where they started.
 * The connect flow itself is kicked off by the quiz.connectGoogle action.
 */
import { Router } from 'express'
import { env } from '../config/env'
import { verifyConnectState, exchangeConnectCode } from '../auth/google-connect'
import { encryptToken } from '../lib/token-crypto'
import { UserModel } from '../models/user'

export const googleConnectRouter = Router()

/** Only redirect back to a localhost origin (dev) or the app's own origin —
 * never an attacker-supplied external URL. */
const safeReturnTo = (returnTo: string): string => {
  const fallback = env.PUBLIC_BASE_URL ?? '/'
  try {
    const url = new URL(returnTo)
    const allowed =
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      (env.PUBLIC_BASE_URL !== undefined &&
        returnTo.startsWith(env.PUBLIC_BASE_URL))
    return allowed ? returnTo : fallback
  } catch {
    return fallback
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
    const refreshToken = await exchangeConnectCode(
      code,
      env.PUBLIC_BASE_URL ?? '',
    )
    await UserModel.updateOne(
      { _id: decoded.userId },
      {
        googleConnected: true,
        googleQuizRefreshToken: encryptToken(refreshToken),
      },
    )
    res.redirect(returnTo)
  } catch {
    // Send them back regardless; the Quiz tab will show still-not-connected.
    res.redirect(returnTo)
  }
})
