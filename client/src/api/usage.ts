/**
 * The signed-in account's metered usage (SPEC BILL-4). One call behind both
 * views — the home-page notice and the account-settings panel — so they can
 * never disagree about what a user has spent.
 */
import type { UsageSummaryResponse } from '@slide-machine/shared'
import { dispatchAction } from './actions'

export const fetchUsage = (): Promise<UsageSummaryResponse> =>
  dispatchAction<UsageSummaryResponse>('user.usage')
