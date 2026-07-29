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
  // Post-lecture speaker diarization (GEN-4 Phase 3): 'none' disables it,
  // 'google-cloud' runs the v2 BatchRecognize job (needs GCS_AUDIO_BUCKET),
  // 'mock' is for tests.
  DIARIZATION_PROVIDER: z.string().default('none'),
  GENERATION_PROVIDER: z.string().default('gemini'),
  QUIZ_PROVIDER: z.string().default('gemini'),
  // How the quiz publishes to Google Forms: 'mock' fabricates a Form URL
  // (tests/dev), 'live' runs the real connected-account + Quiz Generator flow.
  QUIZ_PUBLISH_MODE: z.enum(['mock', 'live']).default('mock'),
  // How a deck exports to Google Drive/Slides: 'mock' fabricates a file URL
  // (tests/dev), 'live' uploads to the connected account's Drive and builds a
  // real Google Slides presentation. Downloads (PDF/YAML bytes) work in both.
  EXPORT_MODE: z.enum(['mock', 'live']).default('mock'),
  IMAGE_GEN_PROVIDER: z.string().default('gemini'),
  // Text-to-speech (slide/deck playback). 'google-cloud' needs a key below;
  // 'none' disables the feature; 'mock' is for tests. Without a usable key the
  // client hides the play button and the per-slide "Speak this slide" option.
  TTS_PROVIDER: z.string().default('google-cloud'),

  // Image enrichment (IMG-1): background stock-image fetch for slides
  IMAGE_ENRICHMENT_ENABLED: z.stringbool().default(true),
  // How many results each source (Wikimedia/Openverse/Flickr) returns per query.
  IMAGE_SOURCE_RESULTS: z.coerce.number().int().positive().default(8),
  // Most keyword phrases fanned out per search (each fires all sources).
  IMAGE_MAX_QUERY_PHRASES: z.coerce.number().int().positive().default(6),
  // AI re-rank (IMG-1): after gathering candidates, Gemini picks the best match
  // for the slide and rewrites its caption to match. Shortlist bounds how many
  // top-scored candidates are handed to the model.
  IMAGE_RERANK_ENABLED: z.stringbool().default(true),
  IMAGE_RERANK_SHORTLIST: z.coerce.number().int().positive().default(12),
  // Vision mode: also send candidate thumbnails so the model judges visually.
  // Slower (image fetches + multimodal payload) — off by default; metadata-only
  // text re-rank still runs when this is off.
  IMAGE_RERANK_VISION: z.stringbool().default(false),
  // Hard cap on the re-rank call — enrichment must land inside the client poll.
  IMAGE_RERANK_TIMEOUT_MS: z.coerce.number().default(6000),

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
  // Embedding model for semantic phrase re-anchoring of whiteboard marks on
  // transcript refine (WB-2). Same Gemini API key/base as generation.
  GEMINI_EMBED_MODEL: z.string().default('text-embedding-004'),
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
  // Live rephrasing: allow a "refit" that KEEPS the layout but re-states the
  // current slide's existing content when a clearer phrasing improves it (as
  // opposed to a refit that changes the layout as content grows). On by
  // default; flip off to keep committed slide text verbatim during a lecture.
  // Only in effect while GENERATION_LAYOUT_REFIT is on (refit is the vehicle).
  GENERATION_LIVE_REPHRASE: z.stringbool().default(true),
  // Deck-structure context: send the running outline of heading (title/section)
  // slides plus positional signals — and the matching heading-decision
  // instructions — so the windowed model can judge title/section slides from
  // the deck's structure, not just the last few slides. On by default; flip off
  // to restore the pre-structure prompt exactly.
  GENERATION_DECK_STRUCTURE: z.stringbool().default(true),
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
  // The same service-account JSON supplied inline instead of as a file, for
  // hosts that expose env vars but no writable key file (e.g. DO App
  // Platform). Takes precedence over GOOGLE_APPLICATION_CREDENTIALS.
  GOOGLE_APPLICATION_CREDENTIALS_JSON: z.string().optional(),
  GOOGLE_CLOUD_TRANSLATION_KEY: z.string().optional(),
  // Cloud Text-to-Speech is a plain REST API key (like Translation, unlike STT
  // streaming). Absent → the TTS feature is disabled everywhere it appears.
  GOOGLE_CLOUD_TTS_KEY: z.string().optional(),
  // Default language for synthesized speech; a project/lecture's own language
  // overrides it per request.
  TTS_LANGUAGE: z.string().default('en-US'),
  // Default narration voice id (from the shared TTS_VOICES catalog, e.g.
  // "nova") for projects/lectures with no voice of their own. Unset → the
  // provider picks its own default voice for the language.
  TTS_DEFAULT_VOICE: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  // Public origin the app is reached at, used to build the Google OAuth
  // redirect URI (docs/GOOGLE_SIGN_IN.md) and post-login redirects. Must
  // match a redirect URI registered in the Cloud Console byte-for-byte.
  // Absent = derive from the incoming request, which is right for localhost
  // dev. A trailing slash is stripped so callers can append paths safely —
  // DO's ${_self.PUBLIC_URL} binding includes one, which would otherwise
  // produce //app on the post-login redirect.
  PUBLIC_BASE_URL: z
    .string()
    .transform(value => value.replace(/\/+$/, ''))
    .optional(),
  // Origin the browser reaches the SPA at, used only for the post-login
  // landing. In local dev the app runs on Vite (5173) while the OAuth
  // callback stays on PUBLIC_BASE_URL (3000); set this to the Vite origin so
  // sign-in lands on the running app. Unset in production (one origin).
  CLIENT_APP_URL: z
    .string()
    .transform(value => (value ? value.replace(/\/+$/, '') : undefined))
    .optional(),
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

  // Retain streamed lecture audio (google-cloud STT engine only) as a WAV in
  // blob storage, for post-lecture batch diarization (GEN-4 Phase 2). Off by
  // default — opt in once storage growth is acceptable. The GCS copy that the
  // batch pass reads is added in Phase 3.
  AUDIO_RETENTION_ENABLED: z.stringbool().default(false),
  // Days to keep retained recordings before a daily sweep deletes the WAV and
  // its deck reference (cost + student-voice privacy). 0 = keep forever.
  AUDIO_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(30),
  // Days a soft-deleted record (P-10 tombstone) is retained before the daily
  // sweep permanently purges it and its files (P-11). 0 = keep tombstones
  // forever (no purge).
  DELETED_DATA_RETENTION_DAYS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(90),
  // GCS bucket the diarization pass copies audio into — Google BatchRecognize
  // reads only from gs:// (GEN-4 Phase 3). Required for DIARIZATION_PROVIDER=
  // google-cloud; unused otherwise.
  GCS_AUDIO_BUCKET: z.string().optional(),
  // Location for the v2 batch recognizer. Chirp 3 is only in the 'us' and 'eu'
  // MULTI-REGIONS (not regional endpoints like us-central1) — verified live.
  // Sets the {location}-speech.googleapis.com endpoint.
  DIARIZATION_LOCATION: z.string().default('us'),
  // Default strength (1–5) the Refine sliders start at; surfaced to the client
  // via /api/config. The user can still move them per run.
  REFINE_SLIDES_DEFAULT_LEVEL: z.coerce.number().int().min(1).max(5).default(2),
  REFINE_TRANSCRIPT_DEFAULT_LEVEL: z.coerce
    .number()
    .int()
    .min(1)
    .max(5)
    .default(2),

  // Debug aid: show the live session's "simulated speech" text box, which feeds
  // typed phrases through the same pipeline as spoken ones. Off by default now
  // that real STT works — turn it on to drive a session without a microphone.
  SIMULATED_SPEECH_ENABLED: z.stringbool().default(false),

  // Whiteboard (WB-3): how long after the last drawing/erasing gesture the app
  // keeps suppressing auto-slide-creation, so mid-annotation speech doesn't
  // spawn a slide while the user pauses to switch tools or move the cursor.
  WHITEBOARD_SUPPRESS_DEBOUNCE_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(5000),

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
