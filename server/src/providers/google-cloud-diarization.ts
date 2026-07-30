/**
 * Google Cloud batch diarization adapter (GEN-4 Phase 3). Real-time streaming
 * can't diarize, so a retained recording is diarized after the lecture with
 * Speech-to-Text v2 `BatchRecognize` (Chirp 3 + `SpeakerDiarizationConfig`),
 * which reads audio from GCS only. Flow: pull the WAV from blob storage → copy
 * it to the GCS bucket → run the batch job (inline results) → group the
 * per-word speaker labels into intervals → delete the GCS copy.
 *
 * Reuses the STT service account (speechClientOptions). Requires
 * GCS_AUDIO_BUCKET; without it (or without audio) diarize() returns [] so the
 * reconciliation pass simply leaves segments untagged rather than failing.
 *
 * NOTE: not yet validated against the live API — the request/response field
 * shapes below (recognizer `_`, model `chirp_3`, features.diarizationConfig,
 * WordInfo.speakerLabel + startOffset/endOffset) follow the v2 docs and must be
 * confirmed on the first real run.
 */
import { randomUUID } from 'node:crypto'
import { v2 } from '@google-cloud/speech'
import { Storage } from '@google-cloud/storage'
import type {
  DiarizationInput,
  DiarizationProvider,
  DiarizedSpeakerSegment,
  HealthComponent,
} from '@slide-machine/shared'
import { env } from '../config/env'
import { getStorage } from '../storage'
import { registry } from './registry'
import { speechClientOptions } from './google-cloud-transcription'

/** A protobuf Duration as the client surfaces it (seconds may be a string). */
interface GoogleDuration {
  seconds?: number | string
  nanos?: number
}
const durationToMs = (d?: GoogleDuration | null): number => {
  if (!d) return 0
  const seconds = typeof d.seconds === 'string' ? Number(d.seconds) : d.seconds
  return (seconds ?? 0) * 1000 + (d.nanos ?? 0) / 1e6
}

/** One diarized word from the v2 batch response. */
interface BatchWord {
  startOffset?: GoogleDuration | null
  endOffset?: GoogleDuration | null
  speakerLabel?: string | null
}

/** Minimal shape of the inline v2 BatchRecognize response we read. */
interface BatchResponse {
  results?: Record<
    string,
    {
      transcript?: {
        results?: { alternatives?: { words?: BatchWord[] }[] }[]
      }
    }
  >
}

/** Maps the v2 string speaker label to a stable number (first-seen order). */
const speakerNumberer = (): ((label: string | null | undefined) => number) => {
  const seen = new Map<string, number>()
  return label => {
    const key = label ?? ''
    const digits = /\d+/.exec(key)?.[0]
    if (digits) return Number(digits)
    if (!seen.has(key)) seen.set(key, seen.size + 1)
    return seen.get(key)!
  }
}

/**
 * Collapses a time-ordered word stream into one interval per maximal run of the
 * same speaker: `[{speaker, startMs, endMs}, …]` — what the time-join expects.
 */
export const wordsToSpeakerSegments = (
  words: BatchWord[],
): DiarizedSpeakerSegment[] => {
  const numberOf = speakerNumberer()
  const timed = words
    .map(w => ({
      speaker: numberOf(w.speakerLabel),
      startMs: durationToMs(w.startOffset),
      endMs: durationToMs(w.endOffset),
    }))
    .sort((a, b) => a.startMs - b.startMs)

  const out: DiarizedSpeakerSegment[] = []
  for (const w of timed) {
    const last = out[out.length - 1]
    if (last && last.speaker === w.speaker)
      last.endMs = Math.max(last.endMs, w.endMs)
    else out.push({ speaker: w.speaker, startMs: w.startMs, endMs: w.endMs })
  }
  return out
}

export class GoogleCloudDiarizationProvider implements DiarizationProvider {
  readonly name = 'google-cloud'
  private speech: v2.SpeechClient | null = null
  private storage: Storage | null = null

  private clients(): { speech: v2.SpeechClient; storage: Storage } {
    if (!this.speech || !this.storage) {
      const options = speechClientOptions()
      this.speech = new v2.SpeechClient({
        ...options,
        apiEndpoint: `${env.DIARIZATION_LOCATION}-speech.googleapis.com`,
      })
      // Same service account; the two clients share the credentials/projectId
      // shape even though their option types are nominally distinct.
      this.storage = new Storage(
        options as ConstructorParameters<typeof Storage>[0],
      )
    }
    return { speech: this.speech, storage: this.storage }
  }

