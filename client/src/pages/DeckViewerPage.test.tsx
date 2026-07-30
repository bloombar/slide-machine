/**
 * Unit tests for the deck viewer: the Resume affordance appears for the
 * deck's owner only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { AuthProvider } from '../auth/AuthContext'
import { setAccessToken } from '../auth/token'
import DeckViewerPage from './DeckViewerPage'
import PublicShell from '../components/layout/PublicShell'
import { ShellTitleProvider } from '../components/layout/ShellTitle'
import { resetAdminStatus } from '../hooks/useIsAdmin'
import { mockFetchRoutes } from '../test/fetch-mock'
import * as runtimeConfig from '../runtime-config'

// The GSAP layout flip is unit-tested in lib/layoutFlip.test.ts; here it
// is replaced by an instant apply that records which slides requested a
// morph, so page tests can assert WHEN a transition happens without
// animating in jsdom.
const flip = vi.hoisted(() => ({ calls: [] as string[] }))
vi.mock('../lib/layoutFlip', () => ({
  runLayoutFlip: (slideId: string, update: () => void) => {
    flip.calls.push(slideId)
    update()
    return Promise.resolve()
  },
}))

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
  flip.calls.length = 0
  // Most specs drive a live session by typing phrases, which is the debug-only
  // simulated-speech box; the gate itself is covered by its own tests below.
  vi.spyOn(runtimeConfig, 'getSimulatedSpeechEnabled').mockReturnValue(true)
  // The view mode now persists in localStorage; clear it so one test's
  // choice does not leak into the next
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
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

  // The typed-phrase box is a debugging aid for driving a session without a
  // microphone; real STT is what users get, so a live session shows nothing
  // extra unless the server turns the flag on.
  it('hides the simulated-speech box unless the debug flag is on', async () => {
    vi.spyOn(runtimeConfig, 'getSimulatedSpeechEnabled').mockReturnValue(false)
    renderViewer(200)
    fireEvent.click(await screen.findByRole('button', { name: 'Live session' }))
    expect(
      screen.queryByRole('textbox', { name: 'Spoken phrase' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Speak' }),
    ).not.toBeInTheDocument()
  })

  it('opens the privacy & sharing settings when Share is clicked', async () => {
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
    fireEvent.click(await screen.findByRole('button', { name: 'Share deck' }))
    expect(
      await screen.findByRole('dialog', { name: 'Lecture settings' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('tab', { name: 'Privacy & Sharing' }),
    ).toHaveAttribute('aria-selected', 'true')
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

  it('restores the saved view mode on load, so a refresh keeps it', async () => {
    localStorage.setItem('sm:view-mode', 'list')
    renderViewer(401)
    await screen.findByText('Shared Lecture')
    // List view is active from the start — all slides stacked
    expect(screen.getAllByTestId('slide')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'List view' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('remembers a switch to list view', async () => {
    renderViewer(401)
    await screen.findByText('Shared Lecture')
    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    expect(localStorage.getItem('sm:view-mode')).toBe('list')
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

    fireEvent.click(screen.getByRole('button', { name: 'Options for slide 1' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete slide' }))

    // No confirmation: the first slide is gone; the second becomes current
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

describe('DeckViewerPage spoken transcript editing (EDIT-6)', () => {
  /** One whiteboard mark, timed to the narration below. */
  const mark = {
    id: 'stroke-1',
    tool: 'pen',
    color: '#1e293b',
    thickness: 0.01,
    points: [{ x: 0.2, y: 0.3 }],
    startedAt: '2026-07-21T10:00:00.000Z',
    endedAt: '2026-07-21T10:00:01.000Z',
    anchor: {
      charAnchor: 2,
      source: 'word',
      phraseText: 'A cell is the basic unit of life.',
      phraseOffset: 0.06,
    },
  }

  /** A deck whose first slide has a narration and that mark. */
  const narratedSlide = {
    ...deckView.slides[0],
    sourceTranscript: 'A cell is the basic unit of life.',
    drawings: [mark],
  }
  const narratedDeck = {
    ...deckView,
    slides: [narratedSlide, deckView.slides[1]],
    canEdit: true,
  }

  it('edits and saves a slide transcript from the kebab', async () => {
    const calls: unknown[] = []
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({ status: 200, body: narratedDeck }),
      '/api/actions/slide.editTranscript': init => {
        const body = JSON.parse(String(init?.body))
        calls.push(body)
        return {
          status: 200,
          body: {
            ...narratedSlide,
            sourceTranscript: body.transcript,
            // The server re-anchors the mark onto the saved text (WB-2).
            drawings: [{ ...mark, anchor: { ...mark.anchor, charAnchor: 0 } }],
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

    fireEvent.click(screen.getByRole('button', { name: 'Options for slide 1' }))
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Edit spoken transcript' }),
    )

    const field = screen.getByRole('textbox', { name: 'Spoken transcript' })
    expect(field).toHaveValue('A cell is the basic unit of life.')
    // The slide carries a mark, so the re-anchoring note is shown.
    expect(
      screen.getByText(/whiteboard markings timed to the transcript/i),
    ).toBeInTheDocument()

    fireEvent.change(field, {
      target: { value: 'Cells are the basic unit of life.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save transcript' }))

    await vi.waitFor(() =>
      expect(calls).toEqual([
        { slideId: 's1', transcript: 'Cells are the basic unit of life.' },
      ]),
    )
    // The dialog closes, and reopening shows the saved text.
    await vi.waitFor(() =>
      expect(
        screen.queryByRole('textbox', { name: 'Spoken transcript' }),
      ).not.toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Options for slide 1' }))
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Edit spoken transcript' }),
    )
    expect(
      screen.getByRole('textbox', { name: 'Spoken transcript' }),
    ).toHaveValue('Cells are the basic unit of life.')
  })

  it('hides the transcript editor from non-owners', async () => {
    // TTS on, so a read-only viewer still gets a kebab — with Speak only.
    vi.spyOn(runtimeConfig, 'getTtsEnabled').mockReturnValue(true)
    renderViewer(401)
    await screen.findByText('Shared Lecture')

    fireEvent.click(screen.getByRole('button', { name: 'Options for slide 1' }))
    expect(
      screen.getByRole('menuitem', { name: 'Speak this slide' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'Edit spoken transcript' }),
    ).not.toBeInTheDocument()
  })
})

