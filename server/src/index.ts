/**
 * Server entry point: validate config, connect to MongoDB, start listening.
 * A failed Mongo connection is logged but does not abort startup — the
 * health endpoint reports "degraded" until the database is reachable.
 */
import { env } from './config/env'
import { connectMongo } from './db/mongoose'
import { createApp } from './app'
import { attachAudioSocket } from './ws/audio-socket'
import { startAudioRetentionSweep } from './jobs/audio-cleanup'
import { startSoftDeletePurgeSweep } from './jobs/soft-delete-purge'

const main = async (): Promise<void> => {
  try {
    await connectMongo(env.MONGODB_URI)
    console.log('Connected to MongoDB')
  } catch (error) {
    console.error('MongoDB connection failed (continuing degraded):', error)
  }

  const app = createApp()
  const server = app.listen(env.PORT, () => {
    console.log(
      `Slide Machine server listening on port ${env.PORT} (${env.NODE_ENV})`,
    )
  })
  // Real-time STT rides a WebSocket on the same server (SPEC CAP-3).
  attachAudioSocket(server)
  // Daily purge of retained lecture audio past AUDIO_RETENTION_DAYS (GEN-4).
  startAudioRetentionSweep()
  // Daily purge of soft-deleted records past DELETED_DATA_RETENTION_DAYS (P-11).
  startSoftDeletePurgeSweep()
}

main()
