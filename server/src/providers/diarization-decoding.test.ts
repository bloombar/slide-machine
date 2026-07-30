/**
 * Unit tests for the Google Cloud diarization adapter's audio handling.
 *
 * Recordings are stored as raw LINEAR16 (`.pcm`) because a WAV header must
 * state a length that streaming cannot know up front. Headerless audio carries
 * no format, so the adapter has to tell BatchRecognize what it is — and must
 * keep auto-decoding the `.wav` recordings retained before that change, until
 * they age out. Getting this wrong fails only against the live service, on
 * audio that is already unrecoverable, so it is pinned here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const audio = vi.hoisted(() => ({ body: Buffer.alloc(64, 7) }))
vi.mock('../storage', () => ({
  getStorage: () => ({ get: () => Promise.resolve(audio.body) }),
}))

const gcs = vi.hoisted(() => ({
  saved: [] as { contentType?: string }[],
  names: [] as string[],
  deletes: 0,
}))
vi.mock('@google-cloud/storage', () => ({
  Storage: vi.fn(function () {
    return {
      bucket: () => ({
        file: (name: string) => {
          gcs.names.push(name)
          return {
            save: (_body: Buffer, opts: { contentType?: string }) => {
              gcs.saved.push(opts)
              return Promise.resolve()
            },
            // The adapter removes its temp GCS copy once the job is done.
            delete: () => {
              gcs.deletes++
              return Promise.resolve()
            },
          }
        },
      }),
    }
  }),
}))

const speech = vi.hoisted(() => ({
  requests: [] as { config?: Record<string, unknown> }[],
}))
// The adapter uses the v2 BatchRecognize client (`import { v2 } from ...`).
vi.mock('@google-cloud/speech', () => ({
  v2: {
    SpeechClient: vi.fn(function () {
      return {
        batchRecognize: (req: { config?: Record<string, unknown> }) => {
          speech.requests.push(req)
          return Promise.resolve([
            { promise: () => Promise.resolve([{ results: {} }]) },
          ])
        },
      }
    }),
  },
}))

// A plain stand-in rather than importOriginal: the real module parses the
// environment at import and exits the process when it does not validate, which
// a unit test has no business depending on.
vi.mock('../config/env', () => ({
  env: {
    GCS_AUDIO_BUCKET: 'bucket',
    DIARIZATION_LOCATION: 'us',
    STORAGE_PROVIDER: 'local',
  },
}))

vi.mock('./google-cloud-transcription', () => ({
  speechClientOptions: () => ({ projectId: 'test-project' }),
}))

const { GoogleCloudDiarizationProvider } =
  await import('./google-cloud-diarization')

beforeEach(() => {
  gcs.saved = []
  gcs.names = []
  gcs.deletes = 0
  speech.requests = []
})

const diarizeKey = async (audioKey: string, sampleRate = 16_000) => {
  const provider = new GoogleCloudDiarizationProvider()
  await provider.diarize({ audioKey, sampleRate })
  return {
    config: speech.requests[0]?.config as Record<string, unknown> | undefined,
    saved: gcs.saved[0],
    name: gcs.names[0],
  }
}

describe('diarization audio decoding', () => {
  it('states the format explicitly for a raw .pcm recording', async () => {
    const { config, saved } = await diarizeKey('audio/deck/take.pcm', 16_000)
    expect(config?.explicitDecodingConfig).toEqual({
      encoding: 'LINEAR16',
      sampleRateHertz: 16_000,
      audioChannelCount: 1,
    })
    // Auto-decoding a headerless blob would leave the service guessing.
    expect(config?.autoDecodingConfig).toBeUndefined()
    expect(saved?.contentType).toBe('audio/L16')
    // The GCS copy is a temp working file and is removed again.
    expect(gcs.deletes).toBe(1)
  })

  it('carries the recording capture rate, not a default', async () => {
    const { config } = await diarizeKey('audio/deck/take.pcm', 48_000)
    expect(
      (config?.explicitDecodingConfig as { sampleRateHertz: number })
        .sampleRateHertz,
    ).toBe(48_000)
  })

  it('still auto-decodes a legacy .wav recording', async () => {
    // Retained before the format change; it describes itself.
    const { config, saved, name } = await diarizeKey('audio/deck/old.wav')
    expect(config?.autoDecodingConfig).toEqual({})
    expect(config?.explicitDecodingConfig).toBeUndefined()
    expect(saved?.contentType).toBe('audio/wav')
    expect(name).toMatch(/\.wav$/)
  })

  it('names the temp GCS object for the format it holds', async () => {
    const { name } = await diarizeKey('audio/deck/take.pcm')
    expect(name).toMatch(/\.pcm$/)
  })
})
