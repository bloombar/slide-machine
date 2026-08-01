/**
 * Loads and validates the plan-tier definitions from config/plans.json
 * (SPEC BILL-6/TECH-4). Prices and caps are tunable without a code change;
 * validation still fails fast if the file is malformed.
 *
 * Every cap carries a default so adding a metric here does not take the
 * server down on deploy while each environment's plans.json catches up —
 * a missing cap reads as "unlimited", never as a boot failure.
 */
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import type { PlansConfig } from '@slide-machine/shared'
import { env } from './env'

/** A cap: a non-negative integer, or null for unlimited. Absent = unlimited. */
const cap = z.number().int().nonnegative().nullable().default(null)

const capsSchema = z.object({
  aiTokens: cap,
  sttMinutes: cap,
  diarizationMinutes: cap,
  ttsCharacters: cap,
  ttsPremiumCharacters: cap,
  aiImages: cap,
  imageLookups: cap,
  importMb: cap,
  exports: cap,
  translationCharacters: cap,
  audioStorageMb: cap,
  audienceTtsCharacters: cap,
  audienceLocales: cap,
})

const planSchema = z.object({
  priceId: z.string().nullable(),
  caps: capsSchema,
  // Absent means "keep indefinitely", matching the caps' unlimited sentinel.
  audioRetentionDays: z.number().int().nonnegative().nullable().default(null),
})

const plansSchema = z.object({
  free: planSchema,
  fresh: planSchema,
  pro: planSchema,
  max: planSchema,
})

/** Reads and validates the plans config from the given path. */
export const loadPlans = (
  configPath: string = env.PLANS_CONFIG_PATH,
): PlansConfig => {
  const raw = readFileSync(configPath, 'utf8')
  return plansSchema.parse(JSON.parse(raw))
}
