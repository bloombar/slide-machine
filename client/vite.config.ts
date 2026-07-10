import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Dev server proxies /api to the Express server so client code always
 * fetches same-origin relative URLs — identical to production, where
 * Express serves the built SPA itself.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
