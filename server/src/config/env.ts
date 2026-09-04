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

const envSchema = z
  .object({
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
    /** Per-unit vendor prices the plan caps were derived from (BILL-6/BILL-7);
     * see docs/BILLING_COST_MODEL.md. */
    SERVICE_PRICES_PATH: z
      .string()
      .default(path.join(serverRoot, '..', 'config', 'service-prices.json')),
    /** Externalized prompt templates (docs/GENERATION_PROMPT.md). */
    PROMPTS_DIR: z
      .string()
      .default(path.join(serverRoot, '..', 'config', 'prompts')),
    /** Starter slide templates, one JSON per template (docs/TEMPLATES.md). */
    TEMPLATES_DIR: z
      .string()
      .default(path.join(serverRoot, 'config', 'templates')),
    /** Which built-in a new account starts on, and what an unknown template id
     * falls back to. Named here rather than in code, and only as a default: an
     * id that TEMPLATES_DIR does not hold is ignored in favour of the first
     * template it does, so a deployment shipping its own set still needs no
     * code change. */
    DEFAULT_TEMPLATE_ID: z.string().default('nyu-elegant'),

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
    // EXP-1's second export shape: a lecture that carries its style template
    // as the presentation's own layout pages, so the file can be restyled
    // where it lands and re-imported with that design intact.
    //
    // Off by default. It is the more ambitious half of the requirement and
    // the flat file is what most people want to hand someone; a deployment
    // that wants the choice turns it on and the option appears beside the
    // format. Off, the checkbox is absent and the server ignores the field,
    // so a stale client cannot ask for it either.
    EXPORT_REUSABLE_LAYOUTS: z.stringbool().default(false),
    IMAGE_GEN_PROVIDER: z.string().default('gemini'),
    // Text-to-speech (slide/deck playback). 'google-cloud' needs a key below;
    // 'none' disables the feature; 'mock' is for tests. Without a usable key the
    // client hides the play button and the per-slide "Speak this slide" option.
    TTS_PROVIDER: z.string().default('google-cloud'),
    // Post-lecture translated viewing (SHARE-2). 'google-cloud' needs
    // GOOGLE_CLOUD_TRANSLATION_KEY below; 'none' disables the feature; 'mock' is
    // for tests. Without a usable key the client hides the language switcher.
    TRANSLATION_PROVIDER: z.string().default('google-cloud'),

    // Image enrichment (IMG-1): background stock-image fetch for slides
    IMAGE_ENRICHMENT_ENABLED: z.stringbool().default(true),
    // How many results each source (Wikimedia/Openverse/Flickr) returns per query.
    IMAGE_SOURCE_RESULTS: z.coerce.number().int().positive().default(8),
    // Most keyword phrases fanned out per search (each fires all sources).
    IMAGE_MAX_QUERY_PHRASES: z.coerce.number().int().positive().default(6),
    // Words kept from each search phrase. Sources match every word of a query,
    // so a long phrase is a long list of conditions and finds nothing; two
    // significant words keep the subject and still return a pool to rank
    // (`tightenSearchPhrase`).
    IMAGE_MAX_QUERY_WORDS: z.coerce.number().int().positive().default(2),
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

    // Billing (SPEC TECH-9). Selects the active billing adapter by name; its
    // vendor-specific credentials (STRIPE_*) live with the other secrets below
    // and stay optional until billing goes live — 'mock' needs none, and the
    // Stripe adapter fails descriptively without them.
    BILLING_PROVIDER: z.string().default('stripe'),
    /**
     * Permits the unsigned mock billing adapter under `NODE_ENV=production`
     * (P-8). Off by default, and the only way into that combination.
     *
     * It exists for the e2e suite, which runs the *production build* — that is
     * the artifact worth testing — against mock billing, and so is a genuine
     * "production plus mock" that is not a production deployment. Rather than
     * weaken the guard to let that through implicitly, the escape hatch is
     * named after exactly what it permits: nobody sets a variable called
     * ALLOW_UNSIGNED_BILLING_WEBHOOKS on a real deployment by accident, and
     * anyone who does has said the dangerous thing out loud.
     */
    ALLOW_UNSIGNED_BILLING_WEBHOOKS: z.stringbool().default(false),

    // Auth (AUTH-1/2): signing secrets are required; TTLs are tunable
    JWT_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    JWT_REFRESH_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(2592000),
    // How long a rotated-out refresh token stays valid (two-tab race window)
    REFRESH_GRACE_SECONDS: z.coerce.number().int().nonnegative().default(60),

    // Secrets & service credentials — optional until their features land
    GEMINI_API_KEY: z.string().optional(),
    // Chosen for phrase-to-slide latency: the flash-lite family answers in
    // ~1s with no thinking overhead (thinking models measured 2.5-10s per
    // phrase; see docs/DECISIONS.md)
    GEMINI_MODEL: z.string().default('gemini-3.5-flash-lite'),
    // Embedding model for semantic phrase re-anchoring of whiteboard marks on
    // transcript refine (WB-2). Same Gemini API key/base as generation.
    // Its similarity scale sets PHRASE_MATCH_THRESHOLD (remap-drawings.ts) —
    // re-tune the threshold when changing this model.
    GEMINI_EMBED_MODEL: z.string().default('gemini-embedding-001'),
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
    // Mid-speech interim generation (GEN-12): during long uninterrupted
    // speech the recognizer emits no finalized phrase until the speaker
    // pauses, so no slide appears either. When on, the client flushes the
    // stable prefix of the interim transcript into generation once it grows
    // past the word threshold below, and the eventual finalized phrase
    // submits only the words not already flushed. Off by default (opt-in):
    // flushed text is the recognizer's hypothesis, not its finalized pass,
    // so the transcript trades some fidelity for liveness (see GEN-12).
    GENERATION_INTERIM_FLUSH: z.stringbool().default(false),
    // How many stable, not-yet-submitted interim words accumulate before a
    // mid-speech flush (~140 words is about a minute of ordinary lecture
    // speech at ~140 wpm).
    GENERATION_INTERIM_FLUSH_WORDS: z.coerce.number().int().min(1).default(140),
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
    // Google Picker, the chooser for connected-account Drive files and folders
    // (docs/GOOGLE_API_KEYS.md §6). The app holds only `drive.file`, which
    // cannot list a Drive, so the user picks in Google's own widget and the
    // pick is what grants access to that one file.
    //
    // A *browser* API key, published through GET /api/config and therefore not
    // a secret — restrict it to the Picker API and your own referrers in the
    // Cloud Console. Absent in live mode → Drive saving and importing report
    // themselves unavailable rather than opening a chooser that cannot work.
    GOOGLE_PICKER_API_KEY: z.string().optional(),
    // The Cloud project NUMBER (not the project id, not the OAuth client id).
    // Picker sends it as the app id, and it is what ties a picked file's grant
    // to this OAuth client — get it wrong and the pick succeeds while the
    // server's later read 404s.
    GOOGLE_PICKER_APP_ID: z.string().optional(),
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
    // How outgoing mail leaves the server: 'smtp' relays through the SMTP_*
    // settings above, 'log' writes the message to the server log instead (dev
    // and e2e, where there is no relay to talk to), 'none' disables mail
    // altogether. Mail-backed features report themselves unavailable rather
    // than failing at send time when the transport cannot deliver.
    MAIL_PROVIDER: z.enum(['smtp', 'log', 'none']).default('smtp'),
    // With MAIL_PROVIDER=log, also append each message to this file. Set only
    // by the e2e run, which needs to read a real verification / reset link out
    // of a message the server sent (AUTH-3/AUTH-4) — the token is stored
    // hashed, so there is nothing in the database to read instead. Reveals no
    // more than `log` already prints to the server's own output.
    MAIL_LOG_FILE: z.string().optional(),
    // Envelope sender for mail the app originates. Unset falls back to
    // SMTP_USER, which is the account most relays require to be the sender
    // anyway.
    MAIL_FROM: z.string().optional(),
    // The display name beside that address in a recipient's inbox — "The
    // Slide Machine" rather than a bare `noreply@`. Cosmetic, but it is the
    // first thing a reader sees and the main signal that a message is ours.
    // Unset sends the address alone, which is what a plain relay does.
    MAIL_FROM_NAME: z.string().optional(),
    // Where the "Send feedback" form delivers (bug reports, feature requests).
    // Unset hides the form: there is no address to send to.
    FEEDBACK_EMAIL: z.string().optional(),

    // Who runs this deployment. Published through GET /api/config and named
    // verbatim by the privacy policy and the terms, so a change of address or
    // legal entity is configuration rather than a release. Nothing here is a
    // secret — it appears on two public pages. Each field left unset shows the
    // client's own placeholder in square brackets, which reads as the draft it
    // is (docs/DEPLOY.md, "Before launch").
    OPERATOR_NAME: z.string().default(''),
    OPERATOR_JURISDICTION: z.string().default(''),
    OPERATOR_CONTACT_EMAIL: z.string().default(''),
    OPERATOR_POSTAL_ADDRESS: z.string().default(''),
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
    // Ceiling on how much audio ONE session may STORE (MB). Audio streams out as
    // it arrives, so a long lecture no longer costs memory — this is a
    // storage-cost limit, not a memory guard. At the default 16 kHz capture rate
    // 300 MB is ~2 h 44 min (~55 min if a client streams 48 kHz). Past it the
    // recording is truncated; transcription continues. 0 = no per-session cap.
    AUDIO_RETENTION_MAX_SESSION_MB: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(300),
    // Ceiling on the MEMORY live retention may hold across all concurrent
    // sessions (MB). Each recording holds a fixed in-flight upload window
    // (~11 MB) rather than its whole length, so this caps how many lectures may
    // record at once — roughly this value / 11. Audio buffers live outside the
    // V8 heap, so an overrun shows up as RSS growth and an OOM kill, not a
    // catchable heap error. Past the ceiling, further sessions simply don't
    // retain — transcription is never affected. 0 = no global limit.
    AUDIO_RETENTION_MAX_TOTAL_MB: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(128),
    // Mic capture rate (Hz) the client downsamples to before streaming (CAP-3).
    // The browser's native 48 kHz costs bandwidth, retention memory, and stored
    // size for content the speech models discard: Google's are trained at 16 kHz.
    //
    // The default splits the difference at 24 kHz. Transcription only needs 16,
    // but the same recording is played back per slide (PLAY-2), and 16 kHz
    // reproduces nothing above 8 kHz — which is where the sibilance of "s" and
    // "f" lives, so speech stays perfectly intelligible but sounds dull. 24 kHz
    // keeps that for half the cost of 48 kHz. Drop to 16000 if playback fidelity
    // does not matter to you; the recordings are the only thing that changes.
    //
    // Raising this also SHORTENS how long a session runs before
    // AUDIO_RETENTION_MAX_SESSION_MB truncates it — ~1 h 49 min at 24 kHz
    // against ~2 h 44 min at 16 kHz — so the two want setting together.
    //
    // Clients whose AudioContext already runs at or below this send their native
    // rate unchanged (we never upsample). 0 = no downsampling at all: stream the
    // context's native rate, whatever it is. Like the retention ceilings, 0 here
    // means "no limit" — the MOST audio, not the least.
    STT_CAPTURE_SAMPLE_RATE: z.coerce
      .number()
      .int()
      .nonnegative()
      .max(48000)
      .refine(rate => rate === 0 || rate >= 8000, {
        message:
          'must be 0 (native, no downsampling) or between 8000 and 48000',
      })
      .default(24000),
    // Days a soft-deleted record (P-10 tombstone) is retained before the daily
    // sweep permanently purges it and its files (P-11). 0 = keep tombstones
    // forever (no purge).
    DELETED_DATA_RETENTION_DAYS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(90),
    /**
     * How many proxies sit in front of the app, for `req.ip`.
     *
     * 0 — the default — means none: Express reports the socket peer, which is
     * correct for `npm run dev` and for the docker-compose stack, where port
     * 3000 is published directly. Anything above 0 makes `req.ip` come from
     * `X-Forwarded-For`, so setting it when there is no proxy hands every
     * caller the ability to choose their own address, and with it a free
     * bypass of every limiter keyed on one — and the ability to spend a
     * chosen victim's budget.
     *
     * Set it to the real hop count in a proxied deployment (1 behind a single
     * TLS-terminating ingress). It is exact rather than a boolean because
     * Express counts from the right of the header: the ingress appends the
     * real client, so trusting exactly the hops that exist reads that entry
     * and ignores any prefix the client forged. Too high and a forged prefix
     * wins; too low and every caller shares one key.
     *
     * If the count is wrong upwards, limiters get looser and spoofable; if
     * wrong downwards, they collapse to a single shared budget. Verify it
     * against the deployment rather than assuming — a sentinel
     * `X-Forwarded-For` sent to the running app comes back as `req.ip` only
     * when the count is right.
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().nonnegative().default(0),
    /**
     * Openings one caller may record per 15 minutes before the beacon stops
     * writing rows for them (EVAL-7). Configuration so the tests can drive a
     * flood without sending six hundred requests per case; the default clears
     * any human by a wide margin and a script passes it in seconds.
     */
    DECK_VIEW_RATE_LIMIT: z.coerce.number().int().positive().default(600),
    /**
     * How long raw cost-ledger events are kept before a complete month is
     * rolled up and its rows removed (BILL-7/P-11). 0 = keep every event
     * forever, which is fine for a small deployment and unwise for a busy one:
     * this is the only collection that grows with usage rather than content.
     * A year by default, so the reports have twelve months of detail behind
     * them and everything older answers from the monthly summaries.
     */
    COST_LEDGER_RETENTION_DAYS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(365),
    /**
     * How long lecture openings (EVAL-7) are kept before the daily sweep
     * deletes them. `0` keeps them forever, which is fine for a small
     * deployment and unwise for a busy one: this and the cost ledger are the
     * only two collections that grow with usage rather than content. A year by
     * default, matching the ledger, so a term's readings and the costs they
     * caused age out together rather than one outliving the other.
     */
    DECK_VIEW_RETENTION_DAYS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(365),
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
    REFINE_SLIDES_DEFAULT_LEVEL: z.coerce
      .number()
      .int()
      .min(1)
      .max(5)
      .default(2),
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
  /**
   * Cross-field rules that only make sense once every value is known. Kept as
   * a refinement rather than scattered through the fields so the reason a
   * combination is refused is written next to the combination.
   */
  .superRefine((config, ctx) => {
    // P-8: the mock billing adapter accepts webhooks unsigned — that is the
    // point of it, and it is why it must never be what a production
    // deployment runs. `/api/billing/webhook` is unauthenticated by
    // necessity (the caller is the payment provider, not a user), so the
    // signature is the only thing standing between a stranger and a POST
    // that writes a subscription row for any account they name. Refusing to
    // boot is the correct response: a deployment that reaches this state has
    // no safe way to serve the endpoint, and quietly starting would leave
    // every plan in the system forgeable.
    // The one exception is an explicit opt-in, which the e2e suite uses to run
    // the production build against mock billing. See the variable's own note.
    if (
      config.NODE_ENV === 'production' &&
      config.BILLING_PROVIDER === 'mock' &&
      !config.ALLOW_UNSIGNED_BILLING_WEBHOOKS
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['BILLING_PROVIDER'],
        message:
          'the mock adapter accepts unsigned billing webhooks and must not run in production — set a real provider, or ALLOW_UNSIGNED_BILLING_WEBHOOKS=true if this is a test harness (P-8)',
      })
    }
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
