/**
 * Unit tests for the speech-capture seam: the browser adapter drives
 * the Web Speech API (finals vs interims, silence auto-restart, fatal
 * errors), and unsupported providers/browsers report unavailable.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createSpeechCapture } from './capture'

class FakeRecognition {
  static instances: FakeRecognition[] = []
  continuous = false
  interimResults = false
  lang = ''
  onresult: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  onend: (() => void) | null = null
  started = 0
  stopped = 0
  start() {
    this.started++
  }
  stop() {
    this.stopped++
    this.onend?.()
  }
  constructor() {
    FakeRecognition.instances.push(this)
  }
}

const stubApi = () => {
  FakeRecognition.instances = []
  vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
}

const result = (transcript: string, isFinal: boolean) => ({
  resultIndex: 0,
  results: [{ isFinal, 0: { transcript }, length: 1 }],
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('browser speech capture', () => {
  it('reports unavailable without the Web Speech API or with provider none', () => {
    expect(createSpeechCapture('browser').available).toBe(false)
    stubApi()
    expect(createSpeechCapture('none').available).toBe(false)
    expect(createSpeechCapture('browser').available).toBe(true)
  })

  it('delivers finals as phrases and interims separately', () => {
    stubApi()
    const capture = createSpeechCapture('browser')
    const onPhrase = vi.fn()
    const onInterim = vi.fn()
    capture.start({ onPhrase, onInterim })

    const recognition = FakeRecognition.instances[0]!
    expect(recognition.continuous).toBe(true)
    expect(recognition.interimResults).toBe(true)
    expect(recognition.started).toBe(1)

    recognition.onresult?.(result('photosynthesis bas', false))
    expect(onInterim).toHaveBeenCalledWith('photosynthesis bas')
    expect(onPhrase).not.toHaveBeenCalled()

    recognition.onresult?.(result('photosynthesis basics', true))
    // The browser engine has no server-side timing, so a phrase carries only
    // a recording session id (GEN-4 groundwork).
    expect(onPhrase).toHaveBeenCalledWith('photosynthesis basics', {
      sessionId: expect.any(String),
    })
    // A final clears the interim line
    expect(onInterim).toHaveBeenLastCalledWith('')
  })

  it('keeps one session id per recording and mints a new one after restart', () => {
    stubApi()
    const capture = createSpeechCapture('browser')
    const onPhrase = vi.fn()
    capture.start({ onPhrase })
    const first = FakeRecognition.instances[0]!
    first.onresult?.(result('one', true))
    first.onresult?.(result('two', true))

    capture.stop()
    capture.start({ onPhrase })
    FakeRecognition.instances[1]!.onresult?.(result('three', true))

    const sessionOf = (i: number) =>
      (onPhrase.mock.calls[i]![1] as { sessionId: string }).sessionId
    // Same recording → same id; a stop→start begins a new session.
    expect(sessionOf(0)).toBe(sessionOf(1))
    expect(sessionOf(2)).not.toBe(sessionOf(0))
  })

  it('recognizes in the requested language, browser default otherwise', () => {
    stubApi()
    const capture = createSpeechCapture('browser')
    capture.start({ onPhrase: vi.fn() }, 'fr')
    expect(FakeRecognition.instances[0]!.lang).toBe('fr')
    capture.stop()
    capture.start({ onPhrase: vi.fn() })
    expect(FakeRecognition.instances[1]!.lang).toBe(
      navigator.language || 'en-US',
    )
  })

  it('auto-restarts after silence but not after stop()', () => {
    stubApi()
    const capture = createSpeechCapture('browser')
    capture.start({ onPhrase: vi.fn() })
    const recognition = FakeRecognition.instances[0]!

    // Browser ended recognition on its own (silence): restart
    recognition.onend?.()
    expect(recognition.started).toBe(2)

    capture.stop()
    const startsAfterStop = recognition.started
    recognition.onend?.()
    expect(recognition.started).toBe(startsAfterStop)
  })

  it('gives up after rapid start-end cycles and surfaces the failure', () => {
    stubApi()
    const capture = createSpeechCapture('browser')
    const onError = vi.fn()
    capture.start({ onPhrase: vi.fn(), onError })
    const recognition = FakeRecognition.instances[0]!

    // Immediate end after every start: a capped number of retries,
    // then the dead mic is reported instead of silently abandoned
    for (let i = 0; i < 10; i++) recognition.onend?.()
    expect(recognition.started).toBeLessThanOrEqual(6)
    expect(onError).toHaveBeenCalledWith(
      'Microphone unavailable — speech recognition keeps stopping',
    )
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('surfaces fatal permission errors and stops', () => {
    stubApi()
    const capture = createSpeechCapture('browser')
    const onError = vi.fn()
    capture.start({ onPhrase: vi.fn(), onError })
    const recognition = FakeRecognition.instances[0]!

    recognition.onerror?.({ error: 'no-speech' })
    expect(onError).not.toHaveBeenCalled()

    recognition.onerror?.({ error: 'not-allowed' })
    expect(onError).toHaveBeenCalledWith(
      'Microphone unavailable — check permissions',
    )
    // No restart once fatal
    const starts = recognition.started
    recognition.onend?.()
    expect(recognition.started).toBe(starts)
  })
})
