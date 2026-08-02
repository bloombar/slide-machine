/**
 * Subscription plan tiers and usage caps (SPEC BILL-1/BILL-3/BILL-6).
 * The concrete values live in config/plans.json so pricing and caps can be
 * tuned without a code change; the per-unit vendor prices those caps were
 * derived from live in config/service-prices.json (docs/BILLING_COST_MODEL.md
 * shows the arithmetic).
 */
export const PLAN_TIERS = ['free', 'fresh', 'pro', 'max'] as const

export type PlanTier = (typeof PLAN_TIERS)[number]

/**
 * Metered resources subject to per-tier caps (BILL-3). `null` means unlimited
 * and `0` means the capability is unavailable — but **no shipped tier uses
 * `0`**: every plan offers every service and they differ only in allowance
 * (BILL-1). The sentinel stays because a deployment may want to switch a
 * service off entirely, and because "unavailable" and "exhausted" have to read
 * differently to whoever is blocked.
 *
 * Metrics are provider-neutral on purpose — `aiTokens`, not `geminiTokens` —
 * so swapping an adapter (TECH-8) never renames a persisted metric.
 *
 * All but one are per-period counters. `audioStorageMb` is a **gauge**: bytes
 * currently held, checked when something is written, never reset by a period
 * boundary.
 */
export interface PlanCaps {
  /** Input + output tokens across every LLM call: generation, refine,
   * narrate, reformat, quiz, image re-rank, seed extraction, embeddings. */
  aiTokens: number | null
  /** Minutes streamed to cloud speech-to-text, summed across stream restarts.
   * Includes post-lecture re-transcription, which is streaming-priced. */
  sttMinutes: number | null
  /** Minutes submitted to batch diarization. */
  diarizationMinutes: number | null
  /** Characters synthesized on a cache miss with a standard voice. */
  ttsCharacters: number | null
  /** Characters synthesized on a cache miss with a premium voice. */
  ttsPremiumCharacters: number | null
  /** AI-generated images (IMG-4). */
  aiImages: number | null
  /** Image-enrichment attempts — one per slide image resolved, not one per
   * provider HTTP request. */
  imageLookups: number | null
  /** Megabytes of seed documents accepted for extraction. */
  importMb: number | null
  /** Export operations: download, export to Drive, quiz publish. */
  exports: number | null
  /** Source characters translated at the owner's own request (SHARE-2). */
  translationCharacters: number | null
  /** Megabytes of retained lecture audio held at once — a stock, not a flow. */
  audioStorageMb: number | null
  /** Synthesis triggered by a viewer: first playback of an un-narrated slide,
   * or narration of a viewer-requested translation. Kept separate from the
   * owner's own budget so a popular deck cannot block its author's work. */
  audienceTtsCharacters: number | null
  /** New (deck, locale) translations a viewer causes to be created. */
  audienceLocales: number | null
}

export interface PlanDefinition {
  /** Billing-provider price id; null for the free tier. */
  priceId: string | null
  caps: PlanCaps
  /** Days retained lecture audio is kept before the sweep deletes it; null
   * keeps it indefinitely, bounded only by `caps.audioStorageMb`. A policy
   * rather than a meter, so it sits beside the caps.
   *
   * Note the sentinel differs from the deployment-wide `AUDIO_RETENTION_DAYS`
   * env var, where `0` means "keep forever" (docs/DECISIONS.md). */
  audioRetentionDays: number | null
}

export type PlansConfig = Record<PlanTier, PlanDefinition>

export type UsageMetric = keyof PlanCaps
