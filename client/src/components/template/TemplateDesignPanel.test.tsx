/**
 * Unit tests for the Design tab's template panel (TMPL-1/TMPL-4).
 *
 * The panel's own job is what happens around the library: duplicating makes a
 * copy, and either duplicating or opening a template's settings sends the
 * author to that template's own page — having first applied it, since an
 * author works on a design to see it where it is used.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
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
  voteScore: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

const mine = template({
  id: 'mine-1',
  permalinkSlug: 'my-style-ab12',
  ownerId: 'u1',
  name: 'My Style',
  visibility: 'private',
})

const copy = template({
  id: 'copy-1',
  permalinkSlug: 'shipped-2-cd34',
  ownerId: 'u1',
  name: 'Shipped 2',
  visibility: 'private',
})

/** Stands in for the template's own page, so a test can say where the panel
 * sent the author and what it told that page about where they came from. */
function Landed() {
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  return <p>{`landed:${location.pathname} from:${from ?? ''}`}</p>
}

const renderPanel = (
  props: Partial<Parameters<typeof TemplateDesignPanel>[0]> = {},
) => {
  const onChange = vi.fn()
  render(
    <MemoryRouter initialEntries={['/d/lecture-1']}>
      <Routes>
        <Route
          path="/d/:slug"
          element={
            <TemplateDesignPanel
              templates={[template(), mine]}
              value="built-1"
              onChange={onChange}
              onLibraryChanged={vi.fn()}
              {...props}
            />
          }
        />
        <Route path="/t/:slug" element={<Landed />} />
      </Routes>
    </MemoryRouter>,
  )
  return onChange
}

beforeEach(() => vi.mocked(dispatchAction).mockReset())
afterEach(cleanup)

describe('TemplateDesignPanel (TMPL-4)', () => {
  it('applies a duplicate as soon as it exists, and opens its page', async () => {
    vi.mocked(dispatchAction).mockResolvedValue(copy)
    const onChange = renderPanel()

    fireEvent.click(screen.getByLabelText('Duplicate Shipped'))

    // The copy is handed over with the id: the caller cannot look it up in a
    // library that has not reloaded yet.
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('copy-1', copy))
    // Its own page, by permalink, knowing where to send the author back to.
    expect(
      await screen.findByText('landed:/t/shipped-2-cd34 from:/d/lecture-1'),
    ).toBeInTheDocument()
  })

  it('applies nothing when the duplicate is refused', async () => {
    vi.mocked(dispatchAction).mockImplementation(action =>
      action === 'template.duplicate'
        ? Promise.reject(new Error('nope'))
        : Promise.resolve({ urls: [] }),
    )
    const onChange = renderPanel()

    fireEvent.click(screen.getByLabelText('Duplicate Shipped'))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByText(/^landed:/)).toBeNull()
  })

  it('applies the template whose settings are opened, and opens its page', () => {
    const onChange = renderPanel()

    fireEvent.click(screen.getByLabelText('Edit My Style'))

    expect(onChange).toHaveBeenCalledWith('mine-1', mine)
    expect(
      screen.getByText('landed:/t/my-style-ab12 from:/d/lecture-1'),
    ).toBeInTheDocument()
  })

  it('does not re-apply the template already in use', () => {
    const onChange = renderPanel({ value: 'mine-1' })

    fireEvent.click(screen.getByLabelText('Edit My Style'))

    expect(onChange).not.toHaveBeenCalled()
    expect(
      screen.getByText('landed:/t/my-style-ab12 from:/d/lecture-1'),
    ).toBeInTheDocument()
  })
})
