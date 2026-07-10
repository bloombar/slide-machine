import { defineConfig } from 'vitest/config'

/**
 * Unit tests live next to sources (src/**\/*.test.ts); integration tests
 * live in test/integration and need a reachable MongoDB. The npm scripts
 * select between them by path (`vitest run src` vs `vitest run test/integration`).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      MONGODB_URI:
        process.env.MONGODB_TEST_URI ??
        'mongodb://localhost:27017/slide-machine-test',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**'],
    },
  },
})
