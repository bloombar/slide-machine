/**
 * Unit tests for the Design tab's template panel (TMPL-1/TMPL-4/TMPL-28).
 *
 * The panel's own job is what happens around the browser: duplicating makes
 * a copy, either duplicating or opening a template's settings sends the
 * author to that template's own page — having first applied it, since an
 * author works on a design to see it where it is used — and the currently
 * applied design shows a descriptor-budget notice and is pinned above the
 * browser as "Current design".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import type { Layout, LayoutNode, Template } from '@slide-machine/shared'
import TemplateDesignPanel from './TemplateDesignPanel'
import { dispatchAction } from '../../api/actions'

vi.mock('../../api/actions')
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}))

const tree = (children: LayoutNode[]): LayoutNode => ({
  id: 'root',
  container: { mode: 'flex', direction: 'column', gap: 3 },
  children,
})

const layout = (type: string, label: string, slots: string[]): Layout =>
  ({
    type,
    label,
    purpose: `use for ${type}`,
    slots: slots.map(name => ({ name, kind: 'text', label: name })),
    tree: tree(slots.map(name => ({ id: name, slot: name }))),
    elementPositions: {},
  }) as Layout

const template = (over: Partial<Template> = {}): Template => ({
  id: 'built-1',
  permalinkSlug: 'built-1',
  ownerId: 'system',
  name: 'Shipped',
  theme: { background: '#ffffff', text: '#000000', accent: '#ff0000' },
  layouts: [layout('content', 'Content', ['title', 'body'])],
  visibility: 'public',
  myRole: null,
  voteScore: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

const mine = template({
  id: 'mine-1',
  permalinkSlug: 'my-style-ab12',
  ownerId: 'u1',
  name: 'My Style',
  visibility: 'restricted',
  myRole: 'owner',
})

const copy = template({
  id: 'copy-1',
  permalinkSlug: 'shipped-2-cd34',
  ownerId: 'u1',
  name: 'Shipped 2',
  visibility: 'restricted',
  myRole: 'owner',
})

/** Stands in for the template's own page, so a test can say where the panel
 * sent the author and what it told that page about where they came from. */
function Landed() {
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  return <p>{`landed:${location.pathname} from:${from ?? ''}`}</p>
}

/** Every fetch the panel and its browser can make, defaulted to a quiet
 * "one design, nothing else on the feed" library so a test only overrides
 * what it cares about. */
const defaultDispatch = (over: Partial<Template> = {}) =>
  vi.fn(async (action: string, input?: unknown) => {
    if (action === 'template.getById')
      return template({ id: (input as { templateId: string }).templateId })
    if (action === 'template.descriptorStatus')
      return { length: 0, max: 5000, overBudget: false }
    if (action === 'template.feed' || action === 'template.search')
      return { items: [template(over)], hasMore: false }
    throw new Error(`unexpected action ${action}`)
  })

const renderPanel = (
  props: Partial<Parameters<typeof TemplateDesignPanel>[0]> = {},
) => {
  const onSelect = vi.fn()
  render(
    <MemoryRouter initialEntries={['/d/lecture-1']}>
      <Routes>
        <Route
          path="/d/:slug"
          element={
            <TemplateDesignPanel
              value="built-1"
              current={template()}
              onSelect={onSelect}
              {...props}
            />
          }
        />
        <Route path="/t/:slug" element={<Landed />} />
      </Routes>
    </MemoryRouter>,
  )
  return onSelect
}

beforeEach(() => {
  vi.mocked(dispatchAction).mockReset()
  vi.mocked(dispatchAction).mockImplementation(defaultDispatch())
})
afterEach(cleanup)

