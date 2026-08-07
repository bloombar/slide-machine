/**
 * Unit tests for the template library (TMPL-1): a template is chosen by
 * looking at a preview of it, and the caller's own carry the actions that
 * only make sense for something you authored. The editor has its own file.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { Layout, Template } from '@slide-machine/shared'
import TemplateLibrary from './TemplateLibrary'

const layout = (type: string, label: string, slots: string[]): Layout =>
  ({
    type,
    label,
    purpose: `use for ${type}`,
    slots: slots.map(name => ({ name, kind: 'text', label: name })),
    elementPositions: {},
  }) as Layout

const template = (over: Partial<Template> = {}): Template => ({
  id: 'built-1',
  permalinkSlug: 'built-1',
  ownerId: 'system',
  name: 'Shipped',
  theme: { background: '#ffffff', text: '#000000', accent: '#ff0000' },
  layouts: [
    layout('content', 'Content', ['title', 'body']),
    layout('whiteboard', 'Whiteboard', []),
  ],
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

const renderLibrary = (
  props: Partial<Parameters<typeof TemplateLibrary>[0]> = {},
) =>
  render(
    <MemoryRouter>
      <TemplateLibrary
        templates={[template(), mine]}
        value="built-1"
        onChange={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  )

describe('TemplateLibrary (TMPL-1)', () => {
  it('shows a preview of each template, not just its name', () => {
    renderLibrary()
    // The real slide renderer, so what you see is what a slide looks like
    expect(screen.getAllByTestId('template-preview')).toHaveLength(2)
  })

  it('previews with the template’s own theme', () => {
    renderLibrary()
    const [first] = screen.getAllByTestId('template-preview')
    expect(first).toHaveStyle({ backgroundColor: '#ffffff' })
  })

  it('selects a template by clicking it', () => {
    const onChange = vi.fn()
    renderLibrary({ onChange })
    fireEvent.click(screen.getByRole('radio', { name: /My Style/ }))
    expect(onChange).toHaveBeenCalledWith('mine-1')
  })

  it('marks the chosen one as checked', () => {
    renderLibrary()
    expect(screen.getByRole('radio', { name: /Shipped/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('offers edit and delete only on templates you authored', () => {
    renderLibrary({
      userId: 'u1',
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onDuplicate: vi.fn(),
    })
    expect(screen.getByLabelText('Edit My Style')).toBeInTheDocument()
    expect(screen.getByLabelText('Delete My Style')).toBeInTheDocument()
    // The shipped one is read-only: duplicate it instead
    expect(screen.queryByLabelText('Edit Shipped')).toBeNull()
    expect(screen.queryByLabelText('Delete Shipped')).toBeNull()
    expect(screen.getByLabelText('Duplicate Shipped')).toBeInTheDocument()
  })

  it('marks your own templates as custom', () => {
    renderLibrary({ userId: 'u1' })
    expect(screen.getByText('Custom')).toBeInTheDocument()
  })
})
