/**
 * Health aggregation for GET /api/health. Runs every component probe in
 * parallel, each bounded by a short timeout so a hung dependency can never
 * stall the endpoint, and caches the result briefly so the footer badge
 * (polled from every page) never hammers the paid AI APIs.
 *
 * The overall status is the compact summary; `components` is the per-service
 * breakdown the badge reveals when expanded. Mongo is the only critical
 * component — its loss reads as `down`; any other outage is `degraded`.
 */
import type {
  ComponentStatus,
  HealthComponent,
  HealthComponents,
  HealthResponse,
} from '@slide-machine/shared'
import { env } from '../config/env'
import { pingMongo } from '../db/mongoose'
import { getStorage } from '../storage'
import { pingGemini } from '../providers/gemini-generation'
import { pingGoogleStt } from '../providers/google-cloud-transcription'
import { APP_VERSION } from './app-version'

/** Per-probe deadline; the badge must never wait on a slow dependency. */
const CHECK_TIMEOUT_MS = 2000
/** How long a component snapshot is reused before re-probing. */
const CACHE_TTL_MS = 45_000

/** Races a probe against a timeout; a hung or throwing probe reads as down. */
const withTimeout = (
  probe: Promise<HealthComponent>,
): Promise<HealthComponent> => {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<HealthComponent>(resolve => {
    timer = setTimeout(
      () => resolve({ status: 'down', detail: 'timeout' }),
      CHECK_TIMEOUT_MS,
    )
  })
  const guarded = probe.catch((): HealthComponent => ({
    status: 'down',
    detail: 'error',
  }))
  return Promise.race([guarded, timeout]).finally(() => clearTimeout(timer))
}

/** Adapts the boolean Mongo ping to a component result. */
const mongoComponent = async (): Promise<HealthComponent> =>
  (await pingMongo())
    ? { status: 'ok', detail: 'connected' }
    : { status: 'down', detail: 'disconnected' }

/** Probes all components concurrently. */
const runChecks = async (): Promise<HealthComponents> => {
  const [mongo, storage, gemini, stt] = await Promise.all([
    withTimeout(mongoComponent()),
    withTimeout(getStorage().healthCheck()),
    withTimeout(pingGemini()),
    withTimeout(pingGoogleStt()),
  ])
  return { mongo, storage, gemini, stt }
}

let cache: { at: number; components: HealthComponents } | null = null

/** Returns cached component results, re-probing once the TTL lapses. */
const getComponents = async (): Promise<HealthComponents> => {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.components
  const components = await runChecks()
  cache = { at: now, components }
  return components
}

/** Clears the component cache — for tests that assert re-probing. */
export const resetHealthCache = (): void => {
  cache = null
}

/**
 * Overall summary: `down` when the core (Mongo) is unreachable; `degraded`
 * when any non-disabled component is down/degraded; else `ok`. Disabled
 * components (inactive providers) never count against health.
 */
export const computeOverall = (
  c: HealthComponents,
): HealthResponse['status'] => {
  if (c.mongo.status === 'down') return 'down'
  const problematic: ComponentStatus[] = ['down', 'degraded']
  const anyProblem = Object.values(c).some(comp =>
    problematic.includes(comp.status),
  )
  return anyProblem ? 'degraded' : 'ok'
}

/** Builds the full health response (cheap fields fresh, probes cached). */
export const getHealth = async (): Promise<HealthResponse> => {
  const components = await getComponents()
  return {
    status: computeOverall(components),
    environment: env.NODE_ENV,
    version: APP_VERSION,
    uptime: process.uptime(),
    components,
  }
}
