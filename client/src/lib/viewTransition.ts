/**
 * A tiny wrapper over the browser View Transitions API used to animate
 * slide layout changes (GEN-9). A layout switch replaces one layout
 * component's DOM with another, so CSS transitions have nothing to
 * interpolate; the View Transitions API instead snapshots the before/after
 * frames and morphs elements that share a `view-transition-name`.
 */
import { flushSync } from 'react-dom'

/** True when the browser can animate and the user hasn't asked for less. */
const canAnimate = () =>
  typeof document !== 'undefined' &&
  typeof document.startViewTransition === 'function' &&
  !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Applies `update` as an animated view transition, or instantly when the
 * API is unavailable or reduced motion is preferred (the spec's fallback).
 *
 * `beforeCapture` runs synchronously first — committed via `flushSync` so
 * its DOM change lands before the browser snapshots the OLD frame. Layout
 * transitions use it to put the shared-element names on the current layout,
 * so the same names exist in both frames and the browser morphs rather than
 * cross-fades. It is skipped on the instant path, where names do nothing.
 *
 * Both `update` and `beforeCapture` are flushed synchronously so React has
 * committed the DOM by the time the browser captures each frame.
 *
 * Returns a promise that resolves when the transition (or the instant
 * update) has finished, so callers can clean up transition-only state.
 */
export function runViewTransition(
  update: () => void,
  beforeCapture?: () => void,
): Promise<void> {
  if (!canAnimate()) {
    update()
    return Promise.resolve()
  }
  if (beforeCapture) flushSync(beforeCapture)
  return document.startViewTransition(() => flushSync(update)).finished
}
