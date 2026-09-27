/**
 * Unit tests for the template library (TMPL-1): a template is chosen by
 * looking at a preview of it, and the caller's own carry the actions that
 * only make sense for something you authored. The editor has its own file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { Layout, Template } from '@slide-machine/shared'
import TemplateLibrary from './TemplateLibrary'
import { dispatchAction } from '../../api/actions'

vi.mock('../../api/actions', () => ({ dispatchAction: vi.fn() }))

beforeEach(() => {
  vi.mocked(dispatchAction).mockReset()
})

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
  myRole: null,
  voteScore: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

const mine = template({
  id: 'mine-1',
  ownerId: 'u1',
  name: 'My Style',
  visibility: 'restricted',
  myRole: 'owner',
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
    renderLibrary()
    expect(screen.getByText('Custom')).toBeInTheDocument()
  })

  // TMPL-26: a design shared with the caller as an editor gets the pencil,
  // same as one they authored, but never the trash — only the owner deletes.
  it('offers edit but not delete on a design shared as editor', () => {
    const editable = template({
      id: 'shared-1',
      name: 'Shared With Me',
      ownerId: 'u2',
      visibility: 'restricted',
      myRole: 'editor',
    })
    renderLibrary({
      templates: [template(), editable],
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onDuplicate: vi.fn(),
    })
    expect(screen.getByLabelText('Edit Shared With Me')).toBeInTheDocument()
    expect(screen.queryByLabelText('Delete Shared With Me')).toBeNull()
  })

  // A viewer gets neither: template.update would refuse them.
  it('offers no edit or delete on a design shared as viewer', () => {
    const readOnly = template({
      id: 'shared-2',
      name: 'Viewer Only',
      ownerId: 'u2',
      visibility: 'restricted',
      myRole: 'viewer',
    })
    renderLibrary({
      templates: [template(), readOnly],
      onEdit: vi.fn(),
      onDelete: vi.fn(),
    })
    expect(screen.queryByLabelText('Edit Viewer Only')).toBeNull()
    expect(screen.queryByLabelText('Delete Viewer Only')).toBeNull()
  })

  // Distinct from "Custom": a design is either authored by the caller or
  // shared with them, never both at once.
  it('marks a design shared with the caller, rather than authored by them', () => {
    const editable = template({
      id: 'shared-1',
      name: 'Shared With Me',
      ownerId: 'u2',
      myRole: 'editor',
    })
    renderLibrary({ templates: [template(), editable] })
    expect(screen.getByText('Shared')).toBeInTheDocument()
    expect(screen.queryByText('Custom')).toBeNull()
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

// TMPL-27: every card carries a vote, at the right of its icon row.
describe('TemplateLibrary voting (TMPL-27)', () => {
  it('offers vote buttons on a built-in and on someone else’s design', () => {
    const shared = template({
      id: 'shared-1',
      name: 'Shared With Me',
      ownerId: 'u2',
      myRole: 'viewer',
      votes: { up: 2, down: 0, myVote: 0 },
    })
    renderLibrary({ templates: [template(), shared] })
    expect(
      screen.getByRole('button', { name: 'Upvote Shipped' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Upvote Shared With Me' }),
    ).toBeInTheDocument()
  })

  it('shows a read-only tally on the caller’s own template instead of buttons', () => {
    renderLibrary({
      templates: [
        template(),
        template({
          id: 'mine-2',
          ownerId: 'u1',
          name: 'My Style',
          myRole: 'owner',
          votes: { up: 3, down: 1, myVote: 0 },
        }),
      ],
    })
    expect(screen.getByText('4 votes')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Upvote My Style' })).toBeNull()
  })

  it('does not select the card when voting', () => {
    const onChange = vi.fn()
    vi.mocked(dispatchAction).mockResolvedValue({
      up: 1,
      down: 0,
      voteScore: 1,
      myVote: 1,
    })
    renderLibrary({ onChange })
    fireEvent.click(screen.getByRole('button', { name: 'Upvote Shipped' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('dispatches template.vote with the built-in’s own id', async () => {
    vi.mocked(dispatchAction).mockResolvedValue({
      up: 1,
      down: 0,
      voteScore: 1,
      myVote: 1,
    })
    renderLibrary()
    fireEvent.click(screen.getByRole('button', { name: 'Upvote Shipped' }))
    await waitFor(() =>
      expect(dispatchAction).toHaveBeenCalledWith('template.vote', {
        templateId: 'built-1',
        value: 1,
      }),
    )
  })

  // TMPL-27 round 2: a library reload (after a duplicate, a delete, or an
  // import) hands the card a *new* `templates` prop, whose `votes` should
  // show — this fails without `VoteControl`'s own prop-adopting effect,
  // since the same component instance would otherwise keep whatever it
  // mounted with.
  it('shows updated counts once the library re-renders with fresh vote totals', () => {
    const { rerender } = render(
      <MemoryRouter>
        <TemplateLibrary
          templates={[template()]}
          value="built-1"
          onChange={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(
      screen.getByRole('button', { name: 'Upvote Shipped' }),
    ).toHaveTextContent('0')

    rerender(
      <MemoryRouter>
        <TemplateLibrary
          templates={[template({ votes: { up: 5, down: 2, myVote: 0 } })]}
          value="built-1"
          onChange={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(
      screen.getByRole('button', { name: 'Upvote Shipped' }),
    ).toHaveTextContent('5')
  })
})
