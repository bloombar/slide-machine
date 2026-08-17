/**
 * The `test` every spec imports, instead of Playwright's own.
 *
 * It once answered a modal: a signed-in account that had never said what it
 * was got asked, in a dialog nothing dismissed but an answer, and every spec
 * that signed in would otherwise have stalled on a question it was not
 * about. The account type is a plain profile field again and nothing blocks
 * a signed-in account, so this is Playwright's own `test` — kept as the
 * single import every spec already uses, which is where the next fixture
 * will go.
 */
export { test } from '@playwright/test'

export {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test'
