/**
 * Production static serving: the Express monolith serves the built React
 * SPA alongside /api (SPEC TECH-10 — one DO App Platform service). Any
 * non-/api GET falls back to index.html for client-side routing.
 *
 * index.html goes out through one rewrite. Its link-preview tags ship with
 * root-relative paths, because that is all a static file can know, but
 * scrapers do not resolve those — an og:image of "/og-image.png" is simply
 * dropped, and the share shows no image. The origin is only knowable per
 * request, so the tags are absolutized on the way out.
 */
import fs from 'node:fs'
import path from 'node:path'
import express, { type Express, type Request } from 'express'
import { env } from './config/env'

/** The preview tags whose content must be an absolute URL to be used. */
const PREVIEW_TAGS =
  /(<meta\s+(?:property|name)="(?:og:image|og:url|twitter:image)"\s+content=")(\/[^"]*)"/g

/**
 * Rewrites those tags against `origin`. og:url ships as "/" — a placeholder
 * for whichever page is being shared — so it becomes the requested path.
 */
export const absolutizePreviewTags = (
  html: string,
  origin: string,
  requestPath: string,
): string => {
  const base = origin.replace(/\/$/, '')
  return html.replace(
    PREVIEW_TAGS,
    (_match, opening: string, assetPath: string) =>
      `${opening}${base}${assetPath === '/' ? requestPath : assetPath}"`,
  )
}

/** Configuration first, then the host the request actually arrived on. */
const previewOrigin = (req: Request): string =>
  env.PUBLIC_BASE_URL ?? `${req.protocol}://${req.get('host')}`

export const serveSpa = (app: Express, clientDist: string): void => {
  // index:false so every HTML response, "/" included, goes through the
  // rewrite below rather than being served straight off disk.
  app.use(express.static(clientDist, { index: false }))
  // Express 5: bare '*' routes are invalid; a regex keeps /api out of the fallback
  app.get(/^\/(?!api\/).*/, (req, res) => {
    const html = fs.readFileSync(path.join(clientDist, 'index.html'), 'utf8')
    res
      .type('html')
      .send(absolutizePreviewTags(html, previewOrigin(req), req.path))
  })
}
