/**
 * Unit tests for the shared access settings: one component drives both
 * deck.* and project.* action families; lectures surface inheritance
 * with a reset back to project settings; ownership transfer confirms
 * in a dialog.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AccessSettings, { type AccessSubject } from './AccessSettings'
import { mockFetchRoutes } from '../test/fetch-mock'

const share = {
  userId: 'u2',
  displayName: 'byron',
  email: 'byron@example.com',
  role: 'viewer' as const,
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
