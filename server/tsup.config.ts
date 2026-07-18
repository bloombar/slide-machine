import { defineConfig } from 'tsup'
import { computeAppVersion } from './src/lib/app-version'

/**
 * Production build: bundles the server (inlining the source-exported
 * @slide-machine/shared package) into dist/; real node_modules stay external.
 *
 * `__APP_VERSION__` is computed here (build date + git sha) and inlined into
 * the bundle, so the deployed server reports its CalVer version without
 * needing `.git` at runtime.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  noExternal: ['@slide-machine/shared'],
  define: {
    __APP_VERSION__: JSON.stringify(computeAppVersion()),
  },
})
