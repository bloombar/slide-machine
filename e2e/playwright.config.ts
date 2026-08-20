import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import { config as loadDotenv } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Pick up MONGODB_TEST_URI from server/.env so local e2e runs hit the
// developer's authenticated MongoDB; CI provides its own env.
loadDotenv({ path: '../server/.env', quiet: true })

/**
 * E2E tests run against the BUILT app — Express serving the SPA and /api,
 * backed by the test MongoDB — i.e. the exact production topology.
 * Requires `npm run build` first.
 *
 * Two server topologies run in parallel: the default (browser STT) for most
 * specs, and a mock-STT one for the real-time speech socket spec, which needs
 * TRANSCRIPTION_PROVIDER set and a fake-audio browser.
 */
const PORT = 4173
const STT_PORT = 4174

/** Where the log mail transport writes, for the auth specs to read. */
export const MAIL_LOG = path.resolve(__dirname, '.mail-e2e.log')

/** Shared hermetic server env; `over` sets the port/storage/STT per topology. */
const serverEnv = (over: Record<string, string>): Record<string, string> => ({
  NODE_ENV: 'production',
  MONGODB_URI:
    process.env.MONGODB_TEST_URI ??
    'mongodb://localhost:27017/slide-machine-test',
  JWT_SECRET: 'e2e-jwt-secret-at-least-32-characters!!',
  JWT_REFRESH_SECRET: 'e2e-refresh-secret-at-least-32-chars!!!',
  // Grants the admin.spec account access to the /app/admin interface
  ADMIN_EMAILS: 'e2e-admin@example.com',
  GENERATION_PROVIDER: 'mock',
  QUIZ_PROVIDER: 'mock',
  QUIZ_PUBLISH_MODE: 'mock',
  // Hermetic: a developer's local EXPORT_MODE=live must not leak into e2e —
  // export uses fabricated Drive URLs here (no real Google contact).
  EXPORT_MODE: 'mock',
  // Mock TTS returns a silent WAV + synthetic `<mark>` timepoints, so deck
  // playback (and the WB-2 stroke-sync marks) run without a Google key.
  TTS_PROVIDER: 'mock',
  // Mock translation tags each segment with its target locale, so translated
  // viewing (SHARE-2) is assertable without a Google key.
  TRANSLATION_PROVIDER: 'mock',
  IMAGE_ENRICHMENT_ENABLED: 'false',
  // Feedback is mailed. The log transport keeps the run hermetic — no relay
  // is contacted — while still exercising the whole form-to-send path.
  MAIL_PROVIDER: 'log',
  // The mailed verification / reset links (AUTH-3/AUTH-4) carry a token that
  // is stored hashed, so there is nothing in the database for a spec to read.
  // The log transport appends each message here and the spec reads the link
  // out of it — the same link a real inbox would receive.
  MAIL_LOG_FILE: MAIL_LOG,
  FEEDBACK_EMAIL: 'e2e-feedback@example.com',
  // Who the privacy policy and the terms name. Set here so the specs can
  // prove the pages really take it from the server rather than from source.
  OPERATOR_NAME: 'E2E Teaching Ltd',
  OPERATOR_JURISDICTION: 'New York, USA',
  OPERATOR_CONTACT_EMAIL: 'legal@e2e.example',
  OPERATOR_POSTAL_ADDRESS: '1 Broadway, New York, NY 10004, USA',
  // Billing runs on the in-memory adapter: no e2e run may reach Stripe, and
  // the mock drives the whole checkout → webhook path offline (BILL-2).
  BILLING_PROVIDER: 'mock',
  // The mock parses webhooks unsigned, which the server refuses to do under
  // NODE_ENV=production (P-8) — and this suite deliberately runs the
  // production build, because that is the artifact worth testing. Saying so
  // explicitly is the only way through that guard, which is the point of it.
  ALLOW_UNSIGNED_BILLING_WEBHOOKS: 'true',
  STORAGE_PROVIDER: 'local',
  // Hermetic: the developer's local .env must not leak into e2e
  GENERATION_FREEDOM: '2',
  // Exercise the AI command-intent path (voice-command-intent.spec);
  // the mock provider only recognizes explicit "please …" phrases,
  // so other specs are unaffected
  GENERATION_VOICE_COMMANDS: 'true',
  // Layout re-fit on updates (layout-refit.spec), pinned hermetically
  GENERATION_LAYOUT_REFIT: 'true',
  // The simulated-speech box is a debug affordance, off for real users; specs
  // type phrases into it instead of speaking, so e2e turns it on.
  SIMULATED_SPEECH_ENABLED: 'true',
  // Mid-speech interim generation (GEN-12), pinned hermetically for
  // interim-generation.spec; only that spec emits interim results, so the
  // typed-phrase specs never trip it.
  GENERATION_INTERIM_FLUSH: 'true',
  GENERATION_INTERIM_FLUSH_WORDS: '40',
  ...over,
})

const STT_SPEC = /(google-stt|regenerate-transcript|telemetry)\.spec\.ts/

export default defineConfig({
  testDir: './tests',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: {
    trace: 'on-first-retry',
    // The app follows the browser's language (TECH-12), so pin it: every
    // spec but i18n.spec selects on English copy, and without this they
    // would pass or fail by the runner's system locale. i18n.spec opts
    // out with its own test.use({ locale: 'fr-FR' }).
    locale: 'en-US',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: STT_SPEC,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${PORT}`,
      },
    },
    {
      // Real-time STT: mock streaming adapter + a fake mic; runs against its
      // own server so mic auto-start never perturbs the other specs.
      name: 'chromium-stt',
      testMatch: STT_SPEC,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${STT_PORT}`,
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
          ],
        },
      },
    },
  ],
  webServer: [
    {
      command: 'node ../server/dist/index.js',
      port: PORT,
      reuseExistingServer: !process.env.CI,
      env: serverEnv({
        PORT: String(PORT),
        STORAGE_LOCAL_DIR: '.uploads-e2e',
        TRANSCRIPTION_PROVIDER: 'browser',
        // Pinned to this server's own origin: a developer's .env pointing at
        // the Vite dev port would send billing's checkout return (BILL-2) to
        // a different origin, where the session does not exist.
        PUBLIC_BASE_URL: `http://localhost:${PORT}`,
        CLIENT_APP_URL: '',
      }),
    },
    {
      command: 'node ../server/dist/index.js',
      port: STT_PORT,
      reuseExistingServer: !process.env.CI,
      env: serverEnv({
        PORT: String(STT_PORT),
        STORAGE_LOCAL_DIR: '.uploads-e2e-stt',
        TRANSCRIPTION_PROVIDER: 'mock',
        PUBLIC_BASE_URL: `http://localhost:${STT_PORT}`,
        CLIENT_APP_URL: '',
        // Keeps each session's audio, which is what a slide is re-transcribed
        // from (regenerate-transcript.spec).
        AUDIO_RETENTION_ENABLED: 'true',
      }),
    },
  ],
})
