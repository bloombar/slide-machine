/**
 * Server entry point: validate config, connect to MongoDB, start listening.
 * A failed Mongo connection is logged but does not abort startup — the
 * health endpoint reports "degraded" until the database is reachable.
 */
import { env } from './config/env'
import { connectMongo } from './db/mongoose'
import { createApp } from './app'
import { reportListen } from './lib/listen'
import { attachAudioSocket } from './ws/audio-socket'
import { startAudioRetentionSweep } from './jobs/audio-cleanup'
import { startSoftDeletePurgeSweep } from './jobs/soft-delete-purge'
import { startCostRollupSweep } from './jobs/cost-rollup'
import { startDeckViewPurgeSweep } from './jobs/deck-view-purge'
import { startTemplateVersionBackfill } from './jobs/pin-template-versions'

const main = async (): Promise<void> => {
  try {
    await connectMongo(env.MONGODB_URI)
    console.log('Connected to MongoDB')
  } catch (error) {
    console.error('MongoDB connection failed (continuing degraded):', error)
  }

  const app = createApp()
  // Express 5 reuses this callback for bind errors, so it must inspect its
  // argument — see lib/listen.
  const server = app.listen(env.PORT, (error?: Error) => {
    reportListen(error, env.PORT, env.NODE_ENV, env.TRUST_PROXY_HOPS)
  })
  // Real-time STT rides a WebSocket on the same server (SPEC CAP-3).
  attachAudioSocket(server)
  // Daily purge of retained lecture audio past AUDIO_RETENTION_DAYS (GEN-4).
  startAudioRetentionSweep()
  // Daily purge of soft-deleted records past DELETED_DATA_RETENTION_DAYS (P-11).
  startSoftDeletePurgeSweep()
  // Bounds the cost ledger: roll complete old months up, drop the rows behind
  // them (BILL-7/P-11).
  startCostRollupSweep()
  // Bounds the view records: drop lecture openings past
  // DECK_VIEW_RETENTION_DAYS (EVAL-7/P-11).
  startDeckViewPurgeSweep()
  // Pin any lecture that predates template versions, so a template edit stops
  // reaching into it (TMPL-11). No-op once every lecture is pinned.
  startTemplateVersionBackfill()
}

main()
