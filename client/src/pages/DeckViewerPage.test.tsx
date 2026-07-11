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
import PublicShell from '../components/layout/PublicShell'
import { ShellTitleProvider } from '../components/layout/ShellTitle'
import { mockFetchRoutes } from '../test/fetch-mock'

const deckView = {
  deck: {
    id: 'deck1',
    ownerId: 'u1',
    title: 'Shared Lecture',
    permalinkSlug: 'shared-abc123',
    slideOrder: ['s1'],
    visibility: 'public',
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
    })

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

  it('opens from the gear, switches templates, and closes from the icon', async () => {
    withSettingsRoutes()
    renderWithSettings()
    await screen.findByText('Shared Lecture')

    fireEvent.click(screen.getByRole('button', { name: 'Lecture settings' }))
    expect(
      await screen.findByRole('dialog', { name: 'Lecture settings' }),
    ).toBeInTheDocument()

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
