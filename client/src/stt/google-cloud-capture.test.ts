/**
 * Unit tests for the Google Cloud streaming capture: mic → AudioWorklet →
 * WebSocket wiring, transcript mapping (interim vs final), error/disconnect
 * surfacing, and idempotent teardown. All browser media/socket APIs are
 * stubbed; no real audio or network is used.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The auth module is mocked with a mutable in-memory token plus a stubbed
// refreshSession, so both the "signed out" and "stale token" paths are
// testable. Hoisted so the vi.mock factory can read them. Tokens are minimal
// URL-safe JWTs carrying only an `exp` claim — the capture reads exp to decide
// whether to refresh before opening the socket.
const auth = vi.hoisted(() => {
  const b64url = (obj: unknown): string =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  return {
    jwt: (secondsAhead: number): string =>
      `h.${b64url({ exp: Math.floor(Date.now() / 1000) + secondsAhead })}.s`,
    token: null as string | null,
    refreshed: null as string | null,
  }
})
const refreshSession = vi.hoisted(() => vi.fn())
vi.mock('../auth/token', () => ({
  getAccessToken: () => auth.token,
  refreshSession,
}))

// Runtime config normally arrives from GET /api/config; a mutable stand-in
// lets each test pick the capture rate the server would publish.
const runtime = vi.hoisted(() => ({ captureRate: 24_000 }))
vi.mock('../runtime-config', () => ({
  getSttCaptureSampleRate: () => runtime.captureRate,
  getSttEngine: () => 'google-cloud',
}))

import { createSpeechCapture } from './capture'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static OPEN = 1
  url: string
  binaryType = ''
  readyState = 1
  sent: unknown[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }
  send(data: unknown): void {
    this.sent.push(data)
  }
  close(): void {
    this.readyState = 3
  }
}

class FakeAudioWorkletNode {
  static instances: FakeAudioWorkletNode[] = []
  port: { onmessage: ((event: { data: ArrayBuffer }) => void) | null } = {
    onmessage: null,
  }
  connect = vi.fn()
  disconnect = vi.fn()
  options: { processorOptions?: Record<string, number> } | undefined
  constructor(
    _ctx: unknown,
    _name: string,
    options?: { processorOptions?: Record<string, number> },
  ) {
    this.options = options
    FakeAudioWorkletNode.instances.push(this)
  }
}

const lastWorklet = (): FakeAudioWorkletNode =>
  FakeAudioWorkletNode.instances[FakeAudioWorkletNode.instances.length - 1]!

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  /** Hardware rate the next context reports; per-test so the downsampling
   * decision (never upsample) can be exercised both ways. */
  static rate = 48_000
  sampleRate = FakeAudioContext.rate
  state = 'running'
  destination = {}
  audioWorklet = { addModule: vi.fn(() => Promise.resolve()) }
  constructor() {
    FakeAudioContext.instances.push(this)
  }
  createMediaStreamSource() {
    return { connect: vi.fn() }
  }
  createGain() {
    return { gain: { value: 1 }, connect: vi.fn() }
  }
  close() {
    this.state = 'closed'
    return Promise.resolve()
  }
}

const track = { stop: vi.fn() }
const getUserMedia = vi.fn(() => Promise.resolve({ getTracks: () => [track] }))

const stubMediaApis = () => {
  Object.defineProperty(window, 'isSecureContext', {
    value: true,
    configurable: true,
  })
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  })
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode)
}

/** Drains the async setup (getUserMedia + addModule) inside start(). */
const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

