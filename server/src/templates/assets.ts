/**
 * Serving the pictures a built-in template's design is made of, and giving
 * them URLs that work wherever the template is read.
 *
 * A built-in ships as a JSON file in the repo, so its decoration can only
 * name a picture by a path — `/templates/nyu-elegant/logo.png`. A path is
 * enough for the browser and not enough for anything else: the exporters
 * fetch a picture over HTTP (`deck-image.ts`), and a URL with no origin is
 * dropped there without a word, so a deck exported to PDF or PowerPoint comes
 * out with the design's logos and background marks silently missing.
 *
 * So the path is absolutized on the way out, exactly as the SPA's
 * link-preview tags are (`static.ts`): the file states what it can know, and
 * the origin — which only the running server knows — is filled in here.
 *
 * The files live under the server's own template directory rather than in the
 * client's `public/`, so one origin serves them in development and in
 * production alike. In development the SPA is served by Vite on another port,
 * and a picture the API server could not serve itself would be unreachable to
 * every reader except the browser.
 */
import path from 'node:path'
import express, { type Express } from 'express'
import type { Layout } from '@slide-machine/shared'
import { env } from '../config/env'

/** Where a built-in's pictures are addressed, and the directory behind it. */
export const TEMPLATE_ASSETS_PATH = '/templates'

export const templateAssetsDir = (): string =>
  path.join(env.TEMPLATES_DIR, 'assets')

/**
 * The origin to resolve a template's picture paths against.
 *
 * `PUBLIC_BASE_URL` where the deployment states one; otherwise the port the
 * server is actually listening on, which is what makes an export carry the
 * design in local development too.
 */
export const assetOrigin = (): string =>
  env.PUBLIC_BASE_URL ?? `http://localhost:${env.PORT}`

/**
 * One picture URL, absolutized.
 *
 * Left alone unless it is a path of ours to resolve: an absolute URL is
 * already answerable, and `/api/files/...` is deliberately relative — the
 * exporters read those straight out of object storage rather than over the
 * network, and giving one an origin would send it the long way round (and in
 * development, nowhere at all).
 */
export const absoluteAssetUrl = (
  url: string | undefined,
  origin = assetOrigin(),
): string | undefined => {
  if (!url) return url
  if (!url.startsWith(`${TEMPLATE_ASSETS_PATH}/`)) return url
  return `${origin}${url}`
}

/** A layout whose decoration pictures can all be fetched by anything that
 * reads it. Returns the layout unchanged when it names none. */
export const withAbsoluteAssets = <T extends Pick<Layout, 'decoration'>>(
  layout: T,
  origin = assetOrigin(),
): T => {
  if (!layout.decoration?.length) return layout
  let changed = false
  const decoration = layout.decoration.map(piece => {
    const imageUrl = absoluteAssetUrl(piece.imageUrl, origin)
    if (imageUrl === piece.imageUrl) return piece
    changed = true
    return { ...piece, imageUrl }
  })
  return changed ? { ...layout, decoration } : layout
}

/** Mounts the pictures. Served from the server's own origin so that the
 * browser, the exporters and any future reader all reach them the same way. */
export const serveTemplateAssets = (app: Express): void => {
  app.use(
    TEMPLATE_ASSETS_PATH,
    express.static(templateAssetsDir(), {
      index: false,
      // The design of a built-in changes only when the app is deployed.
      maxAge: '1h',
      // A miss is a 404, not the SPA. Falling through would answer a missing
      // picture with index.html, which `deck-image.ts` sniffs as a block page
      // and retries before giving up — slow, and misleading in the logs.
      fallthrough: false,
    }),
  )
}
