import { defineConfig, devices } from '@playwright/test'
import { config as loadDotenv } from 'dotenv'

// Pick up MONGODB_TEST_URI from server/.env so local e2e runs hit the
// developer's authenticated MongoDB; CI provides its own env.
loadDotenv({ path: '../server/.env', quiet: true })

/**
 * E2E tests run against the BUILT app — Express serving the SPA and /api,
 * backed by the test MongoDB — i.e. the exact production topology.
 * Requires `npm run build` first.
 */
const PORT = 4173

export default defineConfig({
  testDir: './tests',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node ../server/dist/index.js',
    port: PORT,
    reuseExistingServer: !process.env.CI,
    env: {
      NODE_ENV: 'production',
      PORT: String(PORT),
      MONGODB_URI:
        process.env.MONGODB_TEST_URI ??
        'mongodb://localhost:27017/slide-machine-test',
      JWT_SECRET: 'e2e-jwt-secret-at-least-32-characters!!',
      JWT_REFRESH_SECRET: 'e2e-refresh-secret-at-least-32-chars!!!',
      GENERATION_PROVIDER: 'mock',
      IMAGE_ENRICHMENT_ENABLED: 'false',
    },
  },
})
