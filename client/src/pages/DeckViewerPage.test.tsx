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

describe('DeckViewerPage slide deletion', () => {
  it('lets the owner delete a slide from the superimposed icon', async () => {
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({ status: 200, body: deckView }),
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
      '/api/decks/shared-abc123': () => ({ status: 200, body: deckView }),
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
      '/api/decks/shared-abc123': () => ({ status: 200, body: deckView }),
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

describe('DeckViewerPage slide reordering', () => {
  it('shows drag handles to owners in list view and reorders via Alt+arrows', async () => {
    let reorderBody: unknown
    mockFetchRoutes({
      '/api/auth/refresh': () => ({
        status: 200,
        body: { user: { id: 'u1', displayName: 'Ada' }, accessToken: 't' },
      }),
      '/api/decks/shared-abc123': () => ({ status: 200, body: deckView }),
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
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder slide 1' }), {
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

  it('hides drag handles from non-owners', async () => {
    renderViewer(401)
    await screen.findByText('Shared Lecture')
    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    expect(
      screen.queryByRole('button', { name: /reorder slide/i }),
    ).not.toBeInTheDocument()
  })
})
