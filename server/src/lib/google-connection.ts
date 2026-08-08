/**
 * Whether an account can reach a given Google surface.
 *
 * Publishing quizzes and exporting to Drive go live independently
 * (QUIZ_PUBLISH_MODE and EXPORT_MODE), so a deployment can run one against
 * Google and the other against a mock. The two connection checks that used to
 * live in the action files looked like copies of each other and were not —
 * each consulted its own switch — so naming the surface is what keeps them
 * apart.
 *
 * A pure predicate over env and a plain object, deliberately: it pulls in no
 * model, which is what lets it be tested against several configurations in
 * one run.
 */
import { env } from '../config/env'

/** Which switch decides whether a real grant is required. */
export type GoogleSurface = 'quiz' | 'export'

const isLiveFor = (surface: GoogleSurface): boolean =>
  surface === 'quiz'
    ? env.QUIZ_PUBLISH_MODE === 'live'
    : env.EXPORT_MODE === 'live'

/**
 * Live needs a stored refresh token — the mock-mode `googleConnected` flag
 * must NOT count once switched to live, or the work fails with no real grant
 * behind it.
 */
export const isConnected = (
  user: { googleConnected?: boolean; googleQuizRefreshToken?: string },
  surface: GoogleSurface,
): boolean =>
  isLiveFor(surface)
    ? Boolean(user.googleQuizRefreshToken)
    : Boolean(user.googleConnected)
