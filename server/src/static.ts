/**
 * Production static serving: the Express monolith serves the built React
 * SPA alongside /api (SPEC TECH-10 — one DO App Platform service). Any
 * non-/api GET falls back to index.html for client-side routing.
 *
 * index.html goes out through two rewrites.
 *
 * The first is the link-preview tags: they ship with root-relative paths,
 * because that is all a static file can know, but scrapers do not resolve
 * those — an og:image of "/og-image.png" is simply dropped, and the share
 * shows no image. The origin is only knowable per request, so the tags are
 * absolutized on the way out.
 *
 * The second fills the <noscript> block. index.html ships a summary of the
 * app for readers that do not execute the bundle; on /privacy and /terms that
 * summary is replaced by the document itself, because Google's OAuth
 * requirement asks for the policy "in the body of a dedicated privacy policy
 * web page" and a client-rendered page has no body to speak of
 * (docs/GOOGLE_PRODUCTION_MODE.md §3.3, AUTH-7).
 */
import fs from 'node:fs'
import path from 'node:path'
import express, { type Express, type Request } from 'express'
import {
  privacyDocument,
  termsDocument,
  withPlaceholders,
  type OperatorDetails,
  type StaticDocument,
} from '@slide-machine/shared'
import { env } from './config/env'
import { documentToHtml } from './lib/document-html'

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

/** Everything between the noscript tags, which the document replaces. */
const NOSCRIPT_BODY = /(<noscript>)[\s\S]*?(<\/noscript>)/

/** The paths that serve a document of their own, and how to build it. */
const DOCUMENT_ROUTES: Record<string, (op: OperatorDetails) => StaticDocument> =
  {
    '/privacy': privacyDocument,
    '/terms': termsDocument,
  }

/** Who the deployment says runs it, blanks filled with the placeholders the
 * documents use. The same values GET /api/config publishes to the client, so
 * the rendered page and the drawn one name the same party. */
const operator = (): OperatorDetails =>
  withPlaceholders({
    name: env.OPERATOR_NAME,
    jurisdiction: env.OPERATOR_JURISDICTION,
    contactEmail: env.OPERATOR_CONTACT_EMAIL,
    postalAddress: env.OPERATOR_POSTAL_ADDRESS,
  })

/**
 * Swaps the generic app summary in the noscript block for the document this
 * path is about. Any other path keeps the summary, and a file with no
 * noscript block is returned untouched rather than guessed at.
 */
export const inlineDocument = (html: string, requestPath: string): string => {
  const build = DOCUMENT_ROUTES[requestPath.replace(/\/+$/, '') || '/']
  if (!build) return html
  const body = documentToHtml(build(operator()))
  return html.replace(
    NOSCRIPT_BODY,
    (_m, open: string, close: string) =>
      // $ in the policy text (a price, a placeholder) would otherwise be read
      // as a replacement pattern, so the replacement is a function.
      `${open}\n${body}\n${close}`,
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
      .send(
        inlineDocument(
          absolutizePreviewTags(html, previewOrigin(req), req.path),
          req.path,
        ),
      )
  })
}
