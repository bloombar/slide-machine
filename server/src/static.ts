/**
 * Production static serving: the Express monolith serves the built React
 * SPA alongside /api (SPEC TECH-10 — one DO App Platform service). Any
 * non-/api GET falls back to index.html for client-side routing.
 */
import path from 'node:path'
import express, { type Express } from 'express'

export const serveSpa = (app: Express, clientDist: string): void => {
  app.use(express.static(clientDist))
  // Express 5: bare '*' routes are invalid; a regex keeps /api out of the fallback
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'))
  })
}
