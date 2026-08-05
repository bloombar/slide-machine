/**
 * Unit tests for the template library (TMPL-1) and the editor (TMPL-4): a
 * template is chosen by looking at a preview of it, the caller's own carry the
 * actions that only make sense for something you authored, and the editor
 * saves a name, a theme, sharing, and the layout set.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { Layout, Template } from '@slide-machine/shared'
import TemplateLibrary from './TemplateLibrary'
import TemplateEditor from './TemplateEditor'

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

describe('TemplateEditor (TMPL-4)', () => {
  const renderEditor = (onSave = vi.fn()) => {
    render(
      <MemoryRouter>
        <TemplateEditor
          template={mine}
          layoutSources={[template()]}
          onSave={onSave}
          onCancel={vi.fn()}
        />
      </MemoryRouter>,
    )
    return onSave
  }

  it('saves a new name', () => {
    const onSave = renderEditor()
    fireEvent.change(screen.getByLabelText('Template name'), {
      target: { value: 'Renamed' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Renamed' }),
    )
  })

  it('saves a theme colour', () => {
    const onSave = renderEditor()
    fireEvent.change(screen.getByLabelText('Accent'), {
      target: { value: '#00ff00' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave.mock.calls[0]![0].theme.accent).toBe('#00ff00')
  })

  it('saves who may use it (TMPL-4 sharing)', () => {
    const onSave = renderEditor()
    fireEvent.change(screen.getByLabelText('Who can use it'), {
      target: { value: 'public' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'public' }),
    )
  })

  it('edits the purpose the AI reads when choosing a layout (TMPL-6)', () => {
    const onSave = renderEditor()
    fireEvent.change(screen.getByDisplayValue('use for content'), {
      target: { value: 'use for a single idea' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const saved = onSave.mock.calls[0]![0].layouts.find(
      (l: Layout) => l.type === 'content',
    )
    expect(saved.purpose).toBe('use for a single idea')
  })

  it('removes a layout, but never the whiteboard (TMPL-7)', () => {
    const onSave = renderEditor()
    expect(screen.queryByLabelText(/Remove the Whiteboard layout/)).toBeNull()
    fireEvent.click(screen.getByLabelText('Remove the Content layout'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const types = onSave.mock.calls[0]![0].layouts.map((l: Layout) => l.type)
    expect(types).toEqual(['whiteboard'])
  })

  it('adds a layout by copying its definition from another template', () => {
    const source = template({
      layouts: [
        layout('content', 'Content', ['title', 'body']),
        layout('quote', 'Quote', ['body', 'caption']),
        layout('whiteboard', 'Whiteboard', []),
      ],
    })
    const onSave = vi.fn()
    render(
      <MemoryRouter>
        <TemplateEditor
          template={mine}
          layoutSources={[source]}
          onSave={onSave}
          onCancel={vi.fn()}
        />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByLabelText('Add a layout'), {
      target: { value: 'quote' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const added = onSave.mock.calls[0]![0].layouts.find(
      (l: Layout) => l.type === 'quote',
    )
    // Copied whole, slots included — not invented here
    expect(added.slots.map((s: { name: string }) => s.name)).toEqual([
      'body',
      'caption',
    ])
  })
})
