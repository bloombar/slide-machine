/**
 * Vitest setup: registers jest-dom matchers and unmounts rendered
 * components between tests (auto-cleanup needs globals, which we keep off).
 */
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup, configure } from '@testing-library/react'

afterEach(cleanup)

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
// jsdom's getContext logs a "Not implemented" error on every call; a silent
// null-returning stub keeps overlay redraws (which no-op without a context)
// from spamming test output. Tests needing a real context override this.
HTMLCanvasElement.prototype.getContext = (() =>
  null) as HTMLCanvasElement['getContext']
