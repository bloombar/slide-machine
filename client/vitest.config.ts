import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    server: {
      deps: {
        // i18next-icu's ESM build does `import IntlMessageFormat from
        // 'intl-messageformat'`, and that package has no exports map — so
        // Node picks its CommonJS entry and the default import lands on
        // the module object rather than the class. Vite resolves the ESM
        // entry the browser build already uses, so processing this one
        // dependency through Vite makes ICU messages format under test the
        // same way they do in the app.
        inline: ['i18next-icu'],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**'],
    },
  },
})
