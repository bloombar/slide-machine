/**
 * Builds the Express application. Kept listen-free so integration tests
 * can exercise it with supertest; src/index.ts owns startup.
 */
import express, { Router, type Express } from 'express'
import cookieParser from 'cookie-parser'
import { env } from './config/env'
import { healthRouter } from './routes/health'
import { configRouter } from './routes/config'
import { authRouter } from './routes/auth'
import { feedbackRouter } from './routes/feedback'
import { googleConnectRouter } from './routes/google-connect'
import { adminRouter } from './routes/admin'
import { actionsRouter } from './routes/actions'
import { mcpRouter } from './routes/mcp'
import {
  oauthAuthRouter,
  oauthAvailable,
  oauthConsentRouter,
} from './routes/oauth'
import { decksRouter } from './routes/decks'
import { usersRouter } from './routes/users'
import { seedAssetsRouter } from './routes/seed-assets'
import { slidesRouter } from './routes/slides'
import { filesRouter } from './routes/files'
import { ttsRouter } from './routes/tts'
import { billingRouter, WEBHOOK_PATH } from './routes/billing'
import { errorHandler } from './middleware/error'
import { serveSpa } from './static'
import { serveTemplateAssets } from './templates/assets'
// Registers every action (TECH-13). One list, shared with the access
// completeness audit, so neither can drift from the other.
import './actions/register-all'
import './providers/mock-generation'
import './providers/gemini-generation'
import './providers/mock-quiz'
import './providers/gemini-quiz'
import './providers/google-cloud-transcription'
import './providers/mock-transcription'
import './providers/mock-diarization'
import './providers/google-cloud-diarization'
import './providers/google-cloud-tts'
import './providers/mock-tts'
import './providers/google-cloud-translation'
import './providers/mock-translation'
import './billing/mock'
import './billing/stripe'

export const createApp = (): Express => {
  const app = express()
  // Ahead of the JSON parser, and only for this path: webhook signatures are
  // computed over the exact bytes the provider sent, so the body has to reach
  // the adapter unparsed (BILL-2). Everything else gets JSON as usual.
  app.use(`/api${WEBHOOK_PATH}`, express.raw({ type: '*/*', limit: '1mb' }))
  // Big enough for a PowerPoint import (EXP-3/EXP-5). A .pptx travels as
  // base64 inside the action's JSON body, which inflates it by a third, and
  // Express's 100kb default rejected every real deck — as a 500 the caller
  // could not act on. The ceiling is deliberate rather than absent: an import
  // is authenticated and metered, but nothing should be able to post an
  // unbounded body.
  app.use(express.json({ limit: '32mb' }))
  app.use(cookieParser())

  // The OAuth authorization server, at the application ROOT rather than under
  // /api — RFC 8414 and RFC 9728 put the discovery documents at
  // /.well-known/..., and an assistant nobody arranged finds every other
  // endpoint by reading them. Mounted before the API so the SPA fallback in
  // production cannot swallow them.
  //
  // Conditional, because the standard requires an https issuer and a
  // deployment reached over plain http cannot satisfy it. Skipping the feature
  // is the right failure: the alternative is the whole application refusing to
  // start over one thing it cannot offer.
  if (oauthAvailable()) {
    app.use(oauthAuthRouter())
  } else {
    console.warn(
      'MCP agent access is unavailable: it needs an https PUBLIC_BASE_URL (or localhost in development)',
    )
  }

  const api = Router()
  api.use(healthRouter)
  api.use(configRouter)
  api.use('/auth', authRouter)
  api.use(feedbackRouter)
  api.use('/auth', googleConnectRouter)
  api.use('/admin', adminRouter)
  api.use(actionsRouter)
  api.use(mcpRouter)
  api.use(oauthConsentRouter)
  api.use(decksRouter)
  api.use(usersRouter)
  api.use(seedAssetsRouter)
  api.use(slidesRouter)
  api.use(filesRouter)
  api.use(ttsRouter)
  api.use(billingRouter)
  app.use('/api', api)

  // The pictures a built-in template's design is made of. Outside /api
  // because they are static files, and served in every environment because
  // the exporters fetch them by URL as well as the browser.
  serveTemplateAssets(app)

  if (env.NODE_ENV === 'production') {
    serveSpa(app, env.CLIENT_DIST)
  }

  // Must be registered last; Express 5 forwards rejected async handlers here
  app.use(errorHandler)

  return app
}
