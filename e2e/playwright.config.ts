import { defineConfig, devices } from '@playwright/test'
import { config as loadDotenv } from 'dotenv'

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
  IMAGE_ENRICHMENT_ENABLED: 'false',
  STORAGE_PROVIDER: 'local',
  // Hermetic: the developer's local .env must not leak into e2e
  GENERATION_FREEDOM: '2',
  // Exercise the AI command-intent path (voice-command-intent.spec);
  // the mock provider only recognizes explicit "please …" phrases,
  // so other specs are unaffected
  GENERATION_VOICE_COMMANDS: 'true',
  // Layout re-fit on updates (layout-refit.spec), pinned hermetically
  GENERATION_LAYOUT_REFIT: 'true',
  ...over,
})

const STT_SPEC = /google-stt\.spec\.ts/

export default defineConfig({
  testDir: './tests',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: { trace: 'on-first-retry' },
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
      }),
    },
  ],
})
