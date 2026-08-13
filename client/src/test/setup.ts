/**
 * Vitest setup: registers jest-dom matchers and unmounts rendered
 * components between tests (auto-cleanup needs globals, which we keep off).
 */
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach } from 'vitest'
import { cleanup, configure } from '@testing-library/react'
import { i18n, initI18n } from '../i18n'
import { LOCALE_STORAGE_KEY } from '../i18n/detect'

afterEach(cleanup)

// The i18n singleton and its localStorage key outlive a single test, so a
// spec that switches language would otherwise leave the next one running
// in it. Reset both between tests.
//
// Reset *before* each test as well as after. A language switch is applied by
// an effect reacting to a fetch, so it can land after the previous test's
// cleanup has already run — leaving the singleton in French and the next test
// looking for English labels that are not there. Clearing on the way in makes
// each test's starting language certain rather than dependent on what the last
// one left behind.
// Unconditionally, and after letting anything in flight land. `changeLanguage`
// is async, so a switch a test started can still be pending when it ends: at
// that moment `i18n.language` is STILL 'en', a check short-circuits, and the
// switch lands in the middle of the NEXT test — which then reads French labels
// it never asked for. Waiting a turn first, then setting English whatever the
// singleton currently claims, is what makes that impossible rather than
// unlikely.
const useEnglish = async () => {
  localStorage.removeItem(LOCALE_STORAGE_KEY)
  await new Promise(resolve => setTimeout(resolve, 0))
  await i18n.changeLanguage('en')
}
beforeEach(useEnglish)
afterEach(useEnglish)

// `useTranslation` reads a module-level singleton rather than a provider,
// so initializing it once here translates every rendered component
// without a single render helper having to know about i18n. English is
// bundled eagerly, so this resolves without a network or a chunk load.
await initI18n('en')

// `waitFor` and the `findBy*` queries default to giving up after 1s. That is
// ample on an idle machine but not when several vitest workers share the CPU:
// a test driving a multi-step async chain (play narration, arrow to the next
// slide, await its fetch) would intermittently time out mid-chain, failing a
// different test on each run. These helpers poll and return the moment their
// condition holds, so a longer ceiling costs nothing when the machine is
// quick — it only stops a busy one from being mistaken for a broken one.
configure({ asyncUtilTimeout: 5000 })

// jsdom implements neither ResizeObserver nor a 2D canvas context, both of
// which the whiteboard drawing overlay uses. Stub them globally so any page
// that renders the overlay (e.g. DeckViewerPage) mounts without crashing;
// tests that assert drawing behavior install their own richer stubs.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
// jsdom has no IntersectionObserver either, and it never scrolls, so nothing
// could intersect anyway. This inert stub lets lazy-loading lists mount; their
// tests drive the visible "Load more" button, which does the same work.
if (!('IntersectionObserver' in globalThis)) {
  // Cast because the DOM lib's IntersectionObserver keeps growing fields
  // (scrollMargin, and whatever comes next) that an inert stub has no reason
  // to carry; the four methods below are all any caller here touches.
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  } as unknown as typeof IntersectionObserver
}
// jsdom's getContext logs a "Not implemented" error on every call; a silent
// null-returning stub keeps overlay redraws (which no-op without a context)
// from spamming test output. Tests needing a real context override this.
HTMLCanvasElement.prototype.getContext = (() =>
  null) as HTMLCanvasElement['getContext']
