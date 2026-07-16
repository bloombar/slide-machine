import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Dev server proxies /api to the Express server so client code always
 * fetches same-origin relative URLs — identical to production, where
 * Express serves the built SPA itself. `ws: true` also forwards the
 * real-time STT WebSocket upgrade (/api/stt); Vite's own HMR socket is on
 * a different path, so scoping this to /api leaves it untouched.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
})
