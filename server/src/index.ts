/**
 * Server entry point: validate config, connect to MongoDB, start listening.
 * A failed Mongo connection is logged but does not abort startup — the
 * health endpoint reports "degraded" until the database is reachable.
 */
import { env } from './config/env'
import { connectMongo } from './db/mongoose'
import { createApp } from './app'

const main = async (): Promise<void> => {
  try {
    await connectMongo(env.MONGODB_URI)
    console.log('Connected to MongoDB')
  } catch (error) {
    console.error('MongoDB connection failed (continuing degraded):', error)
  }

  const app = createApp()
  app.listen(env.PORT, () => {
    console.log(
      `Slide Machine server listening on port ${env.PORT} (${env.NODE_ENV})`,
    )
  })
}

main()
