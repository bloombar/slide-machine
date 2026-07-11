/**
 * Unit tests for the Google-Docs-style access settings: general-access
 * radios save immediately; people are added by email with a per-person
 * role that can be changed or revoked in place.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { Deck } from '@slide-machine/shared'
import DeckAccessSettings from './DeckAccessSettings'
import { mockFetchRoutes } from '../test/fetch-mock'

const deck = (overrides: Partial<Deck> = {}): Deck => ({
  id: 'deck1',
  projectId: 'p1',
  ownerId: 'u1',
  title: 'Waves',
  templateId: 'classic',
  visibility: 'public',
  permalinkSlug: 'waves-abc123',
  slideOrder: [],
  voteScore: 0,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
})

const share = {
  userId: 'u2',
  displayName: 'byron',
  email: 'byron@example.com',
  role: 'viewer' as const,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DeckAccessSettings', () => {
  it('saves a general-access change through deck.setAccess', async () => {
    let sent: unknown
    const onAccessChange = vi.fn()
    mockFetchRoutes({
      '/api/actions/deck.shares': () => ({ status: 200, body: [] }),
      '/api/actions/deck.setAccess': init => {
        sent = JSON.parse(String(init?.body))
        return { status: 200, body: deck({ visibility: 'restricted' }) }
      },
    })
    render(
      <DeckAccessSettings
        deck={deck()}
        isOwner
        onAccessChange={onAccessChange}
      />,
    )

    fireEvent.click(screen.getByRole('radio', { name: /restricted/i }))

    await vi.waitFor(() =>
      expect(sent).toEqual({ deckId: 'deck1', visibility: 'restricted' }),
    )
    await vi.waitFor(() => expect(onAccessChange).toHaveBeenCalled())
  })

  it('adds a person by email with the chosen role', async () => {
    let sent: unknown
    mockFetchRoutes({
      '/api/actions/deck.shares': () => ({ status: 200, body: [] }),
      '/api/actions/deck.share': init => {
        sent = JSON.parse(String(init?.body))
        return { status: 200, body: [{ ...share, role: 'editor' }] }
      },
    })
    render(
      <DeckAccessSettings deck={deck()} isOwner onAccessChange={vi.fn()} />,
    )

    fireEvent.change(screen.getByLabelText('Add people by email'), {
      target: { value: 'byron@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Access role'), {
      target: { value: 'editor' },
    })
    fireEvent.submit(screen.getByRole('form', { name: 'Add people' }))

    expect(await screen.findByText('byron')).toBeInTheDocument()
    expect(screen.getByLabelText('Role for byron')).toHaveValue('editor')
    expect(sent).toEqual({
      deckId: 'deck1',
      email: 'byron@example.com',
      role: 'editor',
    })
  })

  it('shows an error when the email has no account', async () => {
    mockFetchRoutes({
      '/api/actions/deck.shares': () => ({ status: 200, body: [] }),
      '/api/actions/deck.share': () => ({ status: 400 }),
    })
    render(
      <DeckAccessSettings deck={deck()} isOwner onAccessChange={vi.fn()} />,
    )
    fireEvent.change(screen.getByLabelText('Add people by email'), {
      target: { value: 'nobody@example.com' },
    })
    fireEvent.submit(screen.getByRole('form', { name: 'Add people' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No account with that email',
    )
  })

  it("changes a listed person's role in place", async () => {
    let sent: unknown
    mockFetchRoutes({
      '/api/actions/deck.shares': () => ({ status: 200, body: [share] }),
      '/api/actions/deck.share': init => {
        sent = JSON.parse(String(init?.body))
        return { status: 200, body: [{ ...share, role: 'editor' }] }
      },
    })
    render(
      <DeckAccessSettings deck={deck()} isOwner onAccessChange={vi.fn()} />,
    )

    fireEvent.change(await screen.findByLabelText('Role for byron'), {
      target: { value: 'editor' },
    })

    await vi.waitFor(() =>
      expect(sent).toEqual({
        deckId: 'deck1',
        email: 'byron@example.com',
        role: 'editor',
      }),
    )
  })

  it('revokes access from the Remove access menu option', async () => {
    let sent: unknown
    mockFetchRoutes({
      '/api/actions/deck.shares': () => ({ status: 200, body: [share] }),
      '/api/actions/deck.unshare': init => {
        sent = JSON.parse(String(init?.body))
        return { status: 200, body: [] }
      },
    })
    render(
      <DeckAccessSettings deck={deck()} isOwner onAccessChange={vi.fn()} />,
    )
    fireEvent.change(await screen.findByLabelText('Role for byron'), {
      target: { value: 'remove' },
    })
    await vi.waitFor(() =>
      expect(sent).toEqual({ deckId: 'deck1', userId: 'u2', role: 'viewer' }),
    )
    expect(
      await screen.findByText('Only you have access so far.'),
    ).toBeInTheDocument()
  })

  it('offers Transfer ownership to the owner only', async () => {
    mockFetchRoutes({
      '/api/actions/deck.shares': () => ({ status: 200, body: [share] }),
    })
    const { unmount } = render(
      <DeckAccessSettings deck={deck()} isOwner onAccessChange={vi.fn()} />,
    )
    const menu = await screen.findByLabelText('Role for byron')
    expect(within(menu).getByText('Transfer ownership')).toBeInTheDocument()
    unmount()

    mockFetchRoutes({
      '/api/actions/deck.shares': () => ({ status: 200, body: [share] }),
    })
    render(
      <DeckAccessSettings
        deck={deck()}
        isOwner={false}
        onAccessChange={vi.fn()}
      />,
    )
    const editorMenu = await screen.findByLabelText('Role for byron')
    expect(
      within(editorMenu).queryByText('Transfer ownership'),
    ).not.toBeInTheDocument()
    expect(within(editorMenu).getByText('Remove access')).toBeInTheDocument()
  })

  it('transfers ownership after confirmation and refreshes the deck', async () => {
    let sent: unknown
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    mockFetchRoutes({
      '/api/actions/deck.shares': () => ({ status: 200, body: [share] }),
      '/api/actions/deck.transferOwnership': init => {
        sent = JSON.parse(String(init?.body))
        return { status: 200, body: deck({ ownerId: 'u2' }) }
      },
    })
    render(
      <DeckAccessSettings deck={deck()} isOwner onAccessChange={vi.fn()} />,
    )

    fireEvent.change(await screen.findByLabelText('Role for byron'), {
      target: { value: 'transfer' },
    })

    await vi.waitFor(() =>
      expect(sent).toEqual({ deckId: 'deck1', userId: 'u2' }),
    )
  })

  it('does nothing when the transfer confirmation is declined', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(false))
    const { fetchMock } = mockFetchRoutes({
      '/api/actions/deck.shares': () => ({ status: 200, body: [share] }),
    })
    render(
      <DeckAccessSettings deck={deck()} isOwner onAccessChange={vi.fn()} />,
    )

    fireEvent.change(await screen.findByLabelText('Role for byron'), {
      target: { value: 'transfer' },
    })

    const urls = fetchMock.mock.calls.map(c => String(c[0]))
    expect(urls.some(u => u.includes('transferOwnership'))).toBe(false)
  })
})
