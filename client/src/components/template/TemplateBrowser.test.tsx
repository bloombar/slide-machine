/**
 * Unit tests for `TemplateBrowser` (TMPL-28) that neither the Design
 * Templates page's own tests (link mode, `DesignTemplatesPage.test.tsx`) nor
 * `TemplateDesignPanel.test.tsx` (select mode via the panel) already cover
 * directly: the pinned "Current design" is left out of the fetched grid
 * below it, so one design never offers two radios for the same choice, and
 * infinite scroll still works in select mode.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
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
})
