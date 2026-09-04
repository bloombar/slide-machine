/**
 * Unit tests for the lecture-opening beacon (EVAL-7).
 *
 * The beacon is fire-and-forget, so nothing on the page changes when it works
 * and nothing changes when it does not. Without these, deleting the call
 * outright leaves the whole client suite green, and line coverage does not
 * help: the shared fetch mock matches routes by substring, so the POST is
 * absorbed by the neighbouring deck route and the line reports as covered
 * wherever the viewer renders.
 *
 * These assert the two properties the count depends on — one row per opening,
 * and never a row for a lecture the page has not actually loaded.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StrictMode } from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { AuthProvider } from '../auth/AuthContext'
import { setAccessToken } from '../auth/token'
import DeckViewerPage from './DeckViewerPage'
import { mockFetchRoutes } from '../test/fetch-mock'
import * as runtimeConfig from '../runtime-config'

// Same substitution the sibling page tests use: GSAP does not animate in
// jsdom, and the flip is covered by its own unit tests.
vi.mock('../lib/layoutFlip', () => ({
  runLayoutFlip: (_slideId: string, update: () => void) => {
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

/**
 * Renders the viewer under StrictMode, which is how the app itself mounts it
 * (main.tsx) and which double-invokes every effect. `slugInAddress` and the
 * slug the payload carries are separate so a mismatch can be staged.
 */
const renderViewer = (
  slugInAddress = 'shared-abc123',
  payloadSlug = 'shared-abc123',
) => {
  const { calls } = mockFetchRoutes({
    // Registered before the deck route: the mock matches by substring, and
    // `/api/decks/<slug>` is a prefix of `/api/decks/<slug>/view`.
    '/view': () => ({ status: 204 }),
    '/api/actions/session.phrase': () => ({
      status: 200,
      body: { kind: 'none', deckTitle: 'Photosynthesis Basics' },
    }),
    '/api/auth/refresh': () => ({
      status: 200,
      body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
    }),
    '/api/decks/': () => ({
      status: 200,
      body: {
        ...deckView,
        deck: { ...deckView.deck, permalinkSlug: payloadSlug, title: '' },
        canEdit: true,
      },
    }),
  })
  render(
    <StrictMode>
      <MemoryRouter initialEntries={[`/d/${slugInAddress}`]}>
        <AuthProvider>
          <Routes>
            <Route path="/d/:slug" element={<DeckViewerPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </StrictMode>,
  )
  return { beacons: () => calls.filter(url => url.endsWith('/view')) }
}

/** Says one phrase into the live session, which lands a generation event and
 * replaces `view` with a fresh object — a re-read, not a second opening. */
const speak = (phrase: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: 'Spoken phrase' }), {
    target: { value: phrase },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Speak' }))
}

beforeEach(() => {
  setAccessToken(null)
  vi.spyOn(runtimeConfig, 'getSimulatedSpeechEnabled').mockReturnValue(true)
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('lecture-opening beacon', () => {
  it('records the opening once, however often the deck is re-read', async () => {
    const { beacons } = renderViewer()
    await screen.findByText('Untitled lecture')
    await waitFor(() => expect(beacons()).toHaveLength(1))
    expect(beacons()[0]).toContain('/api/decks/shared-abc123/view')

    // Two generation events, each of which calls `setView` with a new object.
    // The effect re-runs on both; only the latch stops them being counted as
    // further openings. Without it this is three beacons, not one.
    fireEvent.click(screen.getByRole('button', { name: 'Live session' }))
    speak('photosynthesis converts light')
    await screen.findByText('Photosynthesis Basics')
    speak('and it happens in the chloroplast')

    await waitFor(() => expect(beacons()).toHaveLength(1))
    expect(beacons()).toHaveLength(1)
  })

  it('records nothing while the loaded lecture is not the one in the address', async () => {
    // The page holds a previously loaded deck when the address changes without
    // a remount. Counting then would credit an opening to a lecture the reader
    // may still be refused.
    const { beacons } = renderViewer('shared-abc123', 'some-other-deck')
    await screen.findByText('Hello')
    await waitFor(() => expect(beacons()).toHaveLength(0))
    expect(beacons()).toHaveLength(0)
  })
})
