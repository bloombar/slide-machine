/**
 * Builds the Express application. Kept listen-free so integration tests
 * can exercise it with supertest; src/index.ts owns startup.
 */
import express, { Router, type Express } from 'express'
import { env } from './config/env'
import { healthRouter } from './routes/health'
import { serveSpa } from './static'
import './actions/system'

export const createApp = (): Express => {
  const app = express()
  app.use(express.json())

  const api = Router()
  api.use(healthRouter)
  app.use('/api', api)

  if (env.NODE_ENV === 'production') {
    serveSpa(app, env.CLIENT_DIST)
  }

  return app
}
