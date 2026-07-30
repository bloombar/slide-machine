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
import {
  getStorage,
  UPLOAD_MEMORY_WINDOW_BYTES,
  type UploadStream,
} from '../storage'
import { DeckModel, loadDeckAcl } from '../models/deck'
import { canEditAcl } from '../lib/access'
import { pcmBytesDurationMs } from '../lib/wav'
import {
  canStartRetention,
  releaseRetentionBytes,
  reserveRetentionBytes,
} from './retention-budget'

/** Path the client connects to; scoped so other upgrades are ignored. */
const STT_PATH = '/api/stt'

/** Cap on how much audio ONE session may store, from
 * AUDIO_RETENTION_MAX_SESSION_MB (default 300 MB ≈ 1 h 49 min at the default
 * 24 kHz capture rate, ≈ 55 min if a client streams 48 kHz); 0 disables it.
 *
 * Since audio streams to storage rather than accumulating here, this is a
 * STORAGE-COST cap, not a memory guard — a long session no longer costs memory
 * proportional to its length. Past it the recording is truncated and
 * transcription continues. See ./retention-budget for the memory ceiling.
 * Read per call so a test (or a restart-free config change) takes effect. */
const maxRetainedBytes = (): number =>
  env.AUDIO_RETENTION_MAX_SESSION_MB * 1024 * 1024

/** Ceiling on audio buffered while the deck's edit check is still resolving.
 * Nothing may be uploaded before that answer arrives, so these frames are held
 * — briefly, and boundedly: a slow database must degrade retention, not the
 * process. ~11 s of 24 kHz audio. */
const MAX_PENDING_BYTES = 512 * 1024

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

/** One recording, streamed to storage as it arrives. */
interface Retention {
  deckId: string
  sessionId: string
  sampleRate: number
  /** Storage key; `.pcm` because the container cannot be written up front. */
  audioKey: string
  /** Bytes handed to the upload — the recording's length. */
  bytes: number
  /** Open once the edit check passes; null while it runs, and forever if it
   * fails or retention is capped. */
  upload: UploadStream | null
  /** Frames that arrived before the edit check answered. */
  pending: Buffer[]
  pendingBytes: number
  /** Set when this session stops copying audio (cap, back-pressure, denial, or
   * an upload error). Transcription is never affected. */
  capped: boolean
  /** True once the upload must not be completed — the audio is discarded. */
  discard: boolean
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

  /** Stops copying audio for this session, once, with a reason. Transcription,
   * generation, and the transcript are never affected — only the recording. */
  const capRetention = (r: Retention, reason: string): void => {
    if (r.capped) return
    r.capped = true
    r.pending = []
    r.pendingBytes = 0
    console.warn(
      `Audio retention stopped for deck ${r.deckId} (${reason}); ` +
        'keeping transcription, dropping the rest of the audio.',
    )
  }

  /** Hands one frame to the open upload, honouring the storage cap and
   * back-pressure. `write` returning false still accepts the frame — it means
   * the consumer is behind, so we count this one and stop after it. */
  const writeFrame = (r: Retention, data: Buffer): void => {
    if (!r.upload) return
    const cap = maxRetainedBytes()
    if (cap !== 0 && r.bytes + data.length > cap) {
      capRetention(r, 'per-session storage cap reached')
      return
    }
    const accepted = r.upload.write(data)
    r.bytes += data.length
    if (!accepted) capRetention(r, 'upload could not keep up')
  }

