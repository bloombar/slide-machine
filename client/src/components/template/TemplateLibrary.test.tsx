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

  it('declares how it wants to be drawn, based on what was arranged', () => {
    const onSave = renderEditor()
    // Nothing arranged: the hand-tuned components stay in charge
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave.mock.calls[0]![0].renderMode).toBe('components')

    // Arranging one layout is what asks for the engine
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Arrange this layout' })[0]!,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave.mock.calls[1]![0].renderMode).toBe('positioned')
  })

  it('removes a layout, but never the whiteboard (TMPL-7)', () => {
    const onSave = renderEditor()
    expect(screen.queryByLabelText(/Remove the Whiteboard layout/)).toBeNull()
    fireEvent.click(screen.getByLabelText('Remove the Content layout'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const types = onSave.mock.calls[0]![0].layouts.map((l: Layout) => l.type)
    expect(types).toEqual(['whiteboard'])
  })

  it('adds a box for something the author wants on the slide', () => {
    const onSave = renderEditor()
    fireEvent.change(screen.getAllByLabelText('Name this box')[0]!, {
      target: { value: 'Photo' },
    })
    fireEvent.change(screen.getAllByLabelText('What goes in it').at(-1)!, {
      target: { value: 'image' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Add a box' })[0]!)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const content = onSave.mock.calls[0]![0].layouts.find(
      (l: Layout) => l.type === 'content',
    )
    expect(content.slots.at(-1)).toMatchObject({
      name: 'photo',
      kind: 'image',
      label: 'Photo',
    })
  })

  it('takes four pictures on one slide (the professor’s case)', () => {
    const onSave = renderEditor()
    for (let i = 0; i < 4; i++) {
      fireEvent.change(screen.getAllByLabelText('Name this box')[0]!, {
        target: { value: 'Photo' },
      })
      fireEvent.change(screen.getAllByLabelText('What goes in it').at(-1)!, {
        target: { value: 'image' },
      })
      fireEvent.click(screen.getAllByRole('button', { name: 'Add a box' })[0]!)
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const content = onSave.mock.calls[0]![0].layouts.find(
      (l: Layout) => l.type === 'content',
    )
    const images = content.slots.filter(
      (s: { kind: string }) => s.kind === 'image',
    )
    expect(images).toHaveLength(4)
    // Each keeps a name of its own, so four pictures are four pictures
    expect(new Set(images.map((s: { name: string }) => s.name)).size).toBe(4)
  })

  it('removes a box, and the arrangement that placed it', () => {
    const onSave = vi.fn()
    const arranged = template({
      id: 'mine-1',
      ownerId: 'u1',
      layouts: [
        {
          ...layout('content', 'Content', ['title', 'body']),
          elementPositions: {
            title: { x: 0, y: 0, w: 1, h: 0.3 },
            body: { x: 0, y: 0.35, w: 1, h: 0.6 },
          },
        } as Layout,
        layout('whiteboard', 'Whiteboard', []),
      ],
    })
    render(
      <MemoryRouter>
        <TemplateEditor
          template={arranged}
          layoutSources={[template()]}
          onSave={onSave}
          onCancel={vi.fn()}
        />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove the body box' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const content = onSave.mock.calls[0]![0].layouts.find(
      (l: Layout) => l.type === 'content',
    )
    expect(content.slots.map((s: { name: string }) => s.name)).toEqual([
      'title',
    ])
    // The box left behind would be drawn for a slot that no longer exists
    expect(content.elementPositions).toEqual({
      title: { x: 0, y: 0, w: 1, h: 0.3 },
    })
  })

  it('places a box added to an already-arranged layout', () => {
    const onSave = vi.fn()
    const arranged = template({
      id: 'mine-1',
      ownerId: 'u1',
      layouts: [
        {
          ...layout('content', 'Content', ['title']),
          elementPositions: { title: { x: 0, y: 0, w: 1, h: 0.3 } },
        } as Layout,
        layout('whiteboard', 'Whiteboard', []),
      ],
    })
    render(
      <MemoryRouter>
        <TemplateEditor
          template={arranged}
          layoutSources={[template()]}
          onSave={onSave}
          onCancel={vi.fn()}
        />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getAllByLabelText('Name this box')[0]!, {
      target: { value: 'Photo' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Add a box' })[0]!)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const content = onSave.mock.calls[0]![0].layouts.find(
      (l: Layout) => l.type === 'content',
    )
    // Without a box of its own the new slot would save but never be drawn
    expect(content.elementPositions.photo).toBeDefined()
  })

  it('makes a layout of the author’s own when none of the conventional ones fits (TMPL-9)', () => {
    const onSave = renderEditor()
    fireEvent.change(screen.getByLabelText('Name this layout'), {
      target: { value: 'Lab safety' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add layout' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const added = onSave.mock.calls[0]![0].layouts.find(
      (l: Layout) => l.type === 'lab-safety',
    )
    expect(added.label).toBe('Lab safety')
    // It starts with a box, since a layout holding nothing cannot be saved
    expect(added.slots).toHaveLength(1)
  })

  it('keeps two layouts of the author’s own apart', () => {
    const onSave = renderEditor()
    for (let i = 0; i < 2; i++) {
      fireEvent.change(screen.getByLabelText('Name this layout'), {
        target: { value: 'Lab safety' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Add layout' }))
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const types = onSave.mock.calls[0]![0].layouts.map((l: Layout) => l.type)
    // A slide stores its layout as a type, so two cannot share one
    expect(types).toContain('lab-safety')
    expect(types).toContain('lab-safety-2')
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
