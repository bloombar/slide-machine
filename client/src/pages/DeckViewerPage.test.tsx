/**
 * Unit tests for the deck viewer: the Resume affordance appears for the
 * deck's owner only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { AuthProvider } from '../auth/AuthContext'
import { setAccessToken } from '../auth/token'
import DeckViewerPage from './DeckViewerPage'
import { mockFetchRoutes } from '../test/fetch-mock'

const deckView = {
  deck: {
    id: 'deck1',
    ownerId: 'u1',
    title: 'Shared Lecture',
    permalinkSlug: 'shared-abc123',
    slideOrder: ['s1'],
    visibility: 'public',
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
      body: { ...deckView, deck: { ...deckView.deck, ownerId } },
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
  it('shows the resume icon to the deck owner', async () => {
    renderViewer(200)
    expect(
      await screen.findByRole('link', { name: /resume lecture/i }),
    ).toHaveAttribute('href', '/app/session/deck1')
  })

  it('hides Resume lecture from anonymous viewers', async () => {
    renderViewer(401)
    expect(await screen.findByText('Shared Lecture')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /resume lecture/i }),
    ).not.toBeInTheDocument()
  })

  it('hides Resume lecture from signed-in non-owners', async () => {
    renderViewer(200, 'someone-else')
    expect(await screen.findByText('Shared Lecture')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /resume lecture/i }),
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
          ? { status: 200, body: deckView }
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
