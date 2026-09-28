/**
 * Unit tests for `TemplateBrowser` (TMPL-28) that neither the Design
 * Templates page's own tests (link mode, `DesignTemplatesPage.test.tsx`) nor
 * `TemplateDesignPanel.test.tsx` (select mode via the panel) already cover
 * directly: the pinned "Current design" is left out of the fetched grid
 * below it, so one design never offers two radios for the same choice, and
 * infinite scroll still works in select mode.
 */
import { useState } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { Template } from '@slide-machine/shared'
import TemplateBrowser from './TemplateBrowser'
import { dispatchAction } from '../../api/actions'

vi.mock('../../api/actions')
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}))

const template = (over: Partial<Template> = {}): Template => ({
  id: 'built-1',
  permalinkSlug: 'built-1',
  ownerId: 'system',
  name: 'Shipped',
  theme: { background: '#ffffff', text: '#000000', accent: '#ff0000' },
  layouts: [],
  visibility: 'public',
  myRole: null,
  voteScore: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

afterEach(cleanup)

describe('TemplateBrowser select mode (TMPL-28)', () => {
  it('leaves the current design out of the fetched grid, rather than showing it twice', async () => {
    const current = template({ id: 'cur-1', name: 'Current' })
    vi.mocked(dispatchAction).mockResolvedValue({
      items: [current, template({ id: 'other-1', name: 'Other' })],
      hasMore: false,
    })

    render(
      <MemoryRouter>
        <TemplateBrowser
          mode="select"
          value="cur-1"
          current={current}
          onSelect={vi.fn()}
          linkState={{ from: '/x' }}
        />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Current design')).toBeInTheDocument()
    // One radio for "Current" (the pin), not two.
    expect(screen.getAllByRole('radio', { name: /Current/ })).toHaveLength(1)
    expect(screen.getByRole('radio', { name: /Other/ })).toBeInTheDocument()
  })

  it('loads more results in select mode, same as link mode', async () => {
    vi.mocked(dispatchAction).mockImplementation(
      async (action: string, input?: unknown) => {
        if (action !== 'template.feed') throw new Error(`unexpected ${action}`)
        const { offset } = input as { offset: number }
        return offset === 0
          ? { items: [template({ id: 'a', name: 'Alpha' })], hasMore: true }
          : { items: [template({ id: 'b', name: 'Beta' })], hasMore: false }
      },
    )

    render(
      <MemoryRouter>
        <TemplateBrowser
          mode="select"
          value="none"
          current={null}
          onSelect={vi.fn()}
          linkState={{ from: '/x' }}
        />
      </MemoryRouter>,
    )

    await screen.findByText('Alpha')
    fireEvent.click(screen.getByRole('button', { name: /load more/i }))
    expect(await screen.findByText('Beta')).toBeInTheDocument()
  })

  it('applies a card chosen from the grid', async () => {
    vi.mocked(dispatchAction).mockResolvedValue({
      items: [template({ id: 'a', name: 'Alpha' })],
      hasMore: false,
    })
    const onSelect = vi.fn()

    render(
      <MemoryRouter>
        <TemplateBrowser
          mode="select"
          value="none"
          current={null}
          onSelect={onSelect}
          linkState={{ from: '/x' }}
        />
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('radio', { name: /Alpha/ }))
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a', name: 'Alpha' }),
    )
  })

  /** A caller that actually applies a selection, the way the three settings
   * surfaces do: `current` only moves once `onSelect` resolves — refused or
   * accepted is the harness's own choice to make. */
  function Harness({
    initialCurrent,
    apply,
  }: {
    initialCurrent: Template | null
    apply: boolean
  }) {
    const [current, setCurrent] = useState<Template | null>(initialCurrent)
    return (
      <MemoryRouter>
        <TemplateBrowser
          mode="select"
          value={current?.id ?? 'none'}
          current={current}
          onSelect={t => apply && setCurrent(t)}
          onCurrentDeleted={() => setCurrent(null)}
          linkState={{ from: '/x' }}
        />
      </MemoryRouter>
    )
  }

  it('leaves the pin unchanged when a switch is refused', async () => {
    const original = template({ id: 'cur-1', name: 'Current' })
    vi.mocked(dispatchAction).mockResolvedValue({
      items: [template({ id: 'a', name: 'Alpha' })],
      hasMore: false,
    })
    render(<Harness initialCurrent={original} apply={false} />)

    fireEvent.click(await screen.findByRole('radio', { name: /Alpha/ }))

    // The pin still names the original design, not "Alpha" — the refused
    // switch never reached it.
    expect(screen.getByRole('radio', { name: /Current/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    // And "Alpha" is still on offer in the grid — a refused switch is not a
    // delete, so nothing about it disappears.
    expect(screen.getByRole('radio', { name: /Alpha/ })).toBeInTheDocument()
  })

  it('moves focus to the pinned card once a grid selection is applied', async () => {
    const original = template({ id: 'cur-1', name: 'Current' })
    vi.mocked(dispatchAction).mockResolvedValue({
      items: [template({ id: 'a', name: 'Alpha' })],
      hasMore: false,
    })
    render(<Harness initialCurrent={original} apply />)

    fireEvent.click(await screen.findByRole('radio', { name: /Alpha/ }))

    // "Alpha"'s own card is gone (it is now the pin, deduped out of the
    // grid below) — focus would otherwise have fallen to `<body>`.
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /Alpha/ })).toHaveFocus(),
    )
  })

  it('clears the pin when the pinned design is the one just deleted', async () => {
    const current = template({
      id: 'cur-1',
      name: 'Current',
      myRole: 'owner',
    })
    vi.mocked(dispatchAction).mockImplementation(async (action: string) => {
      if (action === 'template.delete') return {}
      return { items: [], hasMore: false }
    })
    render(<Harness initialCurrent={current} apply />)

    await screen.findByText('Current design')
    fireEvent.click(screen.getByLabelText('Delete Current'))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(screen.queryByText('Current design')).not.toBeInTheDocument(),
    )
  })
})
