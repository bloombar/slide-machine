/**
 * WebSocket audio transport for real-time speech-to-text (SPEC CAP-3).
 * The browser streams mic PCM here; this relays it to the active
 * TranscriptionProvider and pushes interim/final transcripts back. It is a
 * pure transcription relay — final phrases reach the client exactly like the
 * browser engine's, so slide generation stays client-driven (session.phrase).
 *
 * Mounted on the raw http.Server (not the Express app) because a WebSocket
 * upgrade bypasses the middleware stack; auth is enforced on the handshake.
 */
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import type {
  TranscriptionProvider,
  TranscriptionStream,
} from '@slide-machine/shared'
import { verifyAccessToken } from '../auth/tokens'
import { registry } from '../providers/registry'
import { env } from '../config/env'
import { getStorage } from '../storage'
import { DeckModel, loadDeckAcl } from '../models/deck'
import { canEditAcl } from '../lib/access'
import { pcmToWav, pcmDurationMs } from '../lib/wav'

/** Path the client connects to; scoped so other upgrades are ignored. */
const STT_PATH = '/api/stt'

/** Cap on buffered retained audio per session (~300 MB ≈ 52 min at 48 kHz
 * mono); beyond it retention is abandoned so a marathon session can't grow
 * memory without bound. Transcription continues regardless. */
const MAX_RETAINED_BYTES = 300 * 1024 * 1024

/** First control message the client sends before any audio. */
interface StartMessage {
  type: 'start'
  languageCode?: string
  sampleRate?: number
  phraseHints?: string[]
  /** Target lecture + recording id, for audio retention (GEN-4 Phase 2). */
  deckId?: string
  sessionId?: string
}

/** Buffered audio for one recording, flushed to storage on close. */
interface Retention {
  deckId: string
  sessionId: string
  sampleRate: number
  chunks: Buffer[]
  bytes: number
  /** Whether the connecting user may edit the deck (checked once, async). */
  allowed: Promise<boolean>
  capped: boolean
}

/** True when the user can edit the deck the audio would attach to. */
const canEditDeck = async (
  deckId: string,
  userId: string,
): Promise<boolean> => {
  try {
    const deck = await DeckModel.findById(deckId)
    if (!deck) return false
    return canEditAcl(await loadDeckAcl(deck), userId)
  } catch {
    return false
  }
}

/** Rejects a WebSocket upgrade before it completes (browsers can't send an
 * Authorization header, so the access token rides in the ?token= query). */
