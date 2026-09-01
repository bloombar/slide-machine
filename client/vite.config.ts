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
      // The OAuth authorization server (docs/MCP.md §5). Its discovery
      // documents must sit at the root, so in development — where the SPA is
      // on Vite and the API on :3000 — they need forwarding explicitly, or an
      // assistant reading them gets index.html.
      '/.well-known': {
        target: 'http://localhost:3000',
      },
      // The endpoints themselves are under a prefix rather than at the root,
      // because `/register` at the root would shadow this app's own sign-up
      // page. One entry covers all four.
      '/oauth/authorize': {
        target: 'http://localhost:3000',
      },
      '/oauth/token': {
        target: 'http://localhost:3000',
      },
      '/oauth/register': {
        target: 'http://localhost:3000',
      },
      '/oauth/revoke': {
        target: 'http://localhost:3000',
      },
    },
  },
})
