/**
 * The `test` every spec imports, instead of Playwright's own.
 *
 * A signed-in account that has never said what it is gets asked once, in a
 * modal that nothing dismisses but an answer (AUTH-6). That is the point of
 * it — the answer chooses the privacy defaults the account's work starts
 * from, so it has to land before the account creates anything — but it also
 * means every spec that signs in would otherwise stall on a dialog it is
 * not about.
 *
 * So the `page` fixture answers it: "Educator", which is the public default
 * every other spec here already assumes. Playwright's locator handler runs
 * only when the dialog is actually up and in the way, so a spec that never
 * signs in never sees it, and account-type.spec.ts — which imports
 * Playwright's own `test` — is left to drive the prompt itself.
 *
 * Pages a spec opens for itself (a second user, an anonymous visitor) are
 * not this fixture's `page`; those call `autoAnswerAccountType` directly.
 */
import { test as base, type Page } from '@playwright/test'

export {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test'

/**
 * Answers the account-type prompt on `page` whenever it appears and blocks
 * an action. Safe to install on a page that never shows it.
 *
 * Matched by test id rather than by its words: the app follows the
 * browser's language (TECH-12), and i18n.spec runs in French, where the
 * English copy this would otherwise look for is nowhere on the page.
 */
export async function autoAnswerAccountType(page: Page): Promise<void> {
  await page.addLocatorHandler(
    page.getByTestId('account-type-prompt'),
    async () => {
      await page.locator('[data-account-type="educator"]').click()
    },
  )
}

export const test = base.extend({
  page: async ({ page }, use) => {
    await autoAnswerAccountType(page)
    await use(page)
  },
})
