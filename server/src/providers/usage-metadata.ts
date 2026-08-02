/**
 * Gemini's per-response token accounting (SPEC BILL-3). Every
 * `:generateContent` reply carries a `usageMetadata` block; this reads it and
 * meters the total against the caller's allowance.
 *
 * Vendor-shaped on purpose — the field names are Gemini's, so the parsing
 * lives with the other Gemini code and only the metric name crosses into the
 * billing layer (TECH-8 keeps vendor concepts inside the adapter).
 */
import { meterUsage } from '../billing/usage-context'

/** The slice of Gemini's usageMetadata that costs money. */
export interface GeminiUsageMetadata {
  promptTokenCount?: number
  candidatesTokenCount?: number
  /** Thinking models bill these at the output rate; absent on models without
   * a thinking budget. Counted so a switch to one cannot spend silently. */
  thoughtsTokenCount?: number
  totalTokenCount?: number
}

/**
 * Total billable tokens in a response. Prefers Gemini's own `totalTokenCount`
 * and falls back to summing the parts, so a response that reports only the
 * breakdown still counts.
 */
export const totalTokens = (usage?: GeminiUsageMetadata): number => {
  if (!usage) return 0
  if (typeof usage.totalTokenCount === 'number') return usage.totalTokenCount
  return (
    (usage.promptTokenCount ?? 0) +
    (usage.candidatesTokenCount ?? 0) +
    (usage.thoughtsTokenCount ?? 0)
  )
}

/**
 * Meters a Gemini response's tokens against the ambient user. Safe to call
 * from anywhere: outside a usage context it is a no-op, and a response with no
 * usage block counts nothing rather than guessing.
 */
export const meterGeminiUsage = async (
  usage?: GeminiUsageMetadata,
): Promise<void> => {
  await meterUsage('aiTokens', totalTokens(usage))
}
