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
    expect(onPhrase).toHaveBeenCalledWith('photosynthesis basics')
    // A final clears the interim line
    expect(onInterim).toHaveBeenLastCalledWith('')
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

  it('gives up after rapid start-end cycles instead of spinning', () => {
    stubApi()
    const capture = createSpeechCapture('browser')
    capture.start({ onPhrase: vi.fn() })
    const recognition = FakeRecognition.instances[0]!

    // Immediate end after every start: a capped number of retries
    for (let i = 0; i < 10; i++) recognition.onend?.()
    expect(recognition.started).toBeLessThanOrEqual(6)
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
