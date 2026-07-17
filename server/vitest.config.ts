import { defineConfig } from 'vitest/config'
import { config as loadDotenv } from 'dotenv'

// Pick up MONGODB_TEST_URI (and nothing else) from server/.env so local
// runs hit the developer's authenticated MongoDB; CI provides its own env.
loadDotenv({ quiet: true })

/**
 * Unit tests live next to sources (src/**\/*.test.ts); integration tests
 * live in test/integration and need a reachable MongoDB. The npm scripts
 * select between them by path (`vitest run src` vs `vitest run test/integration`).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Integration files share one test database and clean collections in
    // beforeEach — parallel files would wipe each other's fixtures
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      MONGODB_URI:
        process.env.MONGODB_TEST_URI ??
        'mongodb://localhost:27017/slide-machine-test',
      JWT_SECRET: 'test-jwt-secret-at-least-32-characters!',
      JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-chars!!',
      GENERATION_PROVIDER: 'mock',
      // Tests never call live image APIs; enrichment units stub fetch
      IMAGE_ENRICHMENT_ENABLED: 'false',
      // No grace window in tests: rotated-out tokens must die immediately
      REFRESH_GRACE_SECONDS: '0',
      // Uploads land on disk in an isolated test dir
      STORAGE_PROVIDER: 'local',
      STORAGE_LOCAL_DIR: '.uploads-test',
      // Hermetic: the developer's local .env must not leak into tests
      GENERATION_FREEDOM: '2',
      // Feature flags pinned to their code defaults; flag-variant tests
      // mock env per file instead
      GENERATION_VOICE_COMMANDS: 'false',
      GENERATION_LAYOUT_REFIT: 'true',
      // Fake Google OAuth creds so the sign-in routes activate; the real
      // Google network calls are mocked in the tests themselves
      GOOGLE_OAUTH_CLIENT_ID: 'test-google-client-id',
      GOOGLE_OAUTH_CLIENT_SECRET: 'test-google-client-secret',
      PUBLIC_BASE_URL: 'http://localhost:3000',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**'],
    },
  },
})
