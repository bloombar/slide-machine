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