  async diarize(input: DiarizationInput): Promise<DiarizedSpeakerSegment[]> {
    const bucket = env.GCS_AUDIO_BUCKET
    if (!bucket) {
      console.warn('Diarization: GCS_AUDIO_BUCKET unset; skipping')
      return []
    }
    const audio = await getStorage().get(input.audioKey)
    if (!audio) {
      console.warn(`Diarization: audio ${input.audioKey} not found; skipping`)
      return []
    }
    // Recordings are raw LINEAR16 (`.pcm`) — a WAV header cannot be written
    // while streaming, since it must state a length known only at the end.
    // Headerless audio carries no format, so state it explicitly; legacy `.wav`
    // recordings still describe themselves and keep auto-decoding until they
    // age out (AUDIO_RETENTION_DAYS).
    const isWav = input.audioKey.endsWith('.wav')

    const options = speechClientOptions()
    const projectId = (options as { projectId?: string }).projectId
    if (!projectId) {
      console.warn('Diarization: no project id in credentials; skipping')
      return []
    }

    const { speech, storage } = this.clients()
    const objectName = `diarize/${randomUUID()}${isWav ? '.wav' : '.pcm'}`
    const gcsUri = `gs://${bucket}/${objectName}`
    const file = storage.bucket(bucket).file(objectName)
    try {
      await file.save(audio, {
        contentType: isWav ? 'audio/wav' : 'audio/L16',
      })

      const recognizer = `projects/${projectId}/locations/${env.DIARIZATION_LOCATION}/recognizers/_`
      const [operation] = await speech.batchRecognize({
        recognizer,
        config: {
          model: 'chirp_3',
          languageCodes: [input.languageCode ?? 'en-US'],
          // A WAV describes itself; raw PCM does not, so hand the service the
          // format the capture actually used.
          ...(isWav
            ? { autoDecodingConfig: {} }
            : {
                explicitDecodingConfig: {
                  encoding: 'LINEAR16' as const,
                  sampleRateHertz: input.sampleRate,
                  audioChannelCount: 1,
                },
              }),
          features: {
            // An (empty) diarization config enables speaker labels; word time
            // offsets are opt-in and are what the time-join needs.
            diarizationConfig: { minSpeakerCount: 1, maxSpeakerCount: 6 },
            enableWordTimeOffsets: true,
          },
        },
        files: [{ uri: gcsUri }],
        // Inline results come back in the operation response — no output bucket.
        recognitionOutputConfig: { inlineResponseConfig: {} },
      })
      const [response] = await operation.promise()

      const fileResult = (response as BatchResponse).results?.[gcsUri]
      const words = (fileResult?.transcript?.results ?? []).flatMap(
        r => r.alternatives?.[0]?.words ?? [],
      )
      return wordsToSpeakerSegments(words)
    } catch (error) {
      console.error('Diarization batch job failed:', error)
      return []
    } finally {
      // Best-effort cleanup of the transient GCS copy.
      await file.delete().catch(() => {})
    }
  }
}

/**
 * Health probe for the GCS bucket batch diarization stages audio in (GEN-4),
 * shown beside the general Storage item in the footer badge. Without a bucket
 * configured it reads `disabled` — retained audio simply stays in the general
 * (local or blob) storage — mirroring how the Storage item names local vs
 * connected. With one configured it's a cheap bucket-exists check; never throws,
 * so a failure reads `down`.
 */
export const pingGcsAudioStorage = async (): Promise<HealthComponent> => {
  const bucket = env.GCS_AUDIO_BUCKET
  if (!bucket) {
    return {
      status: 'disabled',
      detail:
        env.STORAGE_PROVIDER === 'local' ? 'local storage' : 'blob storage',
    }
  }
  try {
    const storage = new Storage(
      speechClientOptions() as ConstructorParameters<typeof Storage>[0],
    )
    // Probe with an object list, NOT bucket.exists(): diarization only ever
    // stages and deletes objects, and the staging service account typically has
    // just object-level access — bucket.exists() needs storage.buckets.get,
    // which such an account lacks, so it would 403 and read as a false
    // 'unreachable' even though the bucket works. Listing one object exercises
    // the access the app actually uses and stays read-only.
    await storage
      .bucket(bucket)
      .getFiles({ maxResults: 1, autoPaginate: false })
    return { status: 'ok', detail: 'connected' }
  } catch (err) {
    // A missing bucket is a real misconfiguration; anything else (network, auth)
    // is a generic outage. Both keep audio-only, so overall health is degraded.
    const code = (err as { code?: number }).code
    return code === 404
      ? { status: 'down', detail: 'bucket missing' }
      : { status: 'down', detail: 'unreachable' }
  }
}

registry.register(
  'diarization',
  'google-cloud',
  () => new GoogleCloudDiarizationProvider(),
)
