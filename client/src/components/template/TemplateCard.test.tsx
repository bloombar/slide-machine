/**
 * Unit tests for `TemplateCard` (TMPL-1/TMPL-27/TMPL-28): the body every
 * card shares, whichever `TemplateBrowser` mode drew it — layout paging, the
 * Custom/Shared badges, and the action row's edit/delete/vote gating.
 *
 * Ported from the deleted `TemplateLibrary.test.tsx` once that component's
 * own job (the radiogroup and the list around it) moved to `TemplateBrowser`;
 * these cases are about the card alone, so they stay here rather than
 * following it.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { Layout, Template } from '@slide-machine/shared'
import TemplateCard from './TemplateCard'
import { dispatchAction } from '../../api/actions'

vi.mock('../../api/actions', () => ({ dispatchAction: vi.fn() }))

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

/** Three layouts to page through, plus the whiteboard that is never paged
 * to, each carrying a distinctly named slot so the layout on screen can be
 * read off the rendered slide, not just off the counter. */
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

const renderCard = (props: Partial<Parameters<typeof TemplateCard>[0]> = {}) =>
  render(
    <MemoryRouter>
      <TemplateCard template={template()} {...props} />
    </MemoryRouter>,
  )

describe('TemplateCard layout paging (TMPL-1)', () => {
  it('offers no arrows on a template with a single layout to show', () => {
    // The fixture is one content layout plus the whiteboard.
    renderCard()
    expect(screen.queryByLabelText(/^Next layout/)).toBeNull()
    expect(screen.queryByLabelText(/^Previous layout/)).toBeNull()
  })

  it('starts on the design’s first layout, whatever type it is', () => {
    // Not the one a preview picks when left to itself: paging runs through a
    // template in the order it declares its layouts.
    renderCard({
      template: template({
        layouts: [
          layout('title', 'Title', ['titleMark']),
          layout('content', 'Content', ['contentMark']),
        ],
      }),
    })
    expect(screen.getByText('1/2')).toBeInTheDocument()
    expect(screen.getByText('titleMark')).toBeInTheDocument()
  })

  it('steps to the next layout without leaving the card', () => {
    renderCard({ template: many })
    expect(screen.getByText('1/3')).toBeInTheDocument()
    expect(screen.getByText('contentMark')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Next layout of Many'))

    expect(screen.getByText('2/3')).toBeInTheDocument()
    expect(screen.getByText('listMark')).toBeInTheDocument()
    expect(screen.queryByText('contentMark')).toBeNull()
  })

  it('steps backwards too', () => {
    renderCard({ template: many })
    fireEvent.click(screen.getByLabelText('Next layout of Many'))
    fireEvent.click(screen.getByLabelText('Previous layout of Many'))
    expect(screen.getByText('1/3')).toBeInTheDocument()
    expect(screen.getByText('contentMark')).toBeInTheDocument()
  })

  it('wraps round the ends rather than stopping', () => {
    renderCard({ template: many })
    fireEvent.click(screen.getByLabelText('Previous layout of Many'))
    // Back from the first is the last.
    expect(screen.getByText('3/3')).toBeInTheDocument()
    expect(screen.getByText('titleMark')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Next layout of Many'))
    expect(screen.getByText('1/3')).toBeInTheDocument()
  })

  it('never pages to the whiteboard', () => {
    renderCard({ template: many })
    // Four layouts, three of them worth showing (TMPL-7).
    const next = screen.getByLabelText('Next layout of Many')
    for (let i = 0; i < 3; i++) fireEvent.click(next)
    expect(screen.getByText('1/3')).toBeInTheDocument()
    expect(screen.getByText('contentMark')).toBeInTheDocument()
  })

  it('does not select the card it is paging', () => {
    const onSelect = vi.fn()
    renderCard({ template: many, onSelect })
    fireEvent.click(screen.getByLabelText('Next layout of Many'))
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('TemplateCard authoring gates (TMPL-4/TMPL-26)', () => {
  it('offers edit and delete on a design the caller owns', () => {
    renderCard({
      template: template({ myRole: 'owner', name: 'My Style' }),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onDuplicate: vi.fn(),
    })
    expect(screen.getByLabelText('Edit My Style')).toBeInTheDocument()
    expect(screen.getByLabelText('Delete My Style')).toBeInTheDocument()
  })

  it('offers no edit or delete on a design the caller does not own, only duplicate', () => {
    renderCard({ onEdit: vi.fn(), onDelete: vi.fn(), onDuplicate: vi.fn() })
    expect(screen.queryByLabelText('Edit Shipped')).toBeNull()
    expect(screen.queryByLabelText('Delete Shipped')).toBeNull()
    expect(screen.getByLabelText('Duplicate Shipped')).toBeInTheDocument()
  })

  // TMPL-26: a design shared with the caller as an editor gets the pencil,
  // same as one they authored, but never the trash — only the owner deletes.
  it('offers edit but not delete on a design shared as editor', () => {
    renderCard({
      template: template({
        name: 'Shared With Me',
        ownerId: 'u2',
        myRole: 'editor',
      }),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
    })
    expect(screen.getByLabelText('Edit Shared With Me')).toBeInTheDocument()
    expect(screen.queryByLabelText('Delete Shared With Me')).toBeNull()
  })

  // A viewer gets neither: template.update would refuse them.
  it('offers no edit or delete on a design shared as viewer', () => {
    renderCard({
      template: template({
        name: 'Viewer Only',
        ownerId: 'u2',
        myRole: 'viewer',
      }),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
    })
    expect(screen.queryByLabelText('Edit Viewer Only')).toBeNull()
    expect(screen.queryByLabelText('Delete Viewer Only')).toBeNull()
  })

  it('marks a design the caller owns as Custom', () => {
    renderCard({ template: template({ myRole: 'owner' }) })
    expect(screen.getByText('Custom')).toBeInTheDocument()
  })

  // Distinct from "Custom": a design is either authored by the caller or
  // shared with them, never both at once.
  it('marks a design shared with the caller, rather than authored by them', () => {
    renderCard({ template: template({ myRole: 'editor', ownerId: 'u2' }) })
    expect(screen.getByText('Shared')).toBeInTheDocument()
    expect(screen.queryByText('Custom')).toBeNull()
  })
})

describe('TemplateCard voting (TMPL-27)', () => {
  it('offers vote buttons on a built-in and on someone else’s shared design', () => {
    renderCard({
      template: template({
        name: 'Shared With Me',
        ownerId: 'u2',
        myRole: 'viewer',
        votes: { up: 2, down: 0, myVote: 0 },
      }),
    })
    expect(
      screen.getByRole('button', { name: 'Upvote Shared With Me' }),
    ).toBeInTheDocument()
  })

  it('shows a read-only tally on the caller’s own template instead of buttons', () => {
    renderCard({
      template: template({
        name: 'My Style',
        myRole: 'owner',
        votes: { up: 3, down: 1, myVote: 0 },
      }),
    })
    expect(screen.getByText('4 votes')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Upvote My Style' })).toBeNull()
  })

  it('does not select the card when voting', () => {
    const onSelect = vi.fn()
    vi.mocked(dispatchAction).mockResolvedValue({
      up: 1,
      down: 0,
      voteScore: 1,
      myVote: 1,
    })
    renderCard({ onSelect })
    fireEvent.click(screen.getByRole('button', { name: 'Upvote Shipped' }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('reports a settled vote through onVote, with the template’s own id', async () => {
    vi.mocked(dispatchAction).mockResolvedValue({
      up: 1,
      down: 0,
      voteScore: 1,
      myVote: 1,
    })
    const onVote = vi.fn()
    renderCard({ onVote })
    fireEvent.click(screen.getByRole('button', { name: 'Upvote Shipped' }))
    await waitFor(() =>
      expect(onVote).toHaveBeenCalledWith('built-1', {
        up: 1,
        down: 0,
        voteScore: 1,
        myVote: 1,
      }),
    )
  })
})
