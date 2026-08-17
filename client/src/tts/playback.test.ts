/**
 * Unit tests for the TTS playback controller with a fake Audio element and a
 * mocked synth call: starting playback stops the mic, the deck auto-advances
 * when a clip ends, the toolbar toggle pauses/resumes, and the next slide's
 * audio is prefetched into memory so transitions don't stall.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { Locale, Slide } from '@slide-machine/shared'
import { useTtsPlayback } from './playback'
import { synthesizeSlideTts } from '../api/slides'
import { ApiError } from '../api/http'

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

/** Blob URLs the fake object-URL factory has handed out, newest last. */
let created: string[] = []
let revoked: string[] = []
const realCreate = URL.createObjectURL
const realRevoke = URL.revokeObjectURL

/** Makes downloading a clip into memory work, as it does in a browser: fetch
 * returns bytes and object URLs are handed out as `blob:1`, `blob:2`, ... */
const stubBlobUrls = () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, blob: async () => new Blob(['audio']) })),
  )
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:${created.length + 1}`
    created.push(url)
    return url
  })
  URL.revokeObjectURL = vi.fn((url: string) => void revoked.push(url))
}

beforeEach(() => {
  audios.length = 0
  created = []
  revoked = []
  mockedSynth.mockReset()
  vi.stubGlobal('Audio', FakeAudio)
})
afterEach(() => {
  vi.unstubAllGlobals()
  URL.createObjectURL = realCreate
  URL.revokeObjectURL = realRevoke
})

const setup = (getLocale?: () => Locale | null) => {
  const navigate = vi.fn()
  const stopMic = vi.fn()
  const hook = renderHook(() =>
    useTtsPlayback({ getSlides: () => slides, navigate, stopMic, getLocale }),
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
    expect(mockedSynth).toHaveBeenCalledWith(slides[0]!.id, 'transcript', {
      locale: null,
    })
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

  it('skipTo moves deck playback to the navigated slide', async () => {
    mockedSynth.mockImplementation(async (id: string) => ({
      url: `url-${id}`,
      marks: [],
    }))
    const { hook, navigate } = setup()

    act(() => hook.result.current.playDeck(0))
    await waitFor(() => expect(audios[0]?.src).toBe('url-s1'))

    // Arrow key forward: the narration jumps rather than finishing slide 1.
    act(() => hook.result.current.skipTo(1))
    await waitFor(() => expect(audios[0]!.src).toBe('url-s2'))
    expect(hook.result.current.activeIndex).toBe(1)
    await waitFor(() => expect(hook.result.current.status).toBe('playing'))

    // ...and back again, so arrowing left replays the previous transcript.
    act(() => hook.result.current.skipTo(0))
    await waitFor(() => expect(audios[0]!.src).toBe('url-s1'))
    expect(navigate).toHaveBeenLastCalledWith(0)

    // Playback continues from the slide skipped to.
    act(() => audios[0]!.end())
    await waitFor(() => expect(audios[0]!.src).toBe('url-s2'))
  })

  it('skipTo keeps a paused deck paused, cueing the new slide', async () => {
    mockedSynth.mockImplementation(async (id: string) => ({
      url: `url-${id}`,
      marks: [],
    }))
    const { hook } = setup()

    act(() => hook.result.current.playDeck(0))
    await waitFor(() => expect(hook.result.current.status).toBe('playing'))
    act(() => hook.result.current.pauseResume())
    expect(hook.result.current.status).toBe('paused')

    act(() => hook.result.current.skipTo(1))
    await waitFor(() => expect(audios[0]!.src).toBe('url-s2'))
    expect(hook.result.current.status).toBe('paused')

    act(() => hook.result.current.pauseResume())
    expect(hook.result.current.status).toBe('playing')
  })

  it('skipTo is ignored unless the deck is playing', async () => {
    mockedSynth.mockResolvedValue({ url: 'u1', marks: [] })
    const { hook, navigate } = setup()

    // Nothing playing at all.
    act(() => hook.result.current.skipTo(1))
    expect(mockedSynth).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()

    // A single slide's narration is not tied to where the deck is.
    act(() => hook.result.current.speakSlide(slides[0]!))
    await waitFor(() => expect(hook.result.current.status).toBe('playing'))
    mockedSynth.mockClear()
    act(() => hook.result.current.skipTo(1))
    expect(mockedSynth).not.toHaveBeenCalled()
    expect(hook.result.current.scope).toBe('slide')
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

  // "Speak this slide" (kebab) runs through the same toolbar button, so the
  // listener can pause a single slide's narration too — before this, toggle
  // only handled deck scope and would restart deck playback over it.
  it('toggle pauses and resumes a single slide narration', async () => {
    mockedSynth.mockResolvedValue({ url: 'u', marks: [] })
    const { hook } = setup()

    act(() => hook.result.current.speakSlide(slides[0]!))
    await waitFor(() => expect(hook.result.current.status).toBe('playing'))
    expect(hook.result.current.scope).toBe('slide')

    act(() => hook.result.current.toggle(0))
    expect(hook.result.current.status).toBe('paused')
    expect(audios[0]!.pause).toHaveBeenCalled()
    // Still the slide's narration — the deck was not started over it.
    expect(hook.result.current.scope).toBe('slide')

    act(() => hook.result.current.toggle(0))
    expect(hook.result.current.status).toBe('playing')
    expect(hook.result.current.scope).toBe('slide')
  })

  // The transcript editor's preview (EDIT-6) runs on this same controller, so
  // it cannot play over a slide or the deck.
  it('speaks supplied text without navigating, and idles when it ends', async () => {
    mockedSynth.mockResolvedValue({ url: 'preview', marks: [] })
    const { hook, navigate, stopMic } = setup()

    act(() => hook.result.current.speakText(slides[0]!, 'Unsaved words.'))
    expect(stopMic).toHaveBeenCalled()
    await waitFor(() => expect(audios[0]?.src).toBe('preview'))
    expect(mockedSynth).toHaveBeenCalledWith(slides[0]!.id, 'transcript', {
      text: 'Unsaved words.',
    })
    // The editor is open over the slide; the preview is about the words.
    expect(navigate).not.toHaveBeenCalled()
    expect(hook.result.current.scope).toBe('text')
    // No active slide, so whiteboard stroke sync never runs off a preview.
    expect(hook.result.current.getProgress()).toBeNull()

    act(() => audios[0]!.end())
    expect(hook.result.current.status).toBe('idle')
  })

  it('ignores a request to speak nothing', () => {
    const { hook, stopMic } = setup()
    act(() => hook.result.current.speakText(slides[0]!, '   '))
    expect(mockedSynth).not.toHaveBeenCalled()
    expect(stopMic).not.toHaveBeenCalled()
    expect(hook.result.current.status).toBe('idle')
  })

  it('a preview silences whatever was already speaking', async () => {
    mockedSynth.mockResolvedValue({ url: 'u', marks: [] })
    const { hook } = setup()

    act(() => hook.result.current.playDeck(0))
    await waitFor(() => expect(hook.result.current.status).toBe('playing'))

    act(() => hook.result.current.speakText(slides[0]!, 'Unsaved words.'))
    expect(audios[0]!.pause).toHaveBeenCalled()
    await waitFor(() => expect(hook.result.current.scope).toBe('text'))
  })

  it('pauseResume pauses and resumes a preview', async () => {
    mockedSynth.mockResolvedValue({ url: 'preview', marks: [] })
    const { hook } = setup()

    act(() => hook.result.current.speakText(slides[0]!, 'Unsaved words.'))
    await waitFor(() => expect(hook.result.current.status).toBe('playing'))

    act(() => hook.result.current.pauseResume())
    expect(hook.result.current.status).toBe('paused')
    expect(audios[0]!.pause).toHaveBeenCalled()

    act(() => hook.result.current.pauseResume())
    expect(hook.result.current.status).toBe('playing')
    expect(hook.result.current.scope).toBe('text')
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

  // The gap between slides was a synth round trip plus a download, both
  // starting only once the previous clip ended. They now happen during it.
  describe('prefetching the next slide', () => {
    const deckSynth = () =>
      mockedSynth.mockImplementation(async (id: string) => ({
        url: `url-${id}`,
        marks: [],
      }))

    it('synthesizes the next slide while the current one plays', async () => {
      deckSynth()
      const { hook } = setup()

      act(() => hook.result.current.playDeck(0))
      await waitFor(() => expect(audios[0]?.src).toBe('url-s1'))
      // Slide 2 is fetched without waiting for slide 1 to finish.
      await waitFor(() =>
        expect(mockedSynth).toHaveBeenCalledWith('s2', 'transcript', {
          locale: null,
        }),
      )

      mockedSynth.mockClear()
      act(() => audios[0]!.end())
      await waitFor(() => expect(audios[0]!.src).toBe('url-s2'))
      // ...and the transition plays it rather than fetching it again.
      expect(mockedSynth).not.toHaveBeenCalled()
    })

    it('stops prefetching at the last slide', async () => {
      deckSynth()
      const { hook } = setup()

      act(() => hook.result.current.playDeck(0))
      await waitFor(() => expect(audios[0]?.src).toBe('url-s1'))
      await waitFor(() => expect(mockedSynth).toHaveBeenCalledTimes(2))

      act(() => audios[0]!.end())
      await waitFor(() => expect(audios[0]!.src).toBe('url-s2'))
      // Two slides, two synth calls — nothing fetched past the end.
      expect(mockedSynth).toHaveBeenCalledTimes(2)

      act(() => audios[0]!.end())
      await waitFor(() => expect(hook.result.current.status).toBe('idle'))
      expect(mockedSynth).toHaveBeenCalledTimes(2)
    })

    it('plays clips from memory and frees them as it goes', async () => {
      deckSynth()
      stubBlobUrls()
      const { hook } = setup()

      act(() => hook.result.current.playDeck(0))
      // The element plays the downloaded bytes, not the server URL.
      await waitFor(() => expect(audios[0]?.src).toBe('blob:1'))
      expect(fetch).toHaveBeenCalledWith('url-s1')
      await waitFor(() => expect(created).toHaveLength(2)) // slide 2 warmed

      act(() => audios[0]!.end())
      await waitFor(() => expect(audios[0]!.src).toBe('blob:2'))
      expect(revoked).toContain('blob:1') // the spent clip is released

      act(() => audios[0]!.end())
      await waitFor(() => expect(hook.result.current.status).toBe('idle'))
      expect(revoked).toContain('blob:2')
    })

    it('frees a prefetched clip that never gets played', async () => {
      deckSynth()
      stubBlobUrls()
      const { hook } = setup()

      act(() => hook.result.current.playDeck(0))
      await waitFor(() => expect(created).toHaveLength(2))

      act(() => hook.result.current.stop())
      await waitFor(() => expect(revoked).toContain('blob:2'))
    })

    it('reuses the warmed clip when the user skips to that slide', async () => {
      deckSynth()
      const { hook } = setup()

      act(() => hook.result.current.playDeck(0))
      await waitFor(() =>
        expect(mockedSynth).toHaveBeenCalledWith('s2', 'transcript', {
          locale: null,
        }),
      )

      mockedSynth.mockClear()
      act(() => hook.result.current.skipTo(1))
      await waitFor(() => expect(audios[0]!.src).toBe('url-s2'))
      expect(mockedSynth).not.toHaveBeenCalled()
    })

    it('falls back to the server URL when the bytes cannot be fetched', async () => {
      deckSynth()
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new Error('blocked')
        }),
      )
      const { hook } = setup()

      act(() => hook.result.current.playDeck(0))
      // The element downloads it itself, as before — playback still works.
      await waitFor(() => expect(audios[0]?.src).toBe('url-s1'))
      await waitFor(() => expect(hook.result.current.status).toBe('playing'))
    })
  })

  describe('speaking the language on screen (PLAY-3)', () => {
    it('asks for the language the slides are being read in', async () => {
      mockedSynth.mockResolvedValue({ url: 'u1', marks: [] })
      const { hook } = setup(() => 'fr')

      act(() => hook.result.current.speakSlide(slides[0]!))
      await waitFor(() => expect(audios[0]?.src).toBe('u1'))
      expect(mockedSynth).toHaveBeenCalledWith('s1', 'transcript', {
        locale: 'fr',
      })
    })

    it('warms the next slide in the same language', async () => {
      mockedSynth.mockResolvedValue({ url: 'u', marks: [] })
      const { hook } = setup(() => 'fr')

      act(() => hook.result.current.playDeck(0))
      // A clip warmed in the wrong language would be played after the reader
      // switched, so the prefetch has to carry it too.
      await waitFor(() =>
        expect(mockedSynth).toHaveBeenCalledWith('s2', 'transcript', {
          locale: 'fr',
        }),
      )
    })

    it('does not reuse a clip warmed in another language', async () => {
      mockedSynth.mockResolvedValue({ url: 'u', marks: [] })
      let locale: Locale | null = 'fr'
      const { hook } = setup(() => locale)

      act(() => hook.result.current.playDeck(0))
      await waitFor(() =>
        expect(mockedSynth).toHaveBeenCalledWith('s2', 'transcript', {
          locale: 'fr',
        }),
      )
      // The reader switches back to the original mid-deck. The warmed French
      // clip is keyed to French, so slide 2 is fetched again rather than
      // spoken in a language nobody is reading.
      locale = null
      mockedSynth.mockClear()
      act(() => hook.result.current.skipTo(1))
      await waitFor(() =>
        expect(mockedSynth).toHaveBeenCalledWith('s2', 'transcript', {
          locale: null,
        }),
      )
    })

    it('never translates an unsaved preview', async () => {
      mockedSynth.mockResolvedValue({ url: 'preview', marks: [] })
      const { hook } = setup(() => 'fr')

      act(() => hook.result.current.speakText(slides[0]!, 'Unsaved words.'))
      await waitFor(() => expect(audios[0]?.src).toBe('preview'))
      // A preview speaks exactly what the editor typed (EDIT-6).
      expect(mockedSynth).toHaveBeenCalledWith('s1', 'transcript', {
        text: 'Unsaved words.',
      })
    })

    it('stops and says so when the deck cannot be spoken in that language', async () => {
      mockedSynth.mockRejectedValue(
        new ApiError(502, 'translation_failed', 'Could not narrate that.'),
      )
      const { hook } = setup(() => 'fr')

      act(() => hook.result.current.playDeck(0))
      await waitFor(() =>
        expect(hook.result.current.error).toBe('Could not narrate that.'),
      )
      // Not advanced through in silence: a deck that kept moving with no
      // sound would read as a broken player.
      expect(hook.result.current.status).toBe('idle')
      expect(hook.result.current.activeIndex).toBeNull()

      act(() => hook.result.current.clearError())
      expect(hook.result.current.error).toBeNull()
    })

    it('stops when the owner’s allowance is spent', async () => {
      mockedSynth.mockRejectedValue(
        new ApiError(402, 'plan_limit', 'Not available in that language.'),
      )
      const { hook } = setup(() => 'fr')

      act(() => hook.result.current.speakSlide(slides[0]!))
      await waitFor(() =>
        expect(hook.result.current.error).toBe(
          'Not available in that language.',
        ),
      )
      expect(hook.result.current.status).toBe('idle')
    })

    it('still advances past an ordinary failure', async () => {
      // The distinction that matters: one slide's clip failing to load is not
      // a refusal, and deck playback keeps moving as it always has.
      mockedSynth.mockImplementation(async (id: string) => {
        if (id === 's1') throw new Error('network blip')
        return { url: 'u2', marks: [] }
      })
      const { hook } = setup(() => 'fr')

      act(() => hook.result.current.playDeck(0))
      await waitFor(() => expect(audios[0]?.src).toBe('u2'))
      expect(hook.result.current.error).toBeNull()
      expect(hook.result.current.status).toBe('playing')
    })

    it('clears a stale refusal when playback starts again', async () => {
      mockedSynth.mockRejectedValue(
        new ApiError(502, 'translation_failed', 'Could not narrate that.'),
      )
      const { hook } = setup(() => 'fr')
      act(() => hook.result.current.playDeck(0))
      await waitFor(() => expect(hook.result.current.error).toBeTruthy())

      mockedSynth.mockResolvedValue({ url: 'u1', marks: [] })
      act(() => hook.result.current.speakSlide(slides[0]!))
      await waitFor(() => expect(hook.result.current.status).toBe('playing'))
      expect(hook.result.current.error).toBeNull()
    })
  })
})
