/**
 * GET /api/config — public runtime configuration the client reads at boot.
 * Exposes the active speech engine (TRANSCRIPTION_PROVIDER) so switching STT
 * is a single server flip with no client rebuild. No secrets belong here.
 */
import { Router } from 'express'
import type { RuntimeConfig, SttEngine } from '@slide-machine/shared'
import { env } from '../config/env'

export const configRouter = Router()

/**
 * Maps the transcription adapter name to the client's capture engine:
 * 'browser' and 'none' pass through; any other adapter ('google-cloud',
 * 'mock', a future 'whisper', …) uses the WebSocket streaming path.
 */
const sttEngine = (): SttEngine => {
  const provider = env.TRANSCRIPTION_PROVIDER
  if (provider === 'browser' || provider === 'none') return provider
  return 'google-cloud'
}

configRouter.get('/config', (_req, res) => {
  const body: RuntimeConfig = { sttEngine: sttEngine() }
  res.json(body)
})