  // Starts streaming session audio to storage when retention is enabled and the
  // client named a deck + recording. Frames that arrive before the deck's edit
  // check answers are held briefly (bounded) rather than uploaded, because once
  // bytes leave for the bucket they cannot be un-sent.
  const beginRetention = (start: StartMessage): void => {
    if (!env.AUDIO_RETENTION_ENABLED || !start.deckId || !start.sessionId)
      return
    // Process-wide ceiling: with the budget already committed to other live
    // sessions, this one transcribes without retaining rather than pushing the
    // process toward an OOM kill.
    if (
      !canStartRetention() ||
      !reserveRetentionBytes(UPLOAD_MEMORY_WINDOW_BYTES)
    ) {
      console.warn(
        `Audio retention budget exhausted; deck ${start.deckId} will ` +
          'transcribe without retaining audio.',
      )
      return
    }
    const r: Retention = {
      deckId: start.deckId,
      sessionId: start.sessionId,
      sampleRate: start.sampleRate ?? 16_000,
      // Raw LINEAR16, not WAV: a 44-byte header must state the total length,
      // which is unknowable until the lecture ends. sampleRate on the recording
      // is what readers use instead (GEN-4 Phase 4).
      audioKey: `audio/${start.deckId}/${randomUUID()}.pcm`,
      bytes: 0,
      upload: null,
      pending: [],
      pendingBytes: 0,
      capped: false,
      discard: false,
    }
    retain = r

    void (async () => {
      const allowed = await canEditDeck(r.deckId, userId)
      // The session may have ended while the check ran.
      if (retain !== r) return
      if (!allowed) {
        r.discard = true
        capRetention(r, 'user may not edit this lecture')
        return
      }
      let opened
      try {
        opened = await getStorage().createUploadStream(r.audioKey, 'audio/L16')
      } catch (error) {
        console.error('Audio retention: could not open the upload:', error)
        r.discard = true
        capRetention(r, 'storage unavailable')
        return
      }
      if (retain !== r) {
        // Ended while the upload was opening — never leave it dangling.
        await opened.abort().catch(() => {})
        return
      }
      r.upload = opened
      for (const frame of r.pending) writeFrame(r, frame)
      r.pending = []
      r.pendingBytes = 0
    })()
  }

  // Completes the upload and records a reference on the deck — only if the
  // user may edit it and something was actually stored. Fire-and-forget on
  // close; any failure is logged and never disrupts the (already-ended)
  // session.
  const flushRetention = async (): Promise<void> => {
    const r = retain
    retain = null // flush at most once, even if close+error both fire
    if (!r) return
    try {
      // Never opened (denied, storage down, or ended before the edit check
      // answered): nothing reached the bucket, so there is nothing to undo.
      if (!r.upload) return
      if (r.discard || !r.bytes) {
        await r.upload.abort()
        return
      }
      await r.upload.done()
      await DeckModel.updateOne(
        { _id: r.deckId },
        {
          $push: {
            recordings: {
              sessionId: r.sessionId,
              audioKey: r.audioKey,
              sampleRate: r.sampleRate,
              durationMs: Math.round(pcmBytesDurationMs(r.bytes, r.sampleRate)),
              createdAt: new Date(),
            },
          },
        },
      )
      // A later phase copies this audio to GCS (gs://) here and sets the
      // recording's gcsUri — Google BatchRecognize reads only from GCS.
    } catch (error) {
      console.error('Audio retention failed:', error)
      // A half-uploaded object must not survive as a truncated recording, and
      // its parts must not linger.
      await r.upload?.abort().catch(() => {})
    } finally {
      // The reservation covers this upload's in-flight window, so it is held
      // until the upload has finished (or been abandoned) and the memory is
      // genuinely gone. In a finally so no path can leak the budget.
      releaseRetentionBytes(UPLOAD_MEMORY_WINDOW_BYTES)
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
      // Tee a copy to the retention upload. Nothing accumulates here: frames
      // go straight out, except the few held while the edit check resolves.
      if (retain && !retain.capped) {
        if (retain.upload) {
          writeFrame(retain, Buffer.from(data))
        } else if (retain.pendingBytes + data.length > MAX_PENDING_BYTES) {
          capRetention(retain, 'edit check too slow')
        } else {
          retain.pending.push(Buffer.from(data))
          retain.pendingBytes += data.length
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
