/**
 * Serving the pictures a built-in template's design is made of.
 *
 * A built-in ships as a JSON file in the repo, so its decoration names a
 * picture by a path and nothing else. That path stays a path everywhere it is
 * stored: a template is snapshotted when a deck pins it (TMPL-11), and an
 * absolute URL written in here would freeze THIS deployment's origin into
 * decks and travel with them — a development origin, baked into a lecture.
 *
 * So the origin is supplied at the two points that need one, and neither of
 * them persists it. The browser needs none, because the app serves these off
 * its own origin. The exporters fetch pictures over HTTP and cannot use a
 * bare path, so they read a template's own pictures off disk instead
 * (`deck-image.ts`), exactly as they read `/api/files/` out of storage.
 *
 * The files live under the server's own template directory rather than in the
 * client's `public/`, so one origin serves them in development and in
 * production alike; in development the SPA is served by Vite on another port,
 * and a picture the API server could not serve itself would be unreachable to
 * every reader except the browser.
 */
import path from 'node:path'
import express, { type Express } from 'express'
import { env } from '../config/env'

/** Where a built-in's pictures are addressed, and the directory behind it. */
export const TEMPLATE_ASSETS_PATH = '/templates'

export const templateAssetsDir = (): string =>
  path.join(env.TEMPLATES_DIR, 'assets')

/** Mounts the pictures, so the browser and the exporters reach them the same
 * way in every environment. */
export const serveTemplateAssets = (app: Express): void => {
  app.use(
    TEMPLATE_ASSETS_PATH,
    express.static(templateAssetsDir(), {
      index: false,
      // The design of a built-in changes only when the app is deployed.
      maxAge: '1h',
      // A miss is an error, not the SPA. Falling through would answer a
      // missing picture with index.html, which `deck-image.ts` sniffs as a
      // block page and retries before giving up — slow, and misleading in the
      // logs. What the caller actually receives is a 500: `fallthrough: false`
      // hands the miss to the error handler, which has no case for it. Said
      // exactly because this comment used to claim a 404, and a reader
      // debugging a missing picture would go looking for the wrong status.
      fallthrough: false,
    }),
  )
}
