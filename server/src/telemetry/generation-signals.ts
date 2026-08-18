/**
 * Ambient generation signals for telemetry (SPEC EVAL-1).
 *
 * The generation adapter knows when the model refused a specialized slot —
 * answered prose where code or maths belonged — but the adapter interface has
 * no channel for operational side-facts, and widening it for one counter
 * would touch every provider. Instead the phrase pipeline opens a scope, the
 * adapter notes refusals into it if one is open, and callers outside any
 * scope (imports, reformats, tests) hit a no-op.
 *
 * Same AsyncLocalStorage pattern as billing's usage attribution.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

const store = new AsyncLocalStorage<{ refusals: number }>()

/** Called by generation adapters on a specialized re-ask; no-op outside a scope. */
export const noteGenerationRefusal = (count = 1): void => {
  const signals = store.getStore()
  if (signals) signals.refusals += count
}

/** Runs `fn` in a signal scope and returns its result with the tally. */
export const withGenerationSignals = async <T>(
  fn: () => Promise<T>,
): Promise<{ result: T; refusals: number }> => {
  const signals = { refusals: 0 }
  const result = await store.run(signals, fn)
  return { result, refusals: signals.refusals }
}
