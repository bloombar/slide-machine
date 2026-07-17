/**
 * Server configuration (SPEC TECH-4). Loads .env via dotenv, validates
 * process.env with zod, and fails fast on missing or invalid values so
 * misconfiguration is caught at boot, never mid-request.
 *
 * Only the variables the walking skeleton needs are required today;
 * feature-specific keys are declared optional and flip to required as
 * their features land. See server/.env.example for the full list.
 */
import 'dotenv/config'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

/**
 * Finds the server package root by walking up to the nearest package.json.
 * Works from both src/ (tsx dev) and the bundled dist/ output, whose
 * directory depths differ.
 */
const findServerRoot = (startDir: string): string => {
  let dir = startDir
  while (!existsSync(path.join(dir, 'package.json'))) {
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error('Could not locate server package root')
    dir = parent
  }
  return dir
}

const serverRoot = findServerRoot(path.dirname(fileURLToPath(import.meta.url)))

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  // Database
  MONGODB_URI: z.string().min(1),

  // Paths (defaults resolve relative to the repo layout; Docker overrides them)
  CLIENT_DIST: z
    .string()
    .default(path.join(serverRoot, '..', 'client', 'dist')),
  PLANS_CONFIG_PATH: z
    .string()
    .default(path.join(serverRoot, '..', 'config', 'plans.json')),
  /** Externalized prompt templates (docs/GENERATION_PROMPT.md). */
  PROMPTS_DIR: z
    .string()
    .default(path.join(serverRoot, '..', 'config', 'prompts')),
  /** Starter slide templates, one JSON per template (docs/TEMPLATES.md). */
  TEMPLATES_DIR: z
    .string()
    .default(path.join(serverRoot, 'config', 'templates')),

  // Active transcription adapter (SPEC TECH-8) — also drives the client STT
  // engine via GET /api/config, so one server flip switches the whole app
  // (no client rebuild). 'browser' = keyless Web Speech API, 'none' = typed
  // Speak bar only; any other name ('google-cloud', 'mock', …) streams audio
  // to that server-side adapter.
  TRANSCRIPTION_PROVIDER: z.string().default('browser'),
  GENERATION_PROVIDER: z.string().default('gemini'),
  QUIZ_PROVIDER: z.string().default('gemini'),
  IMAGE_GEN_PROVIDER: z.string().default('gemini'),

  // Image enrichment (IMG-1): background stock-image fetch for slides
  IMAGE_ENRICHMENT_ENABLED: z.stringbool().default(true),

  // Billing (SPEC TECH-9)
  BILLING_PROVIDER: z.string().default('stripe'),

  // Auth (AUTH-1/2): signing secrets are required; TTLs are tunable
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(2592000),
  // How long a rotated-out refresh token stays valid (two-tab race window)
  REFRESH_GRACE_SECONDS: z.coerce.number().int().nonnegative().default(60),

  // Secrets & service credentials — optional until their features land
  GEMINI_API_KEY: z.string().optional(),
  // Chosen for phrase-to-slide latency: ~1s, no thinking overhead
  // (thinking models measured 10-30s; see docs/DECISIONS.md)
  GEMINI_MODEL: z.string().default('gemini-3.1-flash-lite-preview'),
  // AI content freedom 1-5: 1 = slides contain only what the speaker
  // said; 5 = free elaboration. Projects/lectures can override.
  GENERATION_FREEDOM: z.coerce.number().int().min(1).max(5).default(2),
  // Debug: dump each assembled prompt and raw model response to the
  // server log. Prompts include seed material — dev use only.
  GENERATION_LOG_PROMPTS: z.stringbool().default(false),
  // Experimental: offer the CAP-4 voice-command set to the generation
  // model so plain lecture speech (no wake word) can trigger commands
  // like next/previous slide. Off by default — a misread phrase becomes
  // a surprise navigation, so this stays an easy on/off switch.
  GENERATION_VOICE_COMMANDS: z.stringbool().default(false),
  // GEN-8 layout re-fit: the model may switch an updated slide's layout
  // (e.g. promote content → list as material grows), including a full
  // slot re-map ("refit"). On by default; flip off to pin every slide's
  // layout from its creation.
  GENERATION_LAYOUT_REFIT: z.stringbool().default(true),
  /** Hard cap on one generation call — phrase-to-slide must stay live. */
  GEMINI_TIMEOUT_MS: z.coerce.number().default(12_000),
  // Service-account JSON for Cloud Speech-to-Text streaming (real-time STT).
  // Relative values resolve against the server package root so a bare
  // filename dropped in server/ works. Streaming needs a service account,
  // not an API key — see docs/GOOGLE_API_KEYS.md.
  GOOGLE_APPLICATION_CREDENTIALS: z
    .string()
    .transform(value => path.resolve(serverRoot, value))
    .optional(),
  GOOGLE_CLOUD_TRANSLATION_KEY: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  // Public origin the app is reached at, used to build the Google OAuth
  // redirect URI (docs/GOOGLE_SIGN_IN.md). Must match a redirect URI
  // registered in the Cloud Console byte-for-byte. Absent = derive from
  // the incoming request, which is right for localhost dev.
  PUBLIC_BASE_URL: z.string().optional(),
  GITHUB_OAUTH_CLIENT_ID: z.string().optional(),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().optional(),
  CONNECTED_ACCOUNT_TOKEN_ENC_KEY: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  FLICKR_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  // Uploaded-file storage: 'local' (disk, dev/test default) or 's3'
  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('.uploads'),

  // S3-compatible object storage: MinIO in dev, DO Spaces in prod (TECH-10)
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  // Path-style addressing is required for MinIO; virtual-hosted for Spaces
  S3_FORCE_PATH_STYLE: z.stringbool().default(false),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_PUBLIC_BASE_URL: z.string().optional(),
})

export type Env = z.infer<typeof envSchema>

/**
 * Parses and validates an environment map. Exported separately from the
 * singleton so tests can exercise validation without touching process.env.
 */
export const parseEnv = (source: Record<string, string | undefined>): Env => {
  const result = envSchema.safeParse(source)
  if (!result.success) {
    const details = result.error.issues
      .map(issue => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    console.error(`Invalid server configuration:\n${details}`)
    process.exit(1)
  }
  return Object.freeze(result.data)
}

/** Validated, frozen server configuration. Import this everywhere. */
export const env = parseEnv(process.env)
