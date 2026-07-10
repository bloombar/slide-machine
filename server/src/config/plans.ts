/**
 * Loads and validates the plan-tier definitions from config/plans.json
 * (SPEC BILL-6/TECH-4). Prices and caps are tunable without a code change;
 * validation still fails fast if the file is malformed.
 */
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import type { PlansConfig } from '@slide-machine/shared'
import { env } from './env'

const capsSchema = z.object({
  geminiTokens: z.number().int().nonnegative().nullable(),
  sttMinutes: z.number().int().nonnegative().nullable(),
  imageCalls: z.number().int().nonnegative().nullable(),
  exports: z.number().int().nonnegative().nullable(),
})

const planSchema = z.object({
  priceId: z.string().nullable(),
  caps: capsSchema,
})

const plansSchema = z.object({
  free: planSchema,
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