const rejectUpgrade = (
  socket: Duplex,
  status: number,
  reason: string,
): void => {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\n\r\n`)
  socket.destroy()
}

/** Handles one authenticated connection: start message → provider stream →
 * audio in, transcripts out. */
const handleConnection = (ws: WebSocket, userId: string): void => {
  let stream: TranscriptionStream | null = null
  // Set once the client (or a socket close) ends the session, so we can tell a
  // provider-side failure apart from a normal stop.
  let stopped = false
  // Audio retention (GEN-4 Phase 2): populated on `start` when enabled and the
  // client named a deck + session; audio is buffered and flushed on close.
  let retain: Retention | null = null

  const send = (payload: object): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload))
  }

  // Begins buffering session audio when retention is enabled and the client
  // named a deck + recording. Access is verified in the background (its result
  // gates the flush), so no early audio is dropped while the check runs.
  const beginRetention = (start: StartMessage): void => {
    if (!env.AUDIO_RETENTION_ENABLED || !start.deckId || !start.sessionId)
      return
    retain = {
      deckId: start.deckId,
      sessionId: start.sessionId,
      sampleRate: start.sampleRate ?? 16_000,
      chunks: [],
      bytes: 0,
      allowed: canEditDeck(start.deckId, userId),
      capped: false,
    }
  }

  // Assembles the buffered PCM into a WAV, stores it, and records a reference
  // on the deck — only if the user may edit it. Fire-and-forget on close;
  // any failure is logged and never disrupts the (already-ended) session.
  const flushRetention = async (): Promise<void> => {
    const r = retain
    retain = null // flush at most once, even if close+error both fire
    if (!r || !r.bytes) return
    try {
      if (!(await r.allowed)) return
      const pcm = Buffer.concat(r.chunks)
      const wav = pcmToWav(pcm, r.sampleRate)
      const audioKey = `audio/${r.deckId}/${randomUUID()}.wav`
      await getStorage().put(audioKey, wav, 'audio/wav')
      await DeckModel.updateOne(
        { _id: r.deckId },
        {
          $push: {
            recordings: {
              sessionId: r.sessionId,
              audioKey,
              sampleRate: r.sampleRate,
              durationMs: Math.round(pcmDurationMs(pcm, r.sampleRate)),
              createdAt: new Date(),
            },
          },
        },
      )
      // Phase 3 copies this WAV to GCS (gs://) here and sets the recording's
      // gcsUri — Google BatchRecognize reads audio only from GCS.
    } catch (error) {
      console.error('Audio retention failed:', error)
    }
  }

  const begin = (start: StartMessage): void => {
    let provider: TranscriptionProvider
    try {
      provider = registry.get<TranscriptionProvider>('transcription')
    } catch {
      // browser/none modes register no adapter — nothing to stream to.
      send({ type: 'error', message: 'Speech engine is not available' })
      ws.close()
      return
    }
    try {
      stream = provider.startStream({
        languageCode: start.languageCode || 'en-US',
        sampleRateHertz: start.sampleRate,
        phraseHints: start.phraseHints,
      })
    } catch (error) {
      // A misconfigured adapter (e.g. missing/invalid credentials) must fail
      // this one connection, never crash the server for every other user.
      console.error('Failed to start transcription stream:', error)
      send({ type: 'error', message: 'Speech engine is not available' })
      ws.close()
      return
    }
    beginRetention(start)
    // Drain transcription events to the client until the stream completes.
    // If it completes without the client stopping, the provider failed
    // (logged server-side) — tell the client so the mic never looks live
    // while transcription is dead.
    void (async () => {
      for await (const event of stream.events) {
        // Forward word timings + confidence on finals so the client can carry
        // them into session.phrase (GEN-4 diarization groundwork). Include each
        // only when present, so the browser engine's plainer events are
        // unchanged and the wire stays minimal.
        send({
          type: event.isFinal ? 'final' : 'interim',
          text: event.text,
          ...(event.isFinal && typeof event.confidence === 'number'
            ? { confidence: event.confidence }
            : {}),
          ...(event.words?.length ? { words: event.words } : {}),
        })
      }
      if (!stopped) {
        send({ type: 'error', message: 'Transcription stopped unexpectedly' })
        ws.close()
      }
    })()
  }

  const finish = (): void => {
    stopped = true
    stream?.end()
    void flushRetention()
  }

  ws.on('message', (data: Buffer, isBinary: boolean) => {
    if (isBinary) {
      stream?.write(new Uint8Array(data))
      // Tee a copy for retention, until the per-session cap (logged once).
      if (retain) {
        if (retain.bytes + data.length > MAX_RETAINED_BYTES) {
          if (!retain.capped) {
            retain.capped = true
            console.warn(
              `Audio retention cap reached for deck ${retain.deckId}; ` +
                'keeping transcription, dropping the rest of the audio.',
            )
          }
        } else {
          retain.chunks.push(Buffer.from(data))
          retain.bytes += data.length
        }
      }
      return
    }
    let message: StartMessage | { type?: string }
    try {
      message = JSON.parse(data.toString()) as StartMessage
    } catch {
      return
    }
    if (message.type === 'start' && !stream) begin(message as StartMessage)
    else if (message.type === 'stop') finish()
  })

  ws.on('close', finish)
  ws.on('error', finish)
}

/**
 * Attaches the STT WebSocket endpoint to a running http.Server. Called from
 * the server entry point; integration tests attach it to their own server.
 */
export const attachAudioSocket = (server: Server): WebSocketServer => {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    if (url.pathname !== STT_PATH) return // not ours — leave it for others

    const token = url.searchParams.get('token')
    if (!token) return rejectUpgrade(socket, 401, 'Unauthorized')

    void verifyAccessToken(token)
      .then(({ userId }) => {
        wss.handleUpgrade(req, socket, head, ws => handleConnection(ws, userId))
      })
      .catch(() => rejectUpgrade(socket, 401, 'Unauthorized'))
  })

  return wss
}
