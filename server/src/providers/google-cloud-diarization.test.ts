/**
 * Unit tests for the Google Cloud batch diarizer's pure parsing
 * (wordsToSpeakerSegments) and its no-op guard when GCS is unconfigured. The
 * live BatchRecognize/GCS round-trip is validated separately on a real run.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// A developer's local .env may set GCS_AUDIO_BUCKET/credentials, so pin the env
// fields the probe reads (mutable per test) and stub the GCS client — the probe
// must be exercised deterministically without touching a real bucket.
const { envOverride, getFilesMock } = vi.hoisted(() => ({
  envOverride: {
    GCS_AUDIO_BUCKET: undefined as string | undefined,
    STORAGE_PROVIDER: 'local' as 'local' | 's3',
  },
  getFilesMock: vi.fn(),
}))

vi.mock('../config/env', async importActual => {
  const actual = await importActual<typeof import('../config/env')>()
  // A plain copy with getters for the two overridden fields, so each test's
  // mutation is read live (the real env object is frozen and can't be proxied).
  return {
    ...actual,
    env: {
      ...actual.env,
      get GCS_AUDIO_BUCKET() {
        return envOverride.GCS_AUDIO_BUCKET
      },
      get STORAGE_PROVIDER() {
        return envOverride.STORAGE_PROVIDER
      },
    },
  }
})

vi.mock('@google-cloud/storage', () => ({
  Storage: class {
    bucket() {
      return {
        getFiles: getFilesMock,
        file: () => ({
          save: vi.fn(),
          delete: vi.fn().mockResolvedValue(null),
        }),
      }
    }
  },
}))

import {
  wordsToSpeakerSegments,
  GoogleCloudDiarizationProvider,
  pingGcsAudioStorage,
} from './google-cloud-diarization'

beforeEach(() => {
  envOverride.GCS_AUDIO_BUCKET = undefined
  envOverride.STORAGE_PROVIDER = 'local'
  getFilesMock.mockReset()
})

/** A protobuf Duration for `seconds` seconds. */
const dur = (seconds: number) => ({
  seconds: Math.floor(seconds),
  nanos: Math.round((seconds - Math.floor(seconds)) * 1e9),
})

describe('wordsToSpeakerSegments', () => {
  it('collapses consecutive same-speaker words into intervals', () => {
    const words = [
      { speakerLabel: '1', startOffset: dur(0), endOffset: dur(1) },
      { speakerLabel: '1', startOffset: dur(1), endOffset: dur(2) },
      { speakerLabel: '2', startOffset: dur(2), endOffset: dur(3) },
      { speakerLabel: '1', startOffset: dur(3), endOffset: dur(4) },
    ]
    expect(wordsToSpeakerSegments(words)).toEqual([
      { speaker: 1, startMs: 0, endMs: 2000 },
      { speaker: 2, startMs: 2000, endMs: 3000 },
      { speaker: 1, startMs: 3000, endMs: 4000 },
    ])
  })

  it('numbers non-numeric speaker labels in first-seen order', () => {
    const words = [
      { speakerLabel: 'speaker_A', startOffset: dur(0), endOffset: dur(1) },
      { speakerLabel: 'speaker_B', startOffset: dur(1), endOffset: dur(2) },
      { speakerLabel: 'speaker_A', startOffset: dur(2), endOffset: dur(3) },
    ]
    expect(wordsToSpeakerSegments(words).map(s => s.speaker)).toEqual([1, 2, 1])
  })

  it('sorts words by start time before grouping', () => {
    const words = [
      { speakerLabel: '1', startOffset: dur(2), endOffset: dur(3) },
      { speakerLabel: '1', startOffset: dur(0), endOffset: dur(1) },
    ]
    expect(wordsToSpeakerSegments(words)).toEqual([
      { speaker: 1, startMs: 0, endMs: 3000 },
    ])
  })

  it('returns nothing for no words', () => {
    expect(wordsToSpeakerSegments([])).toEqual([])
  })
})

describe('GoogleCloudDiarizationProvider.diarize', () => {
  it('is a no-op (returns []) when GCS_AUDIO_BUCKET is unconfigured', async () => {
    // The test env sets no GCS bucket, so diarize bails before any Google call.
    const provider = new GoogleCloudDiarizationProvider()
    expect(
      await provider.diarize({ audioKey: 'audio/x.wav', sampleRate: 16_000 }),
    ).toEqual([])
  })
})

describe('pingGcsAudioStorage', () => {
  it('reports disabled with the storage fallback when no GCS bucket is set', async () => {
    // No GCS_AUDIO_BUCKET: audio stays in the general store — the local disk
    // here, or blob storage when that is the provider.
    expect(await pingGcsAudioStorage()).toEqual({
      status: 'disabled',
      detail: 'local storage',
    })
    envOverride.STORAGE_PROVIDER = 's3'
    expect(await pingGcsAudioStorage()).toEqual({
      status: 'disabled',
      detail: 'blob storage',
    })
    expect(getFilesMock).not.toHaveBeenCalled()
  })

  it('reports connected when an object list succeeds', async () => {
    envOverride.GCS_AUDIO_BUCKET = 'audio-bucket'
    getFilesMock.mockResolvedValue([[]])
    expect(await pingGcsAudioStorage()).toEqual({
      status: 'ok',
      detail: 'connected',
    })
    // Probes via a read-only object list, never bucket.exists().
    expect(getFilesMock).toHaveBeenCalledWith({
      maxResults: 1,
      autoPaginate: false,
    })
  })

  it('reports connected despite a bucket-metadata 403 (object access is enough)', async () => {
    // The staging service account has object access but not storage.buckets.get;
    // an object list still succeeds, so the bucket is usable and reads connected.
    envOverride.GCS_AUDIO_BUCKET = 'audio-bucket'
    getFilesMock.mockResolvedValue([[]])
    expect((await pingGcsAudioStorage()).status).toBe('ok')
  })

  it('reports bucket missing on a 404', async () => {
    envOverride.GCS_AUDIO_BUCKET = 'ghost-bucket'
    getFilesMock.mockRejectedValue(
      Object.assign(new Error('no bucket'), { code: 404 }),
    )
    expect(await pingGcsAudioStorage()).toEqual({
      status: 'down',
      detail: 'bucket missing',
    })
  })

  it('reports unreachable on any other failure', async () => {
    envOverride.GCS_AUDIO_BUCKET = 'audio-bucket'
    getFilesMock.mockRejectedValue(
      Object.assign(new Error('network'), { code: 500 }),
    )
    expect(await pingGcsAudioStorage()).toEqual({
      status: 'down',
      detail: 'unreachable',
    })
  })
})
