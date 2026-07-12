/**
 * Builds the Express application. Kept listen-free so integration tests
 * can exercise it with supertest; src/index.ts owns startup.
 */
import express, { Router, type Express } from 'express'
import cookieParser from 'cookie-parser'
import { env } from './config/env'
import { healthRouter } from './routes/health'
import { authRouter } from './routes/auth'
import { actionsRouter } from './routes/actions'
import { decksRouter } from './routes/decks'
import { usersRouter } from './routes/users'
import { seedAssetsRouter } from './routes/seed-assets'
import { filesRouter } from './routes/files'
import { errorHandler } from './middleware/error'
import { serveSpa } from './static'
import './actions/system'
import './actions/project'
import './actions/template'
import './actions/deck'
import './actions/slide'
import './actions/user'
import './actions/seed-asset'
import './providers/mock-generation'

export const createApp = (): Express => {
  const app = express()
  app.use(express.json())
  app.use(cookieParser())

  const api = Router()
  api.use(healthRouter)
  api.use('/auth', authRouter)
  api.use(actionsRouter)
  api.use(decksRouter)
  api.use(usersRouter)
  api.use(seedAssetsRouter)
  api.use(filesRouter)
  app.use('/api', api)

  if (env.NODE_ENV === 'production') {
    serveSpa(app, env.CLIENT_DIST)
  }

  // Must be registered last; Express 5 forwards rejected async handlers here
  app.use(errorHandler)

  return app
}
