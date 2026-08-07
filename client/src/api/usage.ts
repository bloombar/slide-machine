/**
 * The signed-in account's metered usage (SPEC BILL-4). One call behind both
 * views — the home-page notice and the account-settings panel — so they can
 * never disagree about what a user has spent.
 */
import type { SafeUser, UsageSummaryResponse } from '@slide-machine/shared'
import { dispatchAction } from './actions'

export const fetchUsage = (): Promise<UsageSummaryResponse> =>
  dispatchAction<UsageSummaryResponse>('user.usage')

/** Turns the advisory "you are close to a limit" email on or off (BILL-8).
 * Returns the updated account, so the caller can refresh what it holds. */
export const setCapWarnings = (enabled: boolean): Promise<SafeUser> =>
  dispatchAction<SafeUser>('user.setCapWarnings', { enabled })
