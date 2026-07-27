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
import { googleConnectRouter } from './routes/google-connect'
import { adminRouter } from './routes/admin'
import { actionsRouter } from './routes/actions'
import { decksRouter } from './routes/decks'
import { usersRouter } from './routes/users'
import { seedAssetsRouter } from './routes/seed-assets'
import { slidesRouter } from './routes/slides'
import { filesRouter } from './routes/files'
import { ttsRouter } from './routes/tts'
import { errorHandler } from './middleware/error'
import { serveSpa } from './static'
import './actions/system'
import './actions/project'
import './actions/template'
import './actions/deck'
import './actions/reconcile'
import './actions/slide'
import './actions/user'
import './actions/seed-asset'
import './actions/quiz'
import './actions/export'
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

export const createApp = (): Express => {
  const app = express()
  app.use(express.json())
  app.use(cookieParser())

  const api = Router()
  api.use(healthRouter)
  api.use(configRouter)
  api.use('/auth', authRouter)
  api.use('/auth', googleConnectRouter)
  api.use('/admin', adminRouter)
  api.use(actionsRouter)
  api.use(decksRouter)
  api.use(usersRouter)
  api.use(seedAssetsRouter)
  api.use(slidesRouter)
  api.use(filesRouter)
  api.use(ttsRouter)
  app.use('/api', api)

  if (env.NODE_ENV === 'production') {
    serveSpa(app, env.CLIENT_DIST)
  }

  // Must be registered last; Express 5 forwards rejected async handlers here
  app.use(errorHandler)

  return app
}
