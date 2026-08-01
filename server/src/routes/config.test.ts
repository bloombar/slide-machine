/**
 * Unit tests for GET /api/config: the public runtime switches the client reads
 * at boot — the speech engine, whether TTS is usable, and the simulated-speech
 * debug flag — come straight from the server's environment.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

// A mutable stand-in for the validated env, so each test can flip one switch.
const envState = {
  TRANSCRIPTION_PROVIDER: 'browser',
  TTS_PROVIDER: 'none',
  TRANSLATION_PROVIDER: 'none',
  GOOGLE_CLOUD_TTS_KEY: undefined as string | undefined,
  GOOGLE_CLOUD_TRANSLATION_KEY: undefined as string | undefined,
  REFINE_SLIDES_DEFAULT_LEVEL: 2,
  REFINE_TRANSCRIPT_DEFAULT_LEVEL: 2,
  SIMULATED_SPEECH_ENABLED: false,
  WHITEBOARD_SUPPRESS_DEBOUNCE_MS: 5000,
  STT_CAPTURE_SAMPLE_RATE: 24000,
}
vi.mock('../config/env', () => ({ env: envState }))
vi.mock('../lib/transcribe-audio', () => ({
  serverTranscriptionAvailable: () => false,
}))

const { configRouter } = await import('./config')

const app = express().use('/api', configRouter)
const getConfig = async () => (await request(app).get('/api/config')).body

beforeEach(() => {
  envState.SIMULATED_SPEECH_ENABLED = false
  envState.TTS_PROVIDER = 'none'
  envState.TRANSLATION_PROVIDER = 'none'
  envState.GOOGLE_CLOUD_TRANSLATION_KEY = undefined
  envState.STT_CAPTURE_SAMPLE_RATE = 24000
})

describe('GET /api/config', () => {
  it('reports the engine and defaults, with the debug flag off', async () => {
    expect(await getConfig()).toEqual({
      sttEngine: 'browser',
      ttsEnabled: false,
      refineSlidesDefaultLevel: 2,
      refineTranscriptDefaultLevel: 2,
      simulatedSpeechEnabled: false,
      whiteboardSuppressDebounceMs: 5000,
      sttCaptureSampleRate: 24000,
      translationEnabled: false,
    })
  })

  // The client downsamples mic audio to this rate, so a server can trade
  // retained-audio fidelity against bandwidth and storage without a rebuild.
  it('publishes the configured capture sample rate', async () => {
    envState.STT_CAPTURE_SAMPLE_RATE = 48000
    expect(await getConfig()).toMatchObject({ sttCaptureSampleRate: 48000 })
  })

  // 0 means "no downsampling"; it has to survive to the client verbatim, since
  // that is where the decision to skip the conversion is made.
  it('publishes 0 unchanged when downsampling is off', async () => {
    envState.STT_CAPTURE_SAMPLE_RATE = 0
    expect(await getConfig()).toMatchObject({ sttCaptureSampleRate: 0 })
  })

  // The typed-phrase box in a live session is a debugging aid; a server opts in.
  it('turns the simulated-speech box on when the env var is set', async () => {
    envState.SIMULATED_SPEECH_ENABLED = true
    expect(await getConfig()).toMatchObject({ simulatedSpeechEnabled: true })
  })

  it('reports TTS as usable once a provider is configured', async () => {
    envState.TTS_PROVIDER = 'mock'
    expect(await getConfig()).toMatchObject({ ttsEnabled: true })
  })

  // The viewer's slide-language switcher is hidden unless translation can
  // actually run, so this flag gates a control rather than just describing one.
  it('reports translation as usable once a provider is configured', async () => {
    envState.TRANSLATION_PROVIDER = 'mock'
    expect(await getConfig()).toMatchObject({ translationEnabled: true })
  })

  it('reports translation as unusable when Google has no key', async () => {
    envState.TRANSLATION_PROVIDER = 'google-cloud'
    expect(await getConfig()).toMatchObject({ translationEnabled: false })
  })

  it('reports translation as usable once the Google key is set', async () => {
    envState.TRANSLATION_PROVIDER = 'google-cloud'
    envState.GOOGLE_CLOUD_TRANSLATION_KEY = 'translate-key'
    expect(await getConfig()).toMatchObject({ translationEnabled: true })
  })
})
