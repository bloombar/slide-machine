/**
 * Unit tests for the deck viewer: the Resume affordance appears for the
 * deck's owner only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { AuthProvider } from '../auth/AuthContext'
import { setAccessToken } from '../auth/token'
import DeckViewerPage from './DeckViewerPage'
import PublicShell from '../components/layout/PublicShell'
import { ShellTitleProvider } from '../components/layout/ShellTitle'
import { mockFetchRoutes } from '../test/fetch-mock'

const deckView = {
  deck: {
    id: 'deck1',
    projectId: 'p1',
    ownerId: 'u1',
    title: 'Shared Lecture',
    permalinkSlug: 'shared-abc123',
    slideOrder: ['s1'],
    visibility: 'public',
    accessInherited: true,
    updatedAt: new Date(Date.now() - 120_000).toISOString(),
  },
  slides: [
    {
      id: 's1',
      deckId: 'deck1',
      index: 0,
      layoutType: 'title',
      title: 'Hello',
    },
    {
      id: 's2',
      deckId: 'deck1',
      index: 1,
      layoutType: 'content',
      title: 'Second',
      body: 'More detail',
    },
  ],
  template: {
    id: 'classic',
    ownerId: 'system',
    name: 'Classic',
    theme: {},
    layouts: [],
    visibility: 'public',
    voteScore: 0,
    createdAt: '',
  },
  projectGenerationFreedom: 3,
}

const renderViewer = (refreshStatus: number, ownerId = 'u1') => {
  mockFetchRoutes({
    '/api/auth/refresh': () =>
      refreshStatus === 200
        ? {
            status: 200,
            body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
          }
        : { status: 401 },
    '/api/decks/shared-abc123': () => ({
      status: 200,
      body: {
        ...deckView,
        deck: { ...deckView.deck, ownerId },
        canEdit: refreshStatus === 200 && ownerId === 'u1',
      },
    }),
  })
  return render(
    <MemoryRouter initialEntries={['/d/shared-abc123']}>
      <AuthProvider>
        <Routes>
          <Route path="/d/:slug" element={<DeckViewerPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  setAccessToken(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DeckViewerPage', () => {
  it('gives the owner a Live session toggle that reveals the Speak bar', async () => {
    renderViewer(200)
    const toggle = await screen.findByRole('button', { name: 'Live session' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(
      screen.queryByRole('textbox', { name: 'Spoken phrase' }),
    ).not.toBeInTheDocument()

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getByRole('textbox', { name: 'Spoken phrase' }),
    ).toBeInTheDocument()
  })

  it('hides the Live session toggle from anonymous viewers', async () => {
    renderViewer(401)
    expect(await screen.findByText('Shared Lecture')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Live session' }),
    ).not.toBeInTheDocument()
  })

  it('hides the Live session toggle from signed-in non-owners', async () => {
    renderViewer(200, 'someone-else')
    expect(await screen.findByText('Shared Lecture')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Live session' }),
    ).not.toBeInTheDocument()
  })
})

describe('DeckViewerPage view modes', () => {
  it('carousel shows one slide; list view stacks all slides', async () => {
    renderViewer(401)
    await screen.findByText('Shared Lecture')
    expect(screen.getAllByTestId('slide')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    expect(screen.getAllByTestId('slide')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Carousel view' }))
    expect(screen.getAllByTestId('slide')).toHaveLength(1)
  })
})

describe('DeckViewerPage pasted permalinks', () => {
  it('waits for session restore so owners can open private-deck URLs directly', async () => {
    // Simulates a fresh page load: the deck endpoint only succeeds with
    // the Bearer token that the boot-time refresh provides
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': init =>
        new Headers(init?.headers).has('Authorization')
          ? { status: 200, body: { ...deckView, canEdit: true } }
          : { status: 404 },
    })
    render(
      <MemoryRouter initialEntries={['/d/shared-abc123']}>
        <AuthProvider>
          <Routes>
            <Route path="/d/:slug" element={<DeckViewerPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Shared Lecture')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('DeckViewerPage slide deletion', () => {
  it('lets the owner delete a slide from the superimposed icon', async () => {
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: { ...deckView, canEdit: true },
      }),
      '/api/actions/slide.delete': () => ({
        status: 200,
        body: { deleted: true, slideOrder: ['s2'] },
      }),
    })
    render(
      <MemoryRouter initialEntries={['/d/shared-abc123']}>
        <AuthProvider>
          <Routes>
            <Route path="/d/:slug" element={<DeckViewerPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )
    await screen.findByText('Shared Lecture')

    fireEvent.click(screen.getByRole('button', { name: 'Delete slide 1' }))

    // The first slide is gone; the second becomes the current slide
    expect(await screen.findByText('1 / 1')).toBeInTheDocument()
    expect(screen.getByTestId('slide')).toHaveAttribute(
      'data-layout',
      'content',
    )
  })

  it('hides the delete icon from non-owners', async () => {
    renderViewer(401)
    await screen.findByText('Shared Lecture')
    expect(
      screen.queryByRole('button', { name: /delete slide/i }),
    ).not.toBeInTheDocument()
  })
})

describe('DeckViewerPage lecture title editing', () => {
  it('lets the owner rename the lecture in place', async () => {
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: { ...deckView, canEdit: true },
      }),
      '/api/actions/deck.rename': () => ({
        status: 200,
        body: { ...deckView.deck, title: 'Renamed Lecture' },
      }),
    })
    render(
      <MemoryRouter initialEntries={['/d/shared-abc123']}>
        <AuthProvider>
          <Routes>
            <Route path="/d/:slug" element={<DeckViewerPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )
    await screen.findByText('Shared Lecture')

    fireEvent.click(screen.getByTitle('Click to edit Lecture title'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Lecture title' }), {
      target: { value: 'Renamed Lecture' },
    })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })

    expect(await screen.findByText('Renamed Lecture')).toBeInTheDocument()
  })

  it('renders the title as plain text for non-owners', async () => {
    renderViewer(401)
    await screen.findByText('Shared Lecture')
    expect(
      screen.queryByTitle('Click to edit Lecture title'),
    ).not.toBeInTheDocument()
  })
})

describe('DeckViewerPage add slide', () => {
  it('lets the owner append a slide and navigates to it', async () => {
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: { ...deckView, canEdit: true },
      }),
      '/api/actions/slide.add': () => ({
        status: 200,
        body: {
          id: 's3',
          deckId: 'deck1',
          index: 2,
          layoutType: 'content',
          title: 'New slide',
          body: 'Click to edit',
        },
      }),
    })
    render(
      <MemoryRouter initialEntries={['/d/shared-abc123']}>
        <AuthProvider>
          <Routes>
            <Route path="/d/:slug" element={<DeckViewerPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )
    await screen.findByText('Shared Lecture')

    fireEvent.click(screen.getByRole('button', { name: 'Add slide' }))

    expect(await screen.findByText('3 / 3')).toBeInTheDocument()
    expect(screen.getByText('New slide')).toBeInTheDocument()
  })

  it('hides the add-slide icon from non-owners', async () => {
    renderViewer(401)
    await screen.findByText('Shared Lecture')
    expect(
      screen.queryByRole('button', { name: 'Add slide' }),
    ).not.toBeInTheDocument()
  })
})

describe('DeckViewerPage microphone capture', () => {
  class FakeRecognition {
    static last: FakeRecognition | null = null
    static reset() {
      FakeRecognition.last = null
    }
    continuous = false
    interimResults = false
    lang = ''
    onresult: ((e: unknown) => void) | null = null
    onerror: ((e: unknown) => void) | null = null
    onend: (() => void) | null = null
    start() {}
    stop() {
      this.onend?.()
    }
    constructor() {
      FakeRecognition.last = this
    }
  }

  it('transitions to slides created or updated by queued mic phrases', async () => {
    FakeRecognition.reset()
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    let calls = 0
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: { ...deckView, canEdit: true },
      }),
      '/api/actions/session.phrase': () => {
        calls++
        return {
          status: 200,
          body:
            calls === 1
              ? {
                  kind: 'slide.new',
                  slide: {
                    id: 's3',
                    deckId: 'deck1',
                    index: 2,
                    layoutType: 'content',
                    title: 'Third slide',
                    body: 'Body',
                  },
                }
              : {
                  kind: 'slide.update',
                  slide: {
                    id: 's3',
                    deckId: 'deck1',
                    index: 2,
                    layoutType: 'content',
                    title: 'Third slide',
                    body: 'Body extended',
                  },
                },
        }
      },
    })
    render(
      <MemoryRouter initialEntries={['/d/shared-abc123']}>
        <AuthProvider>
          <Routes>
            <Route path="/d/:slug" element={<DeckViewerPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )
    await screen.findByText('Shared Lecture')
    // One toggle: opening the live session starts the microphone
    fireEvent.click(screen.getByRole('button', { name: 'Live session' }))
    const recognition = FakeRecognition.last!

    // First recognized phrase: a NEW slide — carousel moves to it. The
    // closure is stale (captured before the slide existed): the counter
    // must still land on 3 / 3
    act(() => {
      recognition.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript: 'a third topic' } }],
      })
    })
    expect(await screen.findByText('3 / 3')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Third slide' }),
    ).toBeInTheDocument()

    // Navigate away, then an UPDATE to that slide pulls the view back
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    act(() => {
      recognition.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript: 'more on that' } }],
      })
    })
    expect(await screen.findByText('3 / 3')).toBeInTheDocument()
    expect(screen.getByText('Body extended')).toBeInTheDocument()

    // In list view, generation events center the changed slide
    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    scrolled.mockClear()
    act(() => {
      recognition.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript: 'and more' } }],
      })
    })
    await vi.waitFor(() => expect(scrolled).toHaveBeenCalled())
  })

  it('wake-worded voice commands act locally and never reach generation', async () => {
    FakeRecognition.reset()
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    let generationCalls = 0
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: { ...deckView, canEdit: true },
      }),
      '/api/actions/session.phrase': () => {
        generationCalls++
        return { status: 200, body: { kind: 'none' } }
      },
    })
    render(
      <MemoryRouter initialEntries={['/d/shared-abc123']}>
        <AuthProvider>
          <Routes>
            <Route path="/d/:slug" element={<DeckViewerPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )
    await screen.findByText('Shared Lecture')
    fireEvent.click(screen.getByRole('button', { name: 'Live session' }))
    const recognition = FakeRecognition.last!
    const speak = (transcript: string) =>
      act(() => {
        recognition.onresult?.({
          resultIndex: 0,
          results: [{ isFinal: true, 0: { transcript } }],
        })
      })

    // Navigation commands move the carousel without generating
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    speak('Slide machine, next slide')
    expect(await screen.findByText('2 / 2')).toBeInTheDocument()
    speak('slide machine go back')
    expect(await screen.findByText('1 / 2')).toBeInTheDocument()
    expect(generationCalls).toBe(0)

    // Without the wake word, the same words are lecture content
    speak('next slide')
    await vi.waitFor(() => expect(generationCalls).toBe(1))

    // Pause stops the microphone
    const stopSpy = vi.spyOn(recognition, 'stop')
    speak('slide machine, pause')
    expect(stopSpy).toHaveBeenCalled()
  })

  it('transcribed phrases flow through session.phrase', async () => {
    FakeRecognition.reset()
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    let sent: unknown
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: { ...deckView, canEdit: true },
      }),
      '/api/actions/session.phrase': init => {
        sent = JSON.parse(String(init?.body))
        return { status: 200, body: { kind: 'none' } }
      },
    })
    render(
      <MemoryRouter initialEntries={['/d/shared-abc123']}>
        <AuthProvider>
          <Routes>
            <Route path="/d/:slug" element={<DeckViewerPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )
    await screen.findByText('Shared Lecture')
    // The Live session toggle opens the bar AND starts capture
    const toggle = screen.getByRole('button', { name: 'Live session' })
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(FakeRecognition.last).not.toBeNull()
    // Recording state pulsates red so capture is unmistakable
    expect(toggle.className).toContain('animate-pulse')
    expect(toggle.className).toContain('text-red-600')

    const recognition = FakeRecognition.last!
    // Interim text shows without dispatching
    act(() => {
      recognition.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: false, 0: { transcript: 'photosynthesis ba' } }],
      })
    })
    expect(screen.getByText('photosynthesis ba')).toBeInTheDocument()
    expect(sent).toBeUndefined()

    // A final phrase dispatches through the same pipeline as typing
    act(() => {
      recognition.onresult?.({
        resultIndex: 0,
        results: [
          { isFinal: true, 0: { transcript: 'photosynthesis basics' } },
        ],
      })
    })
    await vi.waitFor(() =>
      expect(sent).toEqual({
        deckId: 'deck1',
        phrase: 'photosynthesis basics',
      }),
    )

    // Toggling off closes the bar and stops the microphone
    const stopSpy = vi.spyOn(recognition, 'stop')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(stopSpy).toHaveBeenCalled()
    expect(toggle.className).not.toContain('animate-pulse')
    expect(
      screen.queryByRole('textbox', { name: 'Spoken phrase' }),
    ).not.toBeInTheDocument()
  })
})

describe('DeckViewerPage slide reordering', () => {
  it('lets owners reorder focused rows in list view via Alt+arrows', async () => {
    let reorderBody: unknown
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: { ...deckView, canEdit: true },
      }),
      '/api/actions/deck.reorderSlides': init => {
        reorderBody = JSON.parse(String(init?.body))
        return {
          status: 200,
          body: { ...deckView.deck, slideOrder: ['s2', 's1'] },
        }
      },
    })
    render(
      <MemoryRouter initialEntries={['/d/shared-abc123']}>
        <AuthProvider>
          <Routes>
            <Route path="/d/:slug" element={<DeckViewerPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )
    await screen.findByText('Shared Lecture')
    fireEvent.click(screen.getByRole('button', { name: 'List view' }))

    // Slide 1 (title layout) moves down past slide 2 (content layout)
    fireEvent.keyDown(screen.getByRole('listitem', { name: 'Slide 1' }), {
      key: 'ArrowDown',
      altKey: true,
    })

    await vi.waitFor(() =>
      expect(reorderBody).toMatchObject({ slideOrder: ['s2', 's1'] }),
    )
    const slides = screen.getAllByTestId('slide')
    expect(slides[0]).toHaveAttribute('data-layout', 'content')
    expect(slides[1]).toHaveAttribute('data-layout', 'title')
  })

  it('gives non-owners plain, non-draggable rows', async () => {
    renderViewer(401)
    await screen.findByText('Shared Lecture')
    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    expect(
      screen.queryByRole('listitem', { name: /slide \d/i }),
    ).not.toBeInTheDocument()
  })
})

describe('DeckViewerPage settings modal', () => {
  const withSettingsRoutes = () =>
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: { ...deckView, canEdit: true },
      }),
      '/api/actions/template.list': () => ({
        status: 200,
        body: [
          deckView.template,
          { ...deckView.template, id: 'midnight', name: 'Midnight' },
        ],
      }),
      '/api/actions/deck.switchTemplate': () => ({
        status: 200,
        body: { ...deckView.deck, templateId: 'midnight' },
      }),
      '/api/actions/deck.shares': () => ({ status: 200, body: [] }),
      '/api/actions/deck.setSeedNotes': init => {
        seedNotesBody = JSON.parse(String(init?.body))
        return {
          status: 200,
          body: { ...deckView.deck, seedContext: 'Tuning fork demo' },
        }
      },
    })

  let seedNotesBody: unknown

  const renderWithSettings = () =>
    render(
      <MemoryRouter initialEntries={['/d/shared-abc123']}>
        <AuthProvider>
          <Routes>
            <Route path="/d/:slug" element={<DeckViewerPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )

  it('auto-saves lecture seed notes from the settings modal', async () => {
    vi.useFakeTimers()
    withSettingsRoutes()
    renderWithSettings()
    await vi.waitFor(() =>
      expect(screen.getByText('Shared Lecture')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Lecture settings' }))

    const box = await vi.waitFor(() =>
      screen.getByRole('textbox', { name: 'Lecture seed notes' }),
    )
    fireEvent.change(box, { target: { value: 'Tuning fork demo' } })
    vi.advanceTimersByTime(800)

    await vi.waitFor(() =>
      expect(seedNotesBody).toEqual({
        deckId: 'deck1',
        seedContext: 'Tuning fork demo',
      }),
    )
    vi.useRealTimers()
  })

  it('deletes the lecture from the Danger zone after confirmation', async () => {
    let deleted = false
    withSettingsRoutes()
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: { ...deckView, canEdit: true },
      }),
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
      '/api/actions/deck.shares': () => ({ status: 200, body: [] }),
      '/api/actions/seedAsset.list': () => ({ status: 200, body: [] }),
      '/api/actions/deck.delete': () => {
        deleted = true
        return { status: 200, body: { deleted: true } }
      },
    })
    render(
      <MemoryRouter initialEntries={['/d/shared-abc123']}>
        <AuthProvider>
          <Routes>
            <Route path="/d/:slug" element={<DeckViewerPage />} />
            <Route path="/app" element={<div>HOME</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )
    await screen.findByText('Shared Lecture')
    fireEvent.click(screen.getByRole('button', { name: 'Lecture settings' }))

    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete lecture' }),
    )
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Delete lecture?',
    })
    expect(dialog).toBeInTheDocument()

    // Cancel keeps everything
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(deleted).toBe(false)
    expect(
      screen.queryByRole('alertdialog', { name: 'Delete lecture?' }),
    ).not.toBeInTheDocument()

    // Confirm deletes and leaves for home
    fireEvent.click(screen.getByRole('button', { name: 'Delete lecture' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('HOME')).toBeInTheDocument()
    expect(deleted).toBe(true)
  })

  it('hides the Danger zone from non-owner editors', async () => {
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'editor9', displayName: 'Ed' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: { ...deckView, canEdit: true },
      }),
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
      '/api/actions/deck.shares': () => ({ status: 200, body: [] }),
      '/api/actions/seedAsset.list': () => ({ status: 200, body: [] }),
    })
    renderWithSettings()
    await screen.findByText('Shared Lecture')
    fireEvent.click(screen.getByRole('button', { name: 'Lecture settings' }))
    await screen.findByRole('tab', { name: 'General' })
    expect(
      screen.queryByRole('button', { name: 'Delete lecture' }),
    ).not.toBeInTheDocument()
  })

  it('opens settings on the sharing tab when deep-linked', async () => {
    withSettingsRoutes()
    render(
      <MemoryRouter
        initialEntries={[
          { pathname: '/d/shared-abc123', state: { settingsTab: 'sharing' } },
        ]}
      >
        <AuthProvider>
          <Routes>
            <Route path="/d/:slug" element={<DeckViewerPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('dialog', { name: 'Lecture settings' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('tab', { name: 'Privacy & Sharing' }),
    ).toHaveAttribute('aria-selected', 'true')
    expect(
      await screen.findByRole('group', { name: 'General access' }),
    ).toBeInTheDocument()
  })

  it('divides settings into tabs with arrow-key navigation', async () => {
    withSettingsRoutes()
    renderWithSettings()
    await screen.findByText('Shared Lecture')
    fireEvent.click(screen.getByRole('button', { name: 'Lecture settings' }))

    // The subtitle scopes the modal and links to project-wide settings
    expect(
      await screen.findByText(/apply to just this lecture/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'project-wide settings' }),
    ).toHaveAttribute('href', '/app/projects/p1')

    // General is the default tab: seed notes + uploads live here
    const general = await screen.findByRole('tab', { name: 'General' })
    expect(general).toHaveAttribute('aria-selected', 'true')
    expect(
      screen.getByRole('textbox', { name: 'Lecture seed notes' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Upload seed material')).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()

    // Privacy & Sharing holds the access controls
    fireEvent.click(screen.getByRole('tab', { name: 'Privacy & Sharing' }))
    expect(
      screen.getByRole('group', { name: 'General access' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('textbox', { name: 'Lecture seed notes' }),
    ).not.toBeInTheDocument()

    // Arrow keys walk the tab list (wrapping)
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' })
    expect(
      screen.getByRole('tab', { name: 'Privacy & Sharing' }),
    ).toHaveAttribute('aria-selected', 'true')
  })

  it('opens from the gear, switches templates, and closes from the icon', async () => {
    withSettingsRoutes()
    renderWithSettings()
    await screen.findByText('Shared Lecture')

    fireEvent.click(screen.getByRole('button', { name: 'Lecture settings' }))
    expect(
      await screen.findByRole('dialog', { name: 'Lecture settings' }),
    ).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('tab', { name: 'Design template' }))

    fireEvent.click(await screen.findByRole('radio', { name: /midnight/i }))
    await vi.waitFor(() =>
      expect(screen.getByRole('radio', { name: /midnight/i })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    withSettingsRoutes()
    renderWithSettings()
    await screen.findByText('Shared Lecture')

    fireEvent.click(screen.getByRole('button', { name: 'Lecture settings' }))
    await screen.findByRole('dialog', { name: 'Lecture settings' })

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('hides the settings gear from non-owners', async () => {
    renderViewer(401)
    await screen.findByText('Shared Lecture')
    expect(
      screen.queryByRole('button', { name: 'Lecture settings' }),
    ).not.toBeInTheDocument()
  })
})

describe('DeckViewerPage title in the primary nav', () => {
  it('teleports the deck title into the shell header in place of the brand', async () => {
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: { ...deckView, canEdit: true },
      }),
      '/api/health': () => ({
        status: 200,
        body: { status: 'ok', mongo: 'connected', uptime: 1, version: '0' },
      }),
    })
    render(
      <MemoryRouter initialEntries={['/d/shared-abc123']}>
        <AuthProvider>
          <ShellTitleProvider>
            <Routes>
              <Route element={<PublicShell />}>
                <Route path="/d/:slug" element={<DeckViewerPage />} />
              </Route>
            </Routes>
          </ShellTitleProvider>
        </AuthProvider>
      </MemoryRouter>,
    )

    // The deck title renders as the page heading inside the nav banner
    const heading = await screen.findByRole('heading', {
      name: 'Shared Lecture',
    })
    expect(heading.closest('header')).not.toBeNull()
    // The brand text yields a commit after the portal lands, hence waitFor;
    // the home icon link remains
    await vi.waitFor(() =>
      expect(screen.queryByText('The Slide Machine')).not.toBeInTheDocument(),
    )
    expect(
      screen.getByRole('link', { name: /the slide machine — home/i }),
    ).toBeInTheDocument()
    // Owners can still edit the title in place, now inside the nav
    expect(screen.getByTitle('Click to edit Lecture title')).toBeInTheDocument()
    // Slide count and modification age sit beside the title, outside
    // the heading so they don't pollute its accessible name
    const meta = screen.getByText(/slides · edited 2 minutes ago/)
    expect(meta.closest('header')).not.toBeNull()
    expect(heading.contains(meta)).toBe(false)
  })

  it('shows empty titles as "Untitled lecture" in the nav', async () => {
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: {
          ...deckView,
          deck: { ...deckView.deck, title: '' },
          canEdit: true,
        },
      }),
    })
    render(
      <MemoryRouter initialEntries={['/d/shared-abc123']}>
        <AuthProvider>
          <Routes>
            <Route path="/d/:slug" element={<DeckViewerPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Untitled lecture')).toBeInTheDocument()
    // Editing still starts from the real (empty) value
    fireEvent.click(screen.getByTitle('Click to edit Lecture title'))
    expect(screen.getByRole('textbox', { name: 'Lecture title' })).toHaveValue(
      '',
    )
  })

  it('guides editors of empty decks to the plus and microphone icons', async () => {
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: {
          ...deckView,
          slides: [],
          deck: { ...deckView.deck, slideOrder: [] },
          canEdit: true,
        },
      }),
    })
    render(
      <MemoryRouter initialEntries={['/d/shared-abc123']}>
        <AuthProvider>
          <Routes>
            <Route path="/d/:slug" element={<DeckViewerPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )
    expect(
      await screen.findByText(/icons to start adding content/),
    ).toBeInTheDocument()
    // The actual icons ride inline in the message
    expect(screen.getByLabelText('plus')).toBeInTheDocument()
    expect(screen.getByLabelText('microphone')).toBeInTheDocument()
    expect(screen.queryByText('This deck has no slides.')).toBeNull()
  })

  it('refreshes the edited age immediately after an auto-save', async () => {
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: { ...deckView, canEdit: true },
      }),
      '/api/actions/slide.add': () => ({
        status: 200,
        body: {
          id: 's9',
          deckId: 'deck1',
          index: 2,
          layoutType: 'content',
          title: 'New slide',
          body: 'Click to edit',
        },
      }),
    })
    render(
      <MemoryRouter initialEntries={['/d/shared-abc123']}>
        <AuthProvider>
          <Routes>
            <Route path="/d/:slug" element={<DeckViewerPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByText(/edited 2 minutes ago/)).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: 'Add slide' }))

    // The local stamp lands as soon as the save resolves — no reload
    expect(await screen.findByText(/edited just now/)).toBeInTheDocument()
  })
})