describe('TemplateDesignPanel (TMPL-4/TMPL-28)', () => {
  it('opens on Latest when no design is applied', async () => {
    renderPanel({ current: null, value: '' })
    expect(
      await screen.findByRole('button', { name: 'Latest' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('waits for the applied design before choosing the tab, then opens on Mine for one of the caller’s own', async () => {
    const ui = (current: Template | null | undefined) => (
      <MemoryRouter initialEntries={['/d/lecture-1']}>
        <Routes>
          <Route
            path="/d/:slug"
            element={
              <TemplateDesignPanel
                value="mine-1"
                current={current}
                onSelect={vi.fn()}
              />
            }
          />
        </Routes>
      </MemoryRouter>
    )
    const { rerender } = render(ui(undefined))
    // Still loading: no tab chosen yet, so no feed asked for either
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(dispatchAction).not.toHaveBeenCalledWith(
      'template.feed',
      expect.anything(),
    )

    rerender(ui(mine))
    expect(await screen.findByRole('button', { name: 'Mine' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await waitFor(() =>
      expect(dispatchAction).toHaveBeenCalledWith(
        'template.feed',
        expect.objectContaining({ sort: 'mine' }),
      ),
    )
  })

  it('pins the currently applied design above the browser as "Current design"', async () => {
    renderPanel({ current: mine })
    expect(await screen.findByText('Current design')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /My Style/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('offers Latest, Top and Mine, like the Design templates page', async () => {
    renderPanel()
    await screen.findByRole('radiogroup')
    expect(screen.getByRole('button', { name: 'Latest' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Top' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mine' })).toBeInTheDocument()
    expect(
      screen.getByRole('searchbox', {
        name: /search by title, creator, or ai instructions/i,
      }),
    ).toBeInTheDocument()
  })

  it('applies a duplicate as soon as it exists, and opens its page', async () => {
    vi.mocked(dispatchAction).mockImplementation(
      vi.fn(async (action: string, input?: unknown) => {
        if (action === 'template.duplicate') return copy
        return defaultDispatch()(action, input)
      }),
    )
    const onSelect = renderPanel()

    fireEvent.click(await screen.findByLabelText('Duplicate Shipped'))

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(copy))
    expect(
      await screen.findByText('landed:/t/shipped-2-cd34 from:/d/lecture-1'),
    ).toBeInTheDocument()
  })

  it('applies nothing when the duplicate is refused', async () => {
    vi.mocked(dispatchAction).mockImplementation(
      vi.fn(async (action: string, input?: unknown) => {
        if (action === 'template.duplicate')
          return Promise.reject(new Error('nope'))
        return defaultDispatch()(action, input)
      }),
    )
    const onSelect = renderPanel()

    fireEvent.click(await screen.findByLabelText('Duplicate Shipped'))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.queryByText(/^landed:/)).toBeNull()
  })

  it('applies the template whose settings are opened, and opens its page', async () => {
    vi.mocked(dispatchAction).mockImplementation(
      vi.fn(async (action: string, input?: unknown) => {
        if (action === 'template.feed' || action === 'template.search')
          return { items: [mine], hasMore: false }
        return defaultDispatch()(action, input)
      }),
    )
    const onSelect = renderPanel()

    fireEvent.click(await screen.findByLabelText('Edit My Style'))

    expect(onSelect).toHaveBeenCalledWith(mine)
    expect(
      await screen.findByText('landed:/t/my-style-ab12 from:/d/lecture-1'),
    ).toBeInTheDocument()
  })

  it('does not re-apply the template already in use', async () => {
    vi.mocked(dispatchAction).mockImplementation(
      vi.fn(async (action: string, input?: unknown) => {
        if (action === 'template.feed' || action === 'template.search')
          return { items: [mine], hasMore: false }
        return defaultDispatch()(action, input)
      }),
    )
    const onSelect = renderPanel({ value: 'mine-1', current: mine })

    fireEvent.click(await screen.findByLabelText('Edit My Style'))

    expect(onSelect).not.toHaveBeenCalled()
    expect(
      await screen.findByText('landed:/t/my-style-ab12 from:/d/lecture-1'),
    ).toBeInTheDocument()
  })

  // TMPL-28: import used to unfold inline beneath the library; it now opens
  // in a dialog, the same shared control the Design templates page uses.
  it('opens Import a design in a dialog, not inline', async () => {
    renderPanel()
    await screen.findByRole('radiogroup')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Choose from Google Drive' }),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Import a design$/i }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: 'Choose from Google Drive' }),
    ).toBeVisible()
  })
})
