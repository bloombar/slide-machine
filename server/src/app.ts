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
import { decksRouter } from './routes/decks'
import { usersRouter } from './routes/users'
import { seedAssetsRouter } from './routes/seed-assets'
import { slidesRouter } from './routes/slides'
import { filesRouter } from './routes/files'
import { ttsRouter } from './routes/tts'
import { billingRouter, WEBHOOK_PATH } from './routes/billing'
import { errorHandler } from './middleware/error'
import { serveSpa } from './static'
import './actions/system'
import './actions/project'
import './actions/template'
import './actions/deck'
import './actions/deck-import'
import './actions/reconcile'
import './actions/slide'
import './actions/user'
import './actions/seed-asset'
import './actions/quiz'
import './actions/export'
import './actions/billing'
import './actions/social'
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
  app.use(express.json())
  app.use(cookieParser())

  const api = Router()
  api.use(healthRouter)
  api.use(configRouter)
  api.use('/auth', authRouter)
  api.use(feedbackRouter)
  api.use('/auth', googleConnectRouter)
  api.use('/admin', adminRouter)
  api.use(actionsRouter)
  api.use(decksRouter)
  api.use(usersRouter)
  api.use(seedAssetsRouter)
  api.use(slidesRouter)
  api.use(filesRouter)
  api.use(ttsRouter)
  api.use(billingRouter)
  app.use('/api', api)

  if (env.NODE_ENV === 'production') {
    serveSpa(app, env.CLIENT_DIST)
  }

  // Must be registered last; Express 5 forwards rejected async handlers here
  app.use(errorHandler)

  return app
}