describe('DeckViewerPage per-slide refine (GEN-4/WB-1)', () => {
  const refineRoutes = (body: object, onRefine?: () => void) => ({
    '/api/auth/refresh': () => ({
      status: 200,
      body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
    }),
    '/api/decks/shared-abc123': () => ({ status: 200, body }),
    '/api/actions/deck.refineSlide': () => {
      onRefine?.()
      return {
        status: 200,
        body: {
          slide: { id: 's1', deckId: 'deck1', index: 0, layoutType: 'content' },
          refined: true,
          narrationUpdated: false,
        },
      }
    },
  })

  const renderDeck = () =>
    render(
      <MemoryRouter initialEntries={['/d/shared-abc123']}>
        <AuthProvider>
          <Routes>
            <Route path="/d/:slug" element={<DeckViewerPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )

  /** Opens the kebab's refine dialog for slide 1. */
  const openRefineDialog = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Options for slide 1' }))
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Refine this slide with AI' }),
    )
  }

  it('opens the options dialog instead of refining straight away', async () => {
    let refined = false
    mockFetchRoutes(
      refineRoutes({ ...deckView, canEdit: true }, () => (refined = true)),
    )
    renderDeck()
    await screen.findByText('Shared Lecture')

    openRefineDialog()
    expect(
      screen.getByRole('dialog', { name: /Refine this slide with AI/i }),
    ).toBeInTheDocument()
    // Nothing runs until the user picks what to do and confirms.
    expect(refined).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Refine' }))
    await vi.waitFor(() => expect(refined).toBe(true))
  })

  it('warns when the slide carries whiteboard marks', async () => {
    const marked = {
      ...deckView,
      deck: { ...deckView.deck, slideOrder: ['s1'] },
      canEdit: true,
      slides: [
        {
          id: 's1',
          deckId: 'deck1',
          index: 0,
          layoutType: 'content',
          title: 'Marked',
          body: 'Body',
          drawings: [{ id: 'st1', tool: 'pen' }],
        },
      ],
    }
    mockFetchRoutes(refineRoutes(marked))
    renderDeck()
    await screen.findByText('Shared Lecture')

    openRefineDialog()
    // Refining can reflow content out from under the annotations (WB-1).
    expect(screen.getByText(/whiteboard markings/i)).toBeInTheDocument()
  })

  it('morphs the layout when the AI refine lands on a new one (GEN-9)', async () => {
    // s1 starts on the title layout and the refine response moves it to
    // content — the swap must go through the animated layout flip, just
    // like a manual layout switch.
    mockFetchRoutes(refineRoutes({ ...deckView, canEdit: true }))
    renderDeck()
    await screen.findByText('Shared Lecture')

    openRefineDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Refine' }))

    await vi.waitFor(() => expect(flip.calls).toEqual(['s1']))
    expect(screen.getByTestId('slide')).toHaveAttribute(
      'data-layout',
      'content',
    )
  })

  it('applies a same-layout refine instantly — no morph', async () => {
    // s1 is already on the layout the refine returns, so the patch must
    // commit without requesting a transition.
    const sameLayout = {
      ...deckView,
      canEdit: true,
      slides: [
        { ...deckView.slides[0]!, layoutType: 'content' },
        deckView.slides[1]!,
      ],
    }
    mockFetchRoutes(refineRoutes(sameLayout))
    renderDeck()
    await screen.findByText('Shared Lecture')

    openRefineDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Refine' }))

    // The refined slide (no title) replaces s1 — the commit landed…
    await vi.waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Hello' })).toBeNull(),
    )
    // …without a flip.
    expect(flip.calls).toEqual([])
  })
})

