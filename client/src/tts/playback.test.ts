/**
 * Unit tests for the TTS playback controller with a fake Audio element and a
 * mocked synth call: starting playback stops the mic, the deck auto-advances
 * when a clip ends, and the toolbar toggle pauses/resumes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { Slide } from '@slide-machine/shared'
import { useTtsPlayback } from './playback'
import { synthesizeSlideTts } from '../api/slides'

vi.mock('../api/slides', () => ({ synthesizeSlideTts: vi.fn() }))
const mockedSynth = vi.mocked(synthesizeSlideTts)

/** Captures every created element; only the src/onended matter here. */
const audios: FakeAudio[] = []
class FakeAudio {
  src = ''
  currentTime = 0
  duration = 10
  onended: (() => void) | null = null
  play = vi.fn(async () => {})
  pause = vi.fn()
  removeAttribute = vi.fn(() => {
    this.src = ''
  })
  constructor() {
    audios.push(this)
  }
  end() {
    this.onended?.()
  }
}

const slides = [{ id: 's1' }, { id: 's2' }] as Slide[]

beforeEach(() => {
  audios.length = 0
  mockedSynth.mockReset()
  vi.stubGlobal('Audio', FakeAudio)
})
afterEach(() => vi.unstubAllGlobals())

const setup = () => {
  const navigate = vi.fn()
  const stopMic = vi.fn()
  const hook = renderHook(() =>
    useTtsPlayback({ getSlides: () => slides, navigate, stopMic }),
  )
  return { hook, navigate, stopMic }
}

describe('useTtsPlayback', () => {
  it('speaks a slide: stops the mic, plays, then idles when it ends', async () => {
    mockedSynth.mockResolvedValue({ url: 'u1', marks: [] })
    const { hook, navigate, stopMic } = setup()

    act(() => hook.result.current.speakSlide(slides[0]!))
    expect(stopMic).toHaveBeenCalled()
    await waitFor(() => expect(audios[0]?.src).toBe('u1'))
    // Speaks the slide's stored narration/transcript, like deck playback.
    expect(mockedSynth).toHaveBeenCalledWith(slides[0]!.id, 'transcript')
    expect(navigate).toHaveBeenCalledWith(0)
    await waitFor(() => expect(hook.result.current.status).toBe('playing'))

    act(() => audios[0]!.end())
    expect(hook.result.current.status).toBe('idle')
  })

  it('plays the deck and auto-advances on ended', async () => {
    mockedSynth.mockImplementation(async (id: string) => ({
      url: `url-${id}`,
      marks: [],
    }))
    const { hook, navigate, stopMic } = setup()

    act(() => hook.result.current.playDeck(0))
    expect(stopMic).toHaveBeenCalled()
    await waitFor(() => expect(audios[0]?.src).toBe('url-s1'))
    expect(navigate).toHaveBeenCalledWith(0)

    act(() => audios[0]!.end())
    await waitFor(() => expect(audios[0]!.src).toBe('url-s2'))
    expect(navigate).toHaveBeenCalledWith(1)

    act(() => audios[0]!.end())
    await waitFor(() => expect(hook.result.current.status).toBe('idle'))
  })

  it('toggle pauses and resumes deck playback', async () => {
    mockedSynth.mockResolvedValue({ url: 'u', marks: [] })
    const { hook } = setup()

    act(() => hook.result.current.playDeck(0))
    await waitFor(() => expect(hook.result.current.status).toBe('playing'))

    act(() => hook.result.current.toggle(0))
    expect(hook.result.current.status).toBe('paused')
    expect(audios[0]!.pause).toHaveBeenCalled()

    act(() => hook.result.current.toggle(0))
    expect(hook.result.current.status).toBe('playing')
  })

  it('exposes the active clip marks + time through getProgress', async () => {
    const marks = [
      { charOffset: 0, timeSeconds: 0 },
      { charOffset: 20, timeSeconds: 4 },
    ]
    mockedSynth.mockResolvedValue({ url: 'u1', marks })
    const { hook } = setup()

    act(() => hook.result.current.speakSlide(slides[0]!))
    await waitFor(() => expect(hook.result.current.status).toBe('playing'))

    audios[0]!.currentTime = 2.5
    const progress = hook.result.current.getProgress()
    expect(progress?.index).toBe(0)
    expect(progress?.currentTime).toBe(2.5)
    expect(progress?.duration).toBe(10)
    expect(progress?.marks).toEqual(marks)
  })
})
