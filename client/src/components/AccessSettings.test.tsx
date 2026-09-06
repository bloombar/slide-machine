/**
 * Unit tests for the shared access settings: one component drives both
 * deck.* and project.* action families; lectures surface inheritance
 * with a reset back to project settings; ownership transfer confirms
 * in a dialog.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import AccessSettings, { type AccessSubject } from './AccessSettings'
import { mockFetchRoutes } from '../test/fetch-mock'

// The component reads the signed-in account to offer a confirmation link
// when the server says the address is unconfirmed (SHARE-3). Mocked rather
// than wrapped in a provider: these tests are about the access surface, not
// about session loading.
const currentUser = {
  id: 'u1',
  email: 'ada@example.com',
  displayName: 'Ada',
  emailVerified: false,
}
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: currentUser }),
}))

// The confirmation link is only offered where the server can send mail.
vi.mock('../runtime-config', () => ({ getMailEnabled: () => true }))

const share = {
  userId: 'u2',
  displayName: 'byron',
  email: 'byron@example.com',
  role: 'viewer' as const,
}

/** A share offered to an address with no account yet (SHARE-3). */
const invite = {
  userId: '',
  displayName: '',
  email: 'mary@example.com',
  role: 'viewer' as const,
  pending: true,
}

const subject = (overrides: Partial<AccessSubject> = {}): AccessSubject => ({
  id: 'x1',
  name: 'Waves',
  visibility: 'public',
  ...overrides,
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AccessSettings', () => {
  it('drives the deck action family for lectures', async () => {
    let sent: unknown
    mockFetchRoutes({
      '/api/actions/deck.shares': () => ({ status: 200, body: [] }),
      '/api/actions/deck.setAccess': init => {
        sent = JSON.parse(String(init?.body))
        return { status: 200, body: {} }
      },
    })
    render(
      <AccessSettings
        entity="deck"
        subject={subject({ accessInherited: true })}
        isOwner
        onChange={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('radio', { name: /restricted/i }))
    await vi.waitFor(() =>
      expect(sent).toEqual({ deckId: 'x1', visibility: 'restricted' }),
    )
  })

  it('drives the project action family for projects', async () => {
    let sent: unknown
    mockFetchRoutes({
      '/api/actions/project.shares': () => ({ status: 200, body: [share] }),
      '/api/actions/project.share': init => {
        sent = JSON.parse(String(init?.body))
        return { status: 200, body: [{ ...share, role: 'editor' }] }
      },
    })
    render(
      <AccessSettings
        entity="project"
        subject={subject()}
        isOwner
        onChange={vi.fn()}
      />,
    )
    fireEvent.change(await screen.findByLabelText('Role for byron'), {
      target: { value: 'editor' },
    })
    await vi.waitFor(() =>
      expect(sent).toEqual({
        projectId: 'x1',
        email: 'byron@example.com',
        role: 'editor',
      }),
    )
    // Projects never show the inheritance banner
    expect(screen.queryByText(/inherited from the project/i)).toBeNull()
  })

  it('shows inheritance state and resets to project settings', async () => {
    let resetSent: unknown
    const onChange = vi.fn()
    mockFetchRoutes({
      '/api/actions/deck.shares': () => ({ status: 200, body: [] }),
      '/api/actions/deck.resetAccess': init => {
        resetSent = JSON.parse(String(init?.body))
        return { status: 200, body: { accessInherited: true } }
      },
    })
    const { rerender } = render(
      <AccessSettings
        entity="deck"
        subject={subject({ accessInherited: true })}
        isOwner
        onChange={onChange}
      />,
    )
    expect(screen.getByText(/inherited from the project/i)).toBeInTheDocument()

    rerender(
      <AccessSettings
        entity="deck"
        subject={subject({ accessInherited: false })}
        isOwner
        onChange={onChange}
      />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Use project settings' }),
    )
    await vi.waitFor(() => expect(resetSent).toEqual({ deckId: 'x1' }))
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled())
  })

  it('confirms ownership transfer in a dialog', async () => {
    let sent: unknown
    mockFetchRoutes({
      '/api/actions/deck.shares': () => ({ status: 200, body: [share] }),
      '/api/actions/deck.transferOwnership': init => {
        sent = JSON.parse(String(init?.body))
        return { status: 200, body: {} }
      },
    })
    render(
      <AccessSettings
        entity="deck"
        subject={subject()}
        isOwner
        onChange={vi.fn()}
      />,
    )
    fireEvent.change(await screen.findByLabelText('Role for byron'), {
      target: { value: 'transfer' },
    })
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Transfer ownership?',
    })
    expect(dialog).toBeInTheDocument()

    // Cancel first: no dispatch
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(sent).toBeUndefined()

    fireEvent.change(screen.getByLabelText('Role for byron'), {
      target: { value: 'transfer' },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Transfer' }))
    await vi.waitFor(() => expect(sent).toEqual({ deckId: 'x1', userId: 'u2' }))
  })

  // A pending invitation has no account behind it, so there is no name to
  // show, nobody to hand ownership to, and no user id to revoke by.
  it('marks a pending invitation and withdraws it by address', async () => {
    let sent: unknown
    mockFetchRoutes({
      '/api/actions/deck.shares': () => ({ status: 200, body: [invite] }),
      '/api/actions/deck.unshare': init => {
        sent = JSON.parse(String(init?.body))
        return { status: 200, body: [] }
      },
    })
    render(
      <AccessSettings
        entity="deck"
        subject={subject()}
        isOwner
        onChange={vi.fn()}
      />,
    )
    const menu = await screen.findByLabelText('Invitation for mary@example.com')
    expect(screen.getByText('Invited')).toBeInTheDocument()
    expect(menu).not.toHaveTextContent('Transfer ownership')
    expect(menu).toHaveTextContent('Withdraw invitation')
    fireEvent.change(menu, { target: { value: 'remove' } })
    await vi.waitFor(() =>
      expect(sent).toEqual({
        deckId: 'x1',
        email: 'mary@example.com',
        role: 'viewer',
      }),
    )
  })

  // Sharing needs the sharer's own address confirmed (SHARE-3); that
  // refusal has its own code, so it opens a dialog offering a fresh link
  // rather than reading like a mistyped address.
  it('offers a confirmation link when the account is unconfirmed', async () => {
    mockFetchRoutes({
      '/api/actions/deck.shares': () => ({ status: 200, body: [] }),
      '/api/actions/deck.share': () => ({
        status: 403,
        body: {
          error: { code: 'email_unverified', message: 'Confirm your address' },
        },
      }),
    })
    render(
      <AccessSettings
        entity="deck"
        subject={subject()}
        isOwner
        onChange={vi.fn()}
      />,
    )
    fireEvent.change(await screen.findByLabelText('Add people by email'), {
      target: { value: 'byron@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Confirm your email address first',
    })
    expect(
      within(dialog).getByRole('button', { name: 'Send another link' }),
    ).toBeInTheDocument()
    // And not the generic failure copy a bad address would get
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('hides Transfer ownership from non-owners', async () => {
    mockFetchRoutes({
      '/api/actions/project.shares': () => ({ status: 200, body: [share] }),
    })
    render(
      <AccessSettings
        entity="project"
        subject={subject()}
        isOwner={false}
        onChange={vi.fn()}
      />,
    )
    const menu = await screen.findByLabelText('Role for byron')
    expect(menu).not.toHaveTextContent('Transfer ownership')
    expect(menu).toHaveTextContent('Remove access')
  })
})