describe('DeckViewerPage AI layout refit (GEN-9)', () => {
  it('morphs when a session.phrase update changes the slide layout', async () => {
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: { ...deckView, canEdit: true },
      }),
      '/api/actions/session.phrase': () => ({
        status: 200,
        body: {
          kind: 'slide.update',
          slide: {
            id: 's1',
            deckId: 'deck1',
            index: 0,
            layoutType: 'content',
            title: 'Hello',
            body: 'Refit body',
          },
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

    // Type a phrase into the Speak bar: the AI re-fits s1 from the title
    // layout onto content — an animated morph, not a snap (GEN-9).
    fireEvent.click(screen.getByRole('button', { name: 'Live session' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Spoken phrase' }), {
      target: { value: 'more about this' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Speak' }))

    await vi.waitFor(() => expect(flip.calls).toEqual(['s1']))
    expect(screen.getByTestId('slide')).toHaveAttribute(
      'data-layout',
      'content',
    )
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

  it('shows the server message when generation is unavailable (quota/credits)', async () => {
    FakeRecognition.reset()
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: { ...deckView, canEdit: true },
      }),
      '/api/actions/session.phrase': () => ({
        status: 503,
        body: {
          error: {
            code: 'generation_unavailable',
            message:
              'Slide generation is unavailable — the AI provider is out of quota or credits.',
          },
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
    fireEvent.click(screen.getByRole('button', { name: 'Live session' }))
    act(() => {
      FakeRecognition.last!.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript: 'photosynthesis' } }],
      })
    })
    // The provider's user-facing message is shown, not a generic 500.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /out of quota or credits/,
    )
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

  it('creates a new slide when "next" is spoken at the end of the deck', async () => {
    FakeRecognition.reset()
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    let addCalls = 0
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: { ...deckView, canEdit: true },
      }),
      '/api/actions/slide.add': () => {
        addCalls++
        return {
          status: 200,
          body: {
            id: 's3',
            deckId: 'deck1',
            index: 2,
            layoutType: 'content',
            title: 'New slide',
            body: 'Click to edit',
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
    fireEvent.click(screen.getByRole('button', { name: 'Live session' }))
    const recognition = FakeRecognition.last!
    const speak = (transcript: string) =>
      act(() => {
        recognition.onresult?.({
          resultIndex: 0,
          results: [{ isFinal: true, 0: { transcript } }],
        })
      })

    // Advance to the last slide, then "next" again creates a new one.
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    speak('slide machine, next slide')
    expect(await screen.findByText('2 / 2')).toBeInTheDocument()
    expect(addCalls).toBe(0)

    speak('slide machine, next slide')
    expect(await screen.findByText('3 / 3')).toBeInTheDocument()
    expect(screen.getByText('New slide')).toBeInTheDocument()
    expect(addCalls).toBe(1)
  })

  it('creates a whiteboard slide on a "new whiteboard" voice command', async () => {
    FakeRecognition.reset()
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    let addBody: Record<string, unknown> | null = null
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: { ...deckView, canEdit: true },
      }),
      '/api/actions/slide.add': init => {
        addBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return {
          status: 200,
          body: {
            id: 's3',
            deckId: 'deck1',
            index: 2,
            layoutType: 'whiteboard',
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
    fireEvent.click(screen.getByRole('button', { name: 'Live session' }))
    const recognition = FakeRecognition.last!

    // The wake-worded command creates a slide with the whiteboard layout —
    // same as the toolbar's new-whiteboard button.
    act(() => {
      recognition.onresult?.({
        resultIndex: 0,
        results: [
          { isFinal: true, 0: { transcript: 'slide machine, new whiteboard' } },
        ],
      })
    })
    await vi.waitFor(() => expect(addBody).not.toBeNull())
    expect(addBody!.layoutType).toBe('whiteboard')
  })

  it('pauses generation on a whiteboard slide, resuming only on click', async () => {
    FakeRecognition.reset()
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    const phrases: Array<Record<string, unknown>> = []
    const wbDeck = {
      ...deckView,
      deck: { ...deckView.deck, slideOrder: ['s1'] },
      slides: [
        { id: 's1', deckId: 'deck1', index: 0, layoutType: 'whiteboard' },
      ],
    }
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: { ...wbDeck, canEdit: true },
      }),
      '/api/actions/session.phrase': init => {
        phrases.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
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

    // On the whiteboard canvas, generation is paused with a manual Resume
    // (no debounce auto-resume).
    expect(
      await screen.findByText('Content generation paused for drawing'),
    ).toBeInTheDocument()
    const recognition = FakeRecognition.last!
    const speak = (transcript: string) =>
      act(() => {
        recognition.onresult?.({
          resultIndex: 0,
          results: [{ isFinal: true, 0: { transcript } }],
        })
      })

    // A phrase while paused is still sent (recorded) but flagged so the server
    // skips generation.
    speak('narrating while I draw')
    await vi.waitFor(() => expect(phrases).toHaveLength(1))
    expect(phrases[0]!.pauseGeneration).toBe(true)

    // Resume flips the pill and lets the next phrase generate normally.
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(
      await screen.findByText('Content generation resumed'),
    ).toBeInTheDocument()
    speak('now generate a slide from this')
    await vi.waitFor(() => expect(phrases).toHaveLength(2))
    expect(phrases[1]!.pauseGeneration).toBeUndefined()
  })

  it('resumes the whiteboard pause on a "resume" voice command', async () => {
    FakeRecognition.reset()
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    const phrases: Array<Record<string, unknown>> = []
    const wbDeck = {
      ...deckView,
      deck: { ...deckView.deck, slideOrder: ['s1'] },
      slides: [
        { id: 's1', deckId: 'deck1', index: 0, layoutType: 'whiteboard' },
      ],
    }
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: { ...wbDeck, canEdit: true },
      }),
      '/api/actions/session.phrase': init => {
        phrases.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
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

    expect(
      await screen.findByText('Content generation paused for drawing'),
    ).toBeInTheDocument()
    const recognition = FakeRecognition.last!
    const speak = (transcript: string) =>
      act(() => {
        recognition.onresult?.({
          resultIndex: 0,
          results: [{ isFinal: true, 0: { transcript } }],
        })
      })

    speak('narrating while I draw')
    await vi.waitFor(() => expect(phrases).toHaveLength(1))
    expect(phrases[0]!.pauseGeneration).toBe(true)

    // Spoken resume behaves exactly like clicking Resume: the pill confirms,
    // and the command itself never reaches generation.
    speak('slide machine, resume')
    expect(
      await screen.findByText('Content generation resumed'),
    ).toBeInTheDocument()
    expect(phrases).toHaveLength(1)

    // The next phrase generates normally — the pause is genuinely lifted.
    speak('now generate a slide from this')
    await vi.waitFor(() => expect(phrases).toHaveLength(2))
    expect(phrases[1]!.pauseGeneration).toBeUndefined()
  })

  it('ignores a "resume" command when generation is not paused', async () => {
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

    // Nothing is paused, so there is no Resume button to click and the spoken
    // equivalent is a no-op: no confirmation, no navigation, no generation.
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    act(() => {
      recognition.onresult?.({
        resultIndex: 0,
        results: [
          { isFinal: true, 0: { transcript: 'slide machine, continue' } },
        ],
      })
    })
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    expect(
      screen.queryByText('Content generation resumed'),
    ).not.toBeInTheDocument()
    expect(generationCalls).toBe(0)
  })

  it('resumes the whiteboard pause when a new regular slide is made', async () => {
    FakeRecognition.reset()
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    const wbDeck = {
      ...deckView,
      deck: { ...deckView.deck, slideOrder: ['s1'] },
      slides: [
        { id: 's1', deckId: 'deck1', index: 0, layoutType: 'whiteboard' },
      ],
    }
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: { ...wbDeck, canEdit: true },
      }),
      '/api/actions/slide.add': () => ({
        status: 200,
        body: {
          id: 's2',
          deckId: 'deck1',
          index: 1,
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
    fireEvent.click(screen.getByRole('button', { name: 'Live session' }))
    expect(
      await screen.findByText('Content generation paused for drawing'),
    ).toBeInTheDocument()
    const recognition = FakeRecognition.last!
    // A "new slide" command makes a regular slide, which resumes generation.
    act(() => {
      recognition.onresult?.({
        resultIndex: 0,
        results: [
          { isFinal: true, 0: { transcript: 'slide machine, new slide' } },
        ],
      })
    })
    expect(
      await screen.findByText('Content generation resumed'),
    ).toBeInTheDocument()
  })

  it('resumes the drawing pause shortly after the tool is deselected', async () => {
    FakeRecognition.reset()
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    // Canvas/pointer stubs so the drawing layer accepts a gesture in jsdom.
    Element.prototype.setPointerCapture = vi.fn()
    Element.prototype.releasePointerCapture = vi.fn()
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
    })) as unknown as HTMLCanvasElement['getContext']
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    // A single regular (content) slide: drawing here uses the debounce pause,
    // not a whiteboard slide's manual-only pause.
    const contentDeck = {
      ...deckView,
      deck: { ...deckView.deck, slideOrder: ['s2'] },
      slides: [
        {
          id: 's2',
          deckId: 'deck1',
          index: 0,
          layoutType: 'content',
          title: 'Second',
          body: 'More detail',
        },
      ],
    }
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: { ...contentDeck, canEdit: true },
      }),
      '/api/actions/session.phrase': () => ({
        status: 200,
        body: { kind: 'none' },
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
    fireEvent.click(screen.getByRole('button', { name: 'Live session' }))

    // Arm the pen and draw: generation pauses (drawing mode).
    fireEvent.click(screen.getByRole('button', { name: 'Pen' }))
    fireEvent.pointerDown(screen.getAllByTestId('drawing-layer')[0]!, {
      pointerId: 1,
      button: 0,
      clientX: 20,
      clientY: 40,
    })
    fireEvent.pointerUp(screen.getAllByTestId('drawing-layer')[0]!, {
      pointerId: 1,
    })
    expect(
      await screen.findByText('Content generation paused for drawing'),
    ).toBeInTheDocument()

    // Putting the pen away (deselecting it) resumes after the short grace —
    // well before the 5s draw-idle debounce would have.
    fireEvent.click(screen.getByRole('button', { name: 'Pen' }))
    expect(
      await screen.findByText('Content generation resumed'),
    ).toBeInTheDocument()
  })

  it('executes AI-recognized command events from session.phrase', async () => {
    FakeRecognition.reset()
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    // The server (flag on) recognizes the first phrase as "next" and
    // the second as "pause"; the client must execute both exactly like
    // wake-worded commands
    const commands = ['next', 'pause']
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: { ...deckView, canEdit: true },
      }),
      '/api/actions/session.phrase': () => ({
        status: 200,
        body: { kind: 'command', command: commands.shift() },
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
    fireEvent.click(screen.getByRole('button', { name: 'Live session' }))
    const recognition = FakeRecognition.last!
    const speak = (transcript: string) =>
      act(() => {
        recognition.onresult?.({
          resultIndex: 0,
          results: [{ isFinal: true, 0: { transcript } }],
        })
      })

    // No wake word: the phrase reaches the server, which flags it as a
    // command — the carousel moves and no slide is created
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    speak('please move on')
    expect(await screen.findByText('2 / 2')).toBeInTheDocument()

    // A server-recognized pause stops the microphone
    const stopSpy = vi.spyOn(recognition, 'stop')
    speak('please pause')
    await vi.waitFor(() => expect(stopSpy).toHaveBeenCalled())
  })

  it('surfaces a dead microphone: rapid capture failures stop listening and show an error', async () => {
    FakeRecognition.reset()
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: { ...deckView, canEdit: true },
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
    fireEvent.click(screen.getByRole('button', { name: 'Live session' }))
    const recognition = FakeRecognition.last!
    expect(
      screen.getByPlaceholderText('Listening… (you can still type)'),
    ).toBeInTheDocument()

    // The speech service dies: immediate start→end cycles until capture
    // gives up — the failure must be visible, not a silent hot mic
    act(() => {
      for (let i = 0; i < 10; i++) recognition.onend?.()
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Microphone unavailable — speech recognition keeps stopping',
    )
    // Listening flipped off: the bar stays open but the mic is no longer hot
    expect(
      screen.getByPlaceholderText('Say something about your topic…'),
    ).toBeInTheDocument()
    // The mic's tooltip reverts to its idle label rather than "Recording"
    expect(screen.getByText('Speak to add slides')).toBeInTheDocument()
    expect(
      screen.queryByText('Recording — click to stop'),
    ).not.toBeInTheDocument()
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
    // Recording state fills solid red and pulses so capture is unmistakable
    expect(toggle.className).toContain('animate-pulse')
    expect(toggle.className).toContain('bg-red-600')
    expect(toggle.className).toContain('text-white')

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
        // The browser tag rides along as the cascade's last resort
        browserLanguage: navigator.language,
        // The recording session id threads through to session.phrase (GEN-4)
        sessionId: expect.any(String),
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

  it('retitles the header when a SlideEvent carries an AI deck title', async () => {
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
      '/api/actions/session.phrase': () => ({
        status: 200,
        body: { kind: 'none', deckTitle: 'Photosynthesis Basics' },
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
    await screen.findByText('Untitled lecture')
    fireEvent.click(screen.getByRole('button', { name: 'Live session' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Spoken phrase' }), {
      target: { value: 'photosynthesis converts light' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Speak' }))

    // The server saved the AI title; the header follows immediately
    expect(await screen.findByText('Photosynthesis Basics')).toBeInTheDocument()
    expect(screen.queryByText('Untitled lecture')).not.toBeInTheDocument()
  })

  it('restarts recognition when the lecture language changes mid-recording', async () => {
    FakeRecognition.reset()
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    let saved: unknown
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: { ...deckView, canEdit: true, projectLanguage: 'ru' },
      }),
      '/api/actions/deck.setLanguage': init => {
        saved = JSON.parse(String(init?.body))
        return { status: 200, body: { ...deckView.deck, language: 'fr' } }
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

    // No lecture override: the project's language drives recognition
    const first = FakeRecognition.last!
    expect(first.lang).toBe('ru')

    // Switch the lecture language from settings while recording
    fireEvent.click(screen.getByRole('button', { name: 'Lecture settings' }))
    const select = await screen.findByRole('combobox', { name: 'Language' })
    fireEvent.change(select, { target: { value: 'fr' } })
    await vi.waitFor(() =>
      expect(saved).toEqual({ deckId: 'deck1', language: 'fr' }),
    )

    // Settings pauses the microphone, so recognition picks the new
    // language up when it resumes on close, not while the panel is up
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))
    await vi.waitFor(() => {
      expect(FakeRecognition.last).not.toBe(first)
      expect(FakeRecognition.last!.lang).toBe('fr')
    })
  })

  it('pauses the microphone while lecture settings are open', async () => {
    FakeRecognition.reset()
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: { ...deckView, canEdit: true },
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

    const toggle = screen.getByRole('button', { name: 'Live session' })
    fireEvent.click(toggle)
    expect(toggle.className).toContain('bg-red-600')

    // Settings is an aside: talking through it must not reach generation
    fireEvent.click(screen.getByRole('button', { name: 'Lecture settings' }))
    expect(toggle.className).not.toContain('bg-red-600')

    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))
    expect(toggle.className).toContain('bg-red-600')
  })

  it('resumes the microphone when settings close on Escape', async () => {
    FakeRecognition.reset()
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: { ...deckView, canEdit: true },
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

    const toggle = screen.getByRole('button', { name: 'Live session' })
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: 'Lecture settings' }))
    expect(toggle.className).not.toContain('bg-red-600')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(toggle.className).toContain('bg-red-600')
  })

  it('leaves the microphone off when settings close if it was never on', async () => {
    FakeRecognition.reset()
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: { ...deckView, canEdit: true },
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

    // Never started recording: closing settings must not start it
    fireEvent.click(screen.getByRole('button', { name: 'Lecture settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))

    const toggle = screen.getByRole('button', { name: 'Live session' })
    expect(toggle.className).not.toContain('bg-red-600')
    expect(FakeRecognition.last).toBeNull()
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

  it('opens the Quiz tab when returning from OAuth with ?settings=quiz', async () => {
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
        body: [deckView.template],
      }),
      '/api/actions/quiz.status': () => ({
        status: 200,
        body: { googleConnected: true, hasTranscript: false },
      }),
    })
    // Simulate the OAuth return URL carrying the one-shot tab param.
    window.history.replaceState({}, '', '/d/shared-abc123?settings=quiz')
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
      await screen.findByRole('dialog', { name: 'Lecture settings' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Quiz' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    // The one-shot param is stripped so a refresh won't reopen it.
    expect(window.location.search).toBe('')
  })

  it('changes a slide layout from the kebab via the picker modal', async () => {
    let sent: unknown
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: {
          ...deckView,
          canEdit: true,
          template: {
            ...deckView.template,
            layouts: [
              {
                type: 'title',
                label: 'Title',
                purpose: 'Opening slide',
                slots: [],
                elementPositions: {},
              },
              {
                type: 'quote',
                label: 'Quote',
                purpose: 'A striking statement',
                slots: [],
                elementPositions: {},
              },
            ],
          },
        },
      }),
      '/api/actions/slide.setLayout': init => {
        sent = JSON.parse(String(init?.body))
        return {
          status: 200,
          body: { ...deckView.slides[0], layoutType: 'quote' },
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

    fireEvent.click(screen.getByRole('button', { name: 'Options for slide 1' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Change layout' }))

    // The picker highlights the slide's current layout and names the
    // template these layouts come from
    const dialog = await screen.findByRole('dialog', {
      name: 'Change slide layout',
    })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('Classic')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /title/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    fireEvent.click(screen.getByRole('radio', { name: /quote/i }))
    await vi.waitFor(() =>
      expect(sent).toEqual({ slideId: 's1', layoutType: 'quote' }),
    )
    // The slide re-renders in its new layout; the modal is gone
    expect(await screen.findByTestId('slide')).toHaveAttribute(
      'data-layout',
      'quote',
    )
    expect(
      screen.queryByRole('dialog', { name: 'Change slide layout' }),
    ).not.toBeInTheDocument()
  })

  it('polls for a sourced image after switching onto an image layout', async () => {
    let sent: unknown
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: {
          ...deckView,
          canEdit: true,
          // s1 starts on a text layout with no image
          slides: [
            {
              ...deckView.slides[0],
              layoutType: 'content',
              title: 'Mitochondria',
            },
          ],
          template: {
            ...deckView.template,
            layouts: [
              {
                type: 'content',
                label: 'Content',
                purpose: 'Title and text',
                slots: [],
                elementPositions: {},
              },
              {
                type: 'image-heavy',
                label: 'Image heavy',
                purpose: 'A striking image dominates',
                slots: [{ name: 'image', kind: 'image' }],
                elementPositions: {},
              },
            ],
          },
        },
      }),
      // The server derived keywords and moved the slide onto image-heavy,
      // but the image itself arrives later via enrichment
      '/api/actions/slide.setLayout': init => {
        sent = JSON.parse(String(init?.body))
        return {
          status: 200,
          body: {
            ...deckView.slides[0],
            layoutType: 'image-heavy',
            title: 'Mitochondria',
            imageKeywords: ['mitochondria'],
          },
        }
      },
      // The background poll picks the image up on its first read
      '/api/actions/slide.get': () => ({
        status: 200,
        body: {
          ...deckView.slides[0],
          layoutType: 'image-heavy',
          title: 'Mitochondria',
          imageKeywords: ['mitochondria'],
          imageRef: 'http://img/mito.png',
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

    fireEvent.click(screen.getByRole('button', { name: 'Options for slide 1' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Change layout' }))
    await screen.findByRole('dialog', { name: 'Change slide layout' })
    fireEvent.click(screen.getByRole('radio', { name: /image heavy/i }))

    await vi.waitFor(() =>
      expect(sent).toEqual({ slideId: 's1', layoutType: 'image-heavy' }),
    )
    // The empty image slot shows a pending skeleton — proof the client
    // started polling for the enrichment result
    expect(await screen.findByTestId('image-skeleton')).toBeInTheDocument()
  })

  it('flashes the blank-slot reveal for half a second on a page-background click', async () => {
    vi.useFakeTimers()
    withSettingsRoutes()
    const { container } = renderWithSettings()
    await vi.waitFor(() =>
      expect(screen.getByText('Shared Lecture')).toBeInTheDocument(),
    )

    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper).not.toHaveAttribute('data-reveal-blanks')

    // A background click reveals blank slots…
    fireEvent.click(wrapper)
    expect(wrapper).toHaveAttribute('data-reveal-blanks', 'true')

    // …and they hide again on their own after 500ms
    act(() => vi.advanceTimersByTime(500))
    expect(wrapper).not.toHaveAttribute('data-reveal-blanks')

    // Clicks on controls (buttons, links, the slide itself) never reveal
    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    expect(wrapper).not.toHaveAttribute('data-reveal-blanks')
    vi.useRealTimers()
  })

  it('jumps from the layout picker to the Design settings tab', async () => {
    withSettingsRoutes()
    renderWithSettings()
    await screen.findByText('Shared Lecture')

    fireEvent.click(screen.getByRole('button', { name: 'Options for slide 1' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Change layout' }))
    await screen.findByRole('dialog', { name: 'Change slide layout' })

    fireEvent.click(screen.getByRole('button', { name: 'Change template' }))

    // The picker closes and settings open straight on the template tab
    expect(
      await screen.findByRole('dialog', { name: 'Lecture settings' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('dialog', { name: 'Change slide layout' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Design' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(
      await screen.findByRole('radio', { name: /midnight/i }),
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
    fireEvent.click(await screen.findByRole('tab', { name: 'Design' }))

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
  it('teleports the deck title into the shell header alongside the brand', async () => {
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
        body: {
          status: 'ok',
          environment: 'test',
          version: '0',
          uptime: 1,
          components: {
            mongo: { status: 'ok', detail: 'connected' },
            storage: { status: 'ok', detail: 'local disk' },
            gemini: { status: 'disabled', detail: 'not configured' },
            stt: { status: 'disabled', detail: 'browser (client-side)' },
          },
        },
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
    // The brand wordmark stays visible as the always-clickable home link,
    // now sitting alongside the teleported title rather than being replaced
    // by it — an empty link would not be reachable to navigate home.
    const brand = screen.getByRole('link', {
      name: /the slide machine — home/i,
    })
    expect(brand).toBeInTheDocument()
    expect(brand).toHaveTextContent('The Slide Machine')
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

  // Once the live session is on, the icon hint is stale advice — the mic is
  // already open, so the empty deck asks for speech instead.
  it('asks an empty deck for speech while the live session is on', async () => {
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
    const toggle = await screen.findByRole('button', { name: 'Live session' })

    fireEvent.click(toggle)
    expect(
      screen.getByText('Start speaking to generate slides'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/icons to start adding content/)).toBeNull()

    // Switching the mic back off with nothing generated restores the hint.
    fireEvent.click(toggle)
    expect(
      screen.getByText(/icons to start adding content/),
    ).toBeInTheDocument()
    expect(screen.queryByText('Start speaking to generate slides')).toBeNull()
  })

  it('disables the deck play button while the deck has no slides', async () => {
    vi.spyOn(runtimeConfig, 'getTtsEnabled').mockReturnValue(true)
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
    const play = await screen.findByRole('button', { name: 'Play deck' })
    expect(play).toBeDisabled()
  })

  it('enables the deck play button once the deck has slides', async () => {
    vi.spyOn(runtimeConfig, 'getTtsEnabled').mockReturnValue(true)
    renderViewer(200)
    const play = await screen.findByRole('button', { name: 'Play deck' })
    expect(play).toBeEnabled()
  })

  // Arrow keys move the deck AND the narration: the spoken transcript follows
  // the user to the slide they navigated to.
  it('skips deck narration to the slide the arrow keys move to', async () => {
    vi.spyOn(runtimeConfig, 'getTtsEnabled').mockReturnValue(true)
    // jsdom has no media playback; a stub element keeps the clip "playing".
    class FakeAudio {
      src = ''
      onended: (() => void) | null = null
      play = vi.fn(async () => {})
      pause = vi.fn()
      removeAttribute = vi.fn()
    }
    vi.stubGlobal('Audio', FakeAudio)
    const { calls } = mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({ status: 200, body: deckView }),
      '/tts': () => ({ status: 200, body: { url: 'clip', marks: [] } }),
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

    fireEvent.click(await screen.findByRole('button', { name: 'Play deck' }))
    await waitFor(() =>
      expect(calls.some(u => u.includes('/api/slides/s1/tts'))).toBe(true),
    )

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() =>
      expect(calls.some(u => u.includes('/api/slides/s2/tts'))).toBe(true),
    )

    // ...and back: arrowing left re-speaks the previous slide.
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    await waitFor(() =>
      expect(calls.filter(u => u.includes('/api/slides/s1/tts'))).toHaveLength(
        2,
      ),
    )
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

describe('DeckViewerPage image editing', () => {
  const imageDeck = (layoutType: string) => ({
    ...deckView,
    deck: { ...deckView.deck, slideOrder: ['s1'] },
    // Layouts carry their slots so image-only vs image+text is derived from
    // the template (not hardcoded names): title = title+caption (ancillary
    // only), content = title+body (text-only), two-column = title+body+image,
    // image-heavy = image+caption (image-only, since a caption is ancillary).
    // The title layout comes first to prove removal preserves the two-column's
    // body by choosing content, not the earlier title layout.
    template: {
      ...deckView.template,
      layouts: [
        {
          type: 'title',
          label: 'Title',
          purpose: '',
          slots: [
            { name: 'title', kind: 'text', label: 'Title' },
            { name: 'caption', kind: 'text', label: 'Caption' },
          ],
          elementPositions: {},
        },
        {
          type: 'content',
          label: 'Content',
          purpose: '',
          slots: [
            { name: 'title', kind: 'text', label: 'Title' },
            { name: 'body', kind: 'text', label: 'Body' },
          ],
          elementPositions: {},
        },
        {
          type: 'two-column',
          label: 'Two column',
          purpose: '',
          slots: [
            { name: 'title', kind: 'text', label: 'Title' },
            { name: 'body', kind: 'text', label: 'Body' },
            { name: 'image', kind: 'image', label: 'Image' },
          ],
          elementPositions: {},
        },
        {
          type: 'image-heavy',
          label: 'Image heavy',
          purpose: '',
          // Image + caption, like the real template: a caption is ancillary,
          // so this still counts as image-only (removing the image leaves
          // nothing worth keeping).
          slots: [
            { name: 'image', kind: 'image', label: 'Image' },
            { name: 'caption', kind: 'text', label: 'Caption' },
          ],
          elementPositions: {},
        },
      ],
    },
    slides: [
      {
        id: 's1',
        deckId: 'deck1',
        index: 0,
        layoutType,
        title: 'Cell',
        body: 'A cell',
        imageRef: 'http://img/cell.png',
      },
    ],
    canEdit: true,
  })

  it('removing the image from an image-only slide just empties the slot, no delete', async () => {
    const calls: unknown[] = []
    let deleted = false
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: imageDeck('image-heavy'),
      }),
      '/api/actions/slide.editContent': init => {
        calls.push(JSON.parse(String(init?.body)))
        return {
          status: 200,
          body: {
            id: 's1',
            deckId: 'deck1',
            index: 0,
            layoutType: 'image-heavy',
          },
        }
      },
      '/api/actions/slide.delete': () => {
        deleted = true
        return { status: 200, body: {} }
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
    fireEvent.click(await screen.findByRole('button', { name: 'Remove image' }))
    // No confirm dialog — the image is simply cleared and the slide stays.
    expect(
      screen.queryByRole('alertdialog', { name: 'Delete this slide?' }),
    ).not.toBeInTheDocument()
    await vi.waitFor(() =>
      expect(calls).toEqual([{ slideId: 's1', imageRef: '' }]),
    )
    expect(deleted).toBe(false)
  })

  it('removing the image from an image+text slide clears it and keeps the layout', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: imageDeck('two-column'),
      }),
      '/api/actions/slide.editContent': init => {
        calls.push({ url: 'editContent', body: JSON.parse(String(init?.body)) })
        return {
          status: 200,
          body: {
            id: 's1',
            deckId: 'deck1',
            index: 0,
            layoutType: 'two-column',
          },
        }
      },
      // Registered but must NOT be called — the layout stays put.
      '/api/actions/slide.setLayout': init => {
        calls.push({ url: 'setLayout', body: JSON.parse(String(init?.body)) })
        return {
          status: 200,
          body: { id: 's1', deckId: 'deck1', index: 0, layoutType: 'content' },
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
    fireEvent.click(await screen.findByRole('button', { name: 'Remove image' }))
    // No confirm dialog — it is non-destructive.
    expect(
      screen.queryByRole('alertdialog', { name: 'Delete this slide?' }),
    ).not.toBeInTheDocument()

    // Only the image is cleared; the layout is NOT switched.
    await vi.waitFor(() =>
      expect(calls).toEqual([
        { url: 'editContent', body: { slideId: 's1', imageRef: '' } },
      ]),
    )
    expect(calls.some(c => c.url === 'setLayout')).toBe(false)
  })

  it('surfaces an error when an image upload fails instead of failing silently', async () => {
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: imageDeck('two-column'),
      }),
      '/api/slides/s1/image-candidates': () => ({ status: 200, body: [] }),
      '/api/slides/s1/image': () => ({ status: 500 }),
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
    await screen.findByRole('button', { name: 'Remove image' })

    // Replace opens the image dialog; uploading there hits the failing route
    fireEvent.click(screen.getByRole('button', { name: 'Replace image' }))
    const file = new File(['x'], 'new.png', { type: 'image/png' })
    fireEvent.change(await screen.findByLabelText('Upload image file'), {
      target: { files: [file] },
    })
    expect(await screen.findByText(/could not upload the image/i)).toBeVisible()
  })
})

describe('DeckViewerPage pre-lecture seeding', () => {
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

  /** Renders the viewer as if entered via "Start a new lecture". */
  const renderSpeaking = () => {
    FakeRecognition.reset()
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: { ...deckView, canEdit: true },
      }),
      '/api/actions/seedAsset.list': () => ({ status: 200, body: [] }),
    })
    return render(
      <MemoryRouter
        initialEntries={[
          { pathname: '/d/shared-abc123', state: { startSpeaking: true } },
        ]}
      >
        <AuthProvider>
          <Routes>
            <Route path="/d/:slug" element={<DeckViewerPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )
  }

  it('opens the seed dialog and holds off recording until it is dismissed', async () => {
    renderSpeaking()
    await screen.findByText('Shared Lecture')

    expect(
      await screen.findByRole('dialog', { name: 'Add seed material' }),
    ).toBeInTheDocument()
    // Recording has NOT begun — the mic is untouched and the toggle is idle
    expect(FakeRecognition.last).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Live session' }),
    ).toHaveAttribute('aria-pressed', 'false')
  })

  it('begins recording when the pre-lecture dialog is dismissed', async () => {
    renderSpeaking()
    await screen.findByRole('dialog', { name: 'Add seed material' })

    fireEvent.click(screen.getByRole('button', { name: 'Start lecture' }))

    // The dialog closes and the microphone starts
    expect(
      screen.queryByRole('dialog', { name: 'Add seed material' }),
    ).not.toBeInTheDocument()
    expect(FakeRecognition.last).not.toBeNull()
    expect(
      screen.getByRole('button', { name: 'Live session' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  // The mid-lecture toolbar seed button is hidden for now
  // (SHOW_SEED_UPLOAD_IN_TOOLBAR), so there is no UI entry point to reopen
  // seeding during a lecture; seeding happens from the pre-lecture dialog
  // and Lecture settings. The wiring is retained for when it returns.
})

describe('DeckViewerPage admin settings (ADMIN-5)', () => {
  // An allowlisted admin opening someone else's lecture: read-only over
  // the slides (canEdit false), but its settings are theirs to change.
  const adminRoutes = () =>
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'admin1', displayName: 'Root' }, accessToken: 't' },
      }),
      '/api/admin/status': () => ({ status: 200, body: { isAdmin: true } }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: { ...deckView, canEdit: false },
      }),
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
      '/api/actions/deck.shares': () => ({ status: 200, body: [] }),
    })

  const renderAdminViewer = () =>
    render(
      <MemoryRouter initialEntries={['/d/shared-abc123']}>
        <AuthProvider>
          <Routes>
            <Route path="/d/:slug" element={<DeckViewerPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )

  afterEach(() => {
    resetAdminStatus()
  })

  it('offers the settings icon and asks before opening them', async () => {
    adminRoutes()
    renderAdminViewer()

    const gear = await screen.findByRole('button', { name: 'Lecture settings' })
    // Content editing stays out of reach: no way to add or speak slides
    expect(
      screen.queryByRole('button', { name: 'Add slide' }),
    ).not.toBeInTheDocument()

    fireEvent.click(gear)
    const ask = await screen.findByRole('alertdialog', {
      name: "Edit this lecture's settings?",
    })
    expect(ask).toHaveTextContent(/recorded in the audit log/i)
    expect(
      screen.queryByRole('dialog', { name: 'Lecture settings' }),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit settings' }))
    const settings = await screen.findByRole('dialog', {
      name: 'Lecture settings',
    })
    expect(settings).toHaveTextContent(
      /editing another user's lecture as an admin/i,
    )
  })

  it('drops the tabs and sections that are not settings edits', async () => {
    adminRoutes()
    renderAdminViewer()

    fireEvent.click(
      await screen.findByRole('button', { name: 'Lecture settings' }),
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Edit settings' }),
    )
    await screen.findByRole('dialog', { name: 'Lecture settings' })

    // Quiz and Export act through the admin's own Google account
    expect(screen.queryByRole('tab', { name: 'Quiz' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('tab', { name: 'Export' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Privacy & Sharing' })).toBeVisible()
    // Uploading into someone else's lecture is not a settings edit
    expect(screen.queryByText('Seed material')).not.toBeInTheDocument()

    // The Refine settings are editable; running the pass is the owner's
    fireEvent.click(screen.getByRole('tab', { name: 'Refine with AI' }))
    expect(
      await screen.findByRole('checkbox', { name: /Refine slide text/ }),
    ).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: 'Refine' }),
    ).not.toBeInTheDocument()
  })

  it('leaves the lecture alone for a signed-in non-admin viewer', async () => {
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u2', displayName: 'Bob' }, accessToken: 't' },
      }),
      '/api/admin/status': () => ({ status: 403 }),
      '/api/decks/shared-abc123': () => ({
        status: 200,
        body: { ...deckView, canEdit: false },
      }),
    })
    renderAdminViewer()

    await screen.findByText('Shared Lecture')
    expect(
      screen.queryByRole('button', { name: 'Lecture settings' }),
    ).not.toBeInTheDocument()
  })
})
