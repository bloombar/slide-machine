/**
 * Vitest setup: registers jest-dom matchers and unmounts rendered
 * components between tests (auto-cleanup needs globals, which we keep off).
 */
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(cleanup)

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