beforeEach(() => {
  // A fresh token by default, so tests unrelated to refresh skip it.
  auth.token = auth.jwt(3600)
  auth.refreshed = auth.jwt(3600)
  refreshSession.mockReset()
  refreshSession.mockImplementation(() =>
    Promise.resolve(auth.refreshed ? { accessToken: auth.refreshed } : null),
  )
  FakeWebSocket.instances = []
  FakeAudioContext.instances = []
  FakeAudioWorkletNode.instances = []
  FakeAudioContext.rate = 48_000
  runtime.captureRate = 24_000
  track.stop.mockClear()
  getUserMedia.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('google cloud speech capture', () => {
  it('is unavailable without secure context or media APIs, available with them', () => {
    Object.defineProperty(window, 'isSecureContext', {
      value: false,
      configurable: true,
    })
    expect(createSpeechCapture('google-cloud').available).toBe(false)
    stubMediaApis()
    expect(createSpeechCapture('google-cloud').available).toBe(true)
  })

  it('opens an authenticated socket and streams PCM after the start message', async () => {
    stubMediaApis()
    const capture = createSpeechCapture('google-cloud')
    capture.start({ onPhrase: vi.fn() }, 'fr-FR')
    await flush()

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    const ctx = FakeAudioContext.instances[0]!
    expect(ctx.audioWorklet.addModule).toHaveBeenCalledOnce()
    const socket = FakeWebSocket.instances[0]!
    // A fresh token is used as-is, with no refresh round-trip.
    expect(refreshSession).not.toHaveBeenCalled()
    expect(socket.url).toContain(`/api/stt?token=${auth.token}`)
    expect(socket.binaryType).toBe('arraybuffer')

    // The socket opening triggers the start control message; with no deckId
    // it carries the session id (for audio retention) but no deck.
    socket.onopen?.()
    // The reported rate is the DOWNSAMPLED one (CAP-3), not the 48 kHz
    // context: the server hands it to Cloud STT, which would read the PCM at
    // the wrong speed if these ever disagreed.
    expect(JSON.parse(socket.sent[0] as string)).toEqual({
      type: 'start',
      languageCode: 'fr-FR',
      sampleRate: 24_000,
      sessionId: expect.any(String),
    })
    // …and the worklet is told both rates so it can do the conversion.
    expect(lastWorklet().options?.processorOptions).toEqual({
      targetSampleRate: 24_000,
      inputSampleRate: 48_000,
    })

    // Worklet PCM buffers are forwarded as binary frames.
    const pcm = new ArrayBuffer(8)
    lastWorklet().port.onmessage?.({ data: pcm })
    expect(socket.sent).toContain(pcm)
  })

  it('streams the native rate when downsampling is turned off (0)', async () => {
    // STT_CAPTURE_SAMPLE_RATE=0: no downsampling. The wire must still carry a
    // real rate — a literal 0 would make Cloud STT misread the PCM.
    runtime.captureRate = 0
    stubMediaApis()
    createSpeechCapture('google-cloud').start({ onPhrase: vi.fn() }, 'en-US')
    await flush()

    const socket = FakeWebSocket.instances[0]!
    socket.onopen?.()
    expect(
      (JSON.parse(socket.sent[0] as string) as { sampleRate: number })
        .sampleRate,
    ).toBe(48_000)
    expect(lastWorklet().options?.processorOptions).toEqual({
      targetSampleRate: 0,
      inputSampleRate: 48_000,
    })
  })

  it('streams the context rate when it is already below the target', async () => {
    // Never upsample: a 8 kHz context sends 8 kHz, and the server is told 8 kHz.
    // Inventing samples would cost bytes and buy nothing.
    FakeAudioContext.rate = 8_000
    stubMediaApis()
    createSpeechCapture('google-cloud').start({ onPhrase: vi.fn() }, 'en-US')
    await flush()

    const socket = FakeWebSocket.instances[0]!
    socket.onopen?.()
    expect(
      (JSON.parse(socket.sent[0] as string) as { sampleRate: number })
        .sampleRate,
    ).toBe(8_000)
    expect(lastWorklet().options?.processorOptions).toEqual({
      targetSampleRate: 24_000,
      inputSampleRate: 8_000,
    })
  })

  it('includes the deck id in the start message for audio retention', async () => {
    stubMediaApis()
    createSpeechCapture('google-cloud').start(
      { onPhrase: vi.fn() },
      'en-US',
      'deck-42',
    )
    await flush()
    const socket = FakeWebSocket.instances[0]!
    socket.onopen?.()
    const start = JSON.parse(socket.sent[0] as string)
    expect(start).toMatchObject({ type: 'start', deckId: 'deck-42' })
    // The retention sessionId matches the one the phrases will carry.
    expect(start.sessionId).toEqual(expect.any(String))
  })

  it('maps interim and final transcripts onto the handlers', async () => {
    stubMediaApis()
    const onPhrase = vi.fn()
    const onInterim = vi.fn()
    createSpeechCapture('google-cloud').start({ onPhrase, onInterim })
    await flush()
    const socket = FakeWebSocket.instances[0]!

    socket.onmessage?.({
      data: JSON.stringify({ type: 'interim', text: 'hel' }),
    })
    // Interims carry the same session id as finals, so the mid-speech
    // interim flush (GEN-12) can credit the recording session.
    expect(onInterim).toHaveBeenCalledWith('hel', {
      sessionId: expect.any(String),
    })
    expect(onPhrase).not.toHaveBeenCalled()

    socket.onmessage?.({
      data: JSON.stringify({ type: 'final', text: 'hello' }),
    })
    expect(onInterim).toHaveBeenLastCalledWith('', {
      sessionId: expect.any(String),
    })
    // A final with no timings still carries the recording session id.
    expect(onPhrase).toHaveBeenCalledWith('hello', {
      sessionId: expect.any(String),
    })
  })

  it('forwards word timings and confidence, with a stable session id', async () => {
    stubMediaApis()
    const onPhrase = vi.fn()
    createSpeechCapture('google-cloud').start({ onPhrase })
    await flush()
    const socket = FakeWebSocket.instances[0]!

    const words = [{ word: 'hello', startMs: 0, endMs: 500, confidence: 0.9 }]
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'final',
        text: 'hello',
        confidence: 0.8,
        words,
      }),
    })
    socket.onmessage?.({
      data: JSON.stringify({ type: 'final', text: 'world' }),
    })

    expect(onPhrase).toHaveBeenNthCalledWith(1, 'hello', {
      sessionId: expect.any(String),
      confidence: 0.8,
      words,
    })
    // Same recording → the session id is stable across phrases.
    const sessionOf = (i: number) =>
      (onPhrase.mock.calls[i]![1] as { sessionId: string }).sessionId
    expect(sessionOf(1)).toBe(sessionOf(0))
  })

  it('mints a new session id after stop() then start()', async () => {
    stubMediaApis()
    const onPhrase = vi.fn()
    const capture = createSpeechCapture('google-cloud')
    capture.start({ onPhrase })
    await flush()
    FakeWebSocket.instances[0]!.onmessage?.({
      data: JSON.stringify({ type: 'final', text: 'one' }),
    })

    capture.stop()
    capture.start({ onPhrase })
    await flush()
    FakeWebSocket.instances[1]!.onmessage?.({
      data: JSON.stringify({ type: 'final', text: 'two' }),
    })

    const sessionOf = (i: number) =>
      (onPhrase.mock.calls[i]![1] as { sessionId: string }).sessionId
    expect(sessionOf(1)).not.toBe(sessionOf(0))
  })

  it('surfaces a server error message and stops', async () => {
    stubMediaApis()
    const onError = vi.fn()
    createSpeechCapture('google-cloud').start({ onPhrase: vi.fn(), onError })
    await flush()
    const socket = FakeWebSocket.instances[0]!

    socket.onmessage?.({
      data: JSON.stringify({ type: 'error', message: 'Engine down' }),
    })
    expect(onError).toHaveBeenCalledWith('Engine down')
    expect(track.stop).toHaveBeenCalled()
  })

  it('surfaces an unexpected socket disconnect', async () => {
    stubMediaApis()
    const onError = vi.fn()
    createSpeechCapture('google-cloud').start({ onPhrase: vi.fn(), onError })
    await flush()

    FakeWebSocket.instances[0]!.onclose?.()
    expect(onError).toHaveBeenCalledWith('Speech service disconnected')
  })

  it('reports a denied microphone', async () => {
    stubMediaApis()
    getUserMedia.mockRejectedValueOnce(new Error('denied'))
    const onError = vi.fn()
    createSpeechCapture('google-cloud').start({ onPhrase: vi.fn(), onError })
    await flush()
    expect(onError).toHaveBeenCalledWith(
      'Microphone unavailable — check permissions',
    )
  })

  it('reports when the user is signed out', async () => {
    stubMediaApis()
    // No token and refresh can't renew one — a genuinely signed-out session.
    auth.token = null
    auth.refreshed = null
    const onError = vi.fn()
    createSpeechCapture('google-cloud').start({ onPhrase: vi.fn(), onError })
    await flush()
    expect(onError).toHaveBeenCalledWith('Sign in to use speech recognition')
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('refreshes an expired token before opening the socket', async () => {
    stubMediaApis()
    // The in-memory token has expired (the tab sat idle past its TTL); the
    // refresh yields a new one, which is what the handshake must carry.
    auth.token = auth.jwt(-10)
    auth.refreshed = auth.jwt(3600)
    createSpeechCapture('google-cloud').start({ onPhrase: vi.fn() })
    await flush()
    expect(refreshSession).toHaveBeenCalledOnce()
    const socket = FakeWebSocket.instances[0]!
    // The fresh token rides the socket, never the stale one.
    expect(socket.url).toContain(`/api/stt?token=${auth.refreshed}`)
    expect(socket.url).not.toContain(auth.token as string)
  })

  it('refreshes when there is no token yet, then connects', async () => {
    stubMediaApis()
    auth.token = null
    auth.refreshed = auth.jwt(3600)
    createSpeechCapture('google-cloud').start({ onPhrase: vi.fn() })
    await flush()
    expect(refreshSession).toHaveBeenCalledOnce()
    expect(FakeWebSocket.instances[0]!.url).toContain(
      `/api/stt?token=${auth.refreshed}`,
    )
  })

  it('fails without connecting when an expired token cannot be refreshed', async () => {
    stubMediaApis()
    // Expired token and a refresh that returns nothing (session truly gone).
    auth.token = auth.jwt(-10)
    auth.refreshed = null
    const onError = vi.fn()
    createSpeechCapture('google-cloud').start({ onPhrase: vi.fn(), onError })
    await flush()
    expect(refreshSession).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith('Sign in to use speech recognition')
    // A stale token must never reach the socket.
    expect(FakeWebSocket.instances).toHaveLength(0)
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('tears down cleanly on stop() and does not error on the ensuing close', async () => {
    stubMediaApis()
    const onError = vi.fn()
    const capture = createSpeechCapture('google-cloud')
    capture.start({ onPhrase: vi.fn(), onError })
    await flush()
    const socket = FakeWebSocket.instances[0]!

    capture.stop()
    expect(track.stop).toHaveBeenCalled()
    expect(FakeAudioContext.instances[0]!.state).toBe('closed')
    expect(socket.readyState).toBe(3)

    socket.onclose?.()
    expect(onError).not.toHaveBeenCalled()
  })

  it('announces a deliberate stop to the server before closing (EVAL-1)', async () => {
    stubMediaApis()
    const capture = createSpeechCapture('google-cloud')
    capture.start({ onPhrase: vi.fn() })
    await flush()
    const socket = FakeWebSocket.instances[0]!

    capture.stop()
    // The stop frame is what lets telemetry tell a stop from an abandonment.
    const last = socket.sent[socket.sent.length - 1]
    expect(JSON.parse(String(last))).toEqual({ type: 'stop' })
    expect(socket.readyState).toBe(3)
  })

  it('sends no stop frame on a failure path, so it reads as abandoned', async () => {
    stubMediaApis()
    const onError = vi.fn()
    createSpeechCapture('google-cloud').start({ onPhrase: vi.fn(), onError })
    await flush()
    const socket = FakeWebSocket.instances[0]!

    socket.onmessage?.({
      data: JSON.stringify({ type: 'error', message: 'Engine down' }),
    })
    expect(onError).toHaveBeenCalled()
    const stops = socket.sent.filter(frame => {
      try {
        return (JSON.parse(String(frame)) as { type?: string }).type === 'stop'
      } catch {
        return false
      }
    })
    expect(stops).toHaveLength(0)
  })
})
