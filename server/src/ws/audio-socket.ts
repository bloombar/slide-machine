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
import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import type {
  TranscriptionProvider,
  TranscriptionStream,
} from '@slide-machine/shared'
import { verifyAccessToken } from '../auth/tokens'
import { registry } from '../providers/registry'

/** Path the client connects to; scoped so other upgrades are ignored. */
const STT_PATH = '/api/stt'

/** First control message the client sends before any audio. */
interface StartMessage {
  type: 'start'
  languageCode?: string
  sampleRate?: number
  phraseHints?: string[]
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
const handleConnection = (ws: WebSocket): void => {
  let stream: TranscriptionStream | null = null
  // Set once the client (or a socket close) ends the session, so we can tell a
  // provider-side failure apart from a normal stop.
  let stopped = false

  const send = (payload: object): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload))
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
  }

  ws.on('message', (data: Buffer, isBinary: boolean) => {
    if (isBinary) {
      stream?.write(new Uint8Array(data))
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
      .then(() => {
        wss.handleUpgrade(req, socket, head, ws => handleConnection(ws))
      })
      .catch(() => rejectUpgrade(socket, 401, 'Unauthorized'))
  })

  return wss
}
