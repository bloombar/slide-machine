/**
 * Whether exports and Drive publishing talk to Google for real.
 *
 * A one-line question that both the export actions and the access policies
 * need to answer, which is why it lives here rather than in either. Asking it
 * from actions/export.ts would make the policy layer import an action module
 * that already imports the policy layer.
 */
import { env } from '../config/env'

/** True when the deployment is configured to reach Google, not a mock. */
export const isLive = (): boolean => env.EXPORT_MODE === 'live'

/**
 * True when *any* Google surface talks to Google for real — exports
 * (EXPORT_MODE) or quiz publishing (QUIZ_PUBLISH_MODE), which are separate
 * switches.
 *
 * The Drive chooser needs this rather than either one alone: it is a single
 * chooser serving both, and if either surface is live the id it returns has to
 * be a real Drive id. A fabricated one would be accepted by the dialog and
 * refused by Google.
 */
export const googleLive = (): boolean =>
  isLive() || env.QUIZ_PUBLISH_MODE === 'live'
