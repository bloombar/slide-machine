import { defineConfig } from 'tsup'

/**
 * Production build: bundles the server (inlining the source-exported
 * @slide-machine/shared package) into dist/; real node_modules stay external.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  noExternal: ['@slide-machine/shared'],
})
