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
      // The pictures a built-in template's design is made of, which the API
      // server owns (server/config/templates/assets). In production one origin
      // serves both; without this the dev server answers them with index.html
      // and every logo and background mark on a slide quietly disappears.
      '/templates': {
        target: 'http://localhost:3000',
      },
      // The OAuth authorization server (docs/MCP.md §5). These live at the
      // application root rather than under /api, because that is where the
      // discovery documents have to be — so in development, where the SPA is
      // on Vite and the API on :3000, they need forwarding explicitly or an
      // assistant's token request lands on index.html.
      '/.well-known': {
        target: 'http://localhost:3000',
      },
      '/authorize': {
        target: 'http://localhost:3000',
      },
      '/token': {
        target: 'http://localhost:3000',
      },
      '/register': {
        target: 'http://localhost:3000',
      },
      '/revoke': {
        target: 'http://localhost:3000',
      },
    },
  },
})
