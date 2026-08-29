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
    // Positioned rather than empty, so the data-driven renderer draws every
    // slot and a test can read which layout is on screen off the slide.
    elementPositions: Object.fromEntries(
      slots.map((name, i) => [
        name,
        { x: 0.1, y: 0.1 + i * 0.2, w: 0.8, h: 0.15 },
      ]),
    ),
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

/** Three layouts to page through, plus the whiteboard that is never paged to.
 * Each carries a distinctly named slot, so which layout is drawn can be read
 * off the rendered slide rather than only off the counter. */
const many = template({
  id: 'many-1',
  name: 'Many',
  layouts: [
    layout('content', 'Content', ['title', 'contentMark']),
    layout('list', 'List', ['listMark']),
    layout('title', 'Title', ['titleMark']),
    layout('whiteboard', 'Whiteboard', []),
  ],
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

describe('TemplateLibrary layout paging (TMPL-1)', () => {
  const renderMany = (
    props: Partial<Parameters<typeof TemplateLibrary>[0]> = {},
  ) => renderLibrary({ templates: [many], value: 'many-1', ...props })

  it('offers no arrows on a template with a single layout to show', () => {
    // The shipped fixture is one content layout plus the whiteboard
    renderLibrary({ templates: [template()], value: 'built-1' })
    expect(screen.queryByLabelText(/^Next layout/)).toBeNull()
    expect(screen.queryByLabelText(/^Previous layout/)).toBeNull()
  })

  it('starts on the design’s first layout, whatever type it is', () => {
    // Not the one a preview picks when left to itself: paging runs through a
    // template in the order it declares its layouts
    renderLibrary({
      templates: [
        template({
          layouts: [
            layout('title', 'Title', ['titleMark']),
            layout('content', 'Content', ['contentMark']),
          ],
        }),
      ],
    })
    expect(screen.getByText('1/2')).toBeInTheDocument()
    expect(screen.getByText('titleMark')).toBeInTheDocument()
  })

  it('steps to the next layout without leaving the tab', () => {
    renderMany()
    expect(screen.getByText('1/3')).toBeInTheDocument()
    expect(screen.getByText('contentMark')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Next layout of Many'))

    // The counter moved and so did the slide it names
    expect(screen.getByText('2/3')).toBeInTheDocument()
    expect(screen.getByText('listMark')).toBeInTheDocument()
    expect(screen.queryByText('contentMark')).toBeNull()
  })

  it('steps backwards too', () => {
    renderMany()
    fireEvent.click(screen.getByLabelText('Next layout of Many'))
    fireEvent.click(screen.getByLabelText('Previous layout of Many'))
    expect(screen.getByText('1/3')).toBeInTheDocument()
    expect(screen.getByText('contentMark')).toBeInTheDocument()
  })

  it('wraps round the ends rather than stopping', () => {
    renderMany()
    fireEvent.click(screen.getByLabelText('Previous layout of Many'))
    // Back from the first is the last
    expect(screen.getByText('3/3')).toBeInTheDocument()
    expect(screen.getByText('titleMark')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Next layout of Many'))
    expect(screen.getByText('1/3')).toBeInTheDocument()
  })

  it('never pages to the whiteboard', () => {
    renderMany()
    // Four layouts, three of them worth showing (TMPL-7)
    const next = screen.getByLabelText('Next layout of Many')
    for (let i = 0; i < 3; i++) fireEvent.click(next)
    expect(screen.getByText('1/3')).toBeInTheDocument()
    expect(screen.getByText('contentMark')).toBeInTheDocument()
  })

  it('does not select the template it is paging', () => {
    const onChange = vi.fn()
    renderMany({ onChange, value: 'built-1', templates: [template(), many] })
    fireEvent.click(screen.getByLabelText('Next layout of Many'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('leaves the other cards where they were', () => {
    const other = template({
      id: 'many-2',
      name: 'Other',
      layouts: many.layouts,
    })
    renderLibrary({ templates: [many, other], value: 'many-1' })
    fireEvent.click(screen.getByLabelText('Next layout of Many'))
    // One card moved on, the other did not
    expect(screen.getByText('2/3')).toBeInTheDocument()
    expect(screen.getByText('1/3')).toBeInTheDocument()
  })
})
