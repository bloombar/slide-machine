/**
 * Unit tests for the Design tab's template panel (TMPL-1/TMPL-4).
 *
 * The panel's own job is what happens around the library and the editor:
 * duplicating makes a copy, opening a template's settings opens the editor,
 * and either way the template being worked on becomes the chosen one — an
 * author edits a design to see it where it is used.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from '@testing-library/react'
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
  ownerId: 'u1',
  name: 'My Style',
  visibility: 'private',
})

const copy = template({
  id: 'copy-1',
  ownerId: 'u1',
  name: 'Shipped (copy)',
  visibility: 'private',
})

const renderPanel = (
  props: Partial<Parameters<typeof TemplateDesignPanel>[0]> = {},
) => {
  const onChange = vi.fn()
  render(
    <TemplateDesignPanel
      templates={[template(), mine]}
      value="built-1"
      onChange={onChange}
      onLibraryChanged={vi.fn()}
      {...props}
    />,
  )
  return onChange
}

beforeEach(() => vi.mocked(dispatchAction).mockReset())
afterEach(cleanup)

describe('TemplateDesignPanel (TMPL-4)', () => {
  it('applies a duplicate as soon as it exists, and opens it for editing', async () => {
    vi.mocked(dispatchAction).mockResolvedValue(copy)
    const onChange = renderPanel()

    fireEvent.click(screen.getByLabelText('Duplicate Shipped'))

    // The copy is handed over with the id: the caller cannot look it up in a
    // library that has not reloaded yet.
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('copy-1', copy))
    expect(await screen.findByLabelText('Template name')).toHaveValue(
      'Shipped (copy)',
    )
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
    expect(screen.queryByLabelText('Template name')).toBeNull()
  })

  it('applies the template whose settings are opened for editing', () => {
    const onChange = renderPanel()

    fireEvent.click(screen.getByLabelText('Edit My Style'))

    expect(onChange).toHaveBeenCalledWith('mine-1', mine)
    expect(screen.getByLabelText('Template name')).toHaveValue('My Style')
  })

  it('does not re-apply the template already in use', () => {
    const onChange = renderPanel({ value: 'mine-1' })

    fireEvent.click(screen.getByLabelText('Edit My Style'))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Template name')).toHaveValue('My Style')
  })
})
