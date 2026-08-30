/**
 * Unit tests for the per-slide layout picker (EDIT-3): a layout is chosen by
 * looking at a miniature of it in the deck's own template, the way a template
 * is chosen in the Design tab, with its name and purpose under the picture.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Layout, Template } from '@slide-machine/shared'
import LayoutPickerModal from './LayoutPickerModal'

/**
 * A layout whose slots are positioned, so the data-driven renderer draws
 * every one of them: a layout with no positions is drawn by its hand-tuned
 * component, which knows only its own slots, and a distinctly named slot
 * would never appear on the card.
 */
const layout = (type: string, label: string, slots: string[]): Layout =>
  ({
    type,
    label,
    purpose: `use for ${type}`,
    slots: slots.map(name => ({ name, kind: 'text', label: name })),
    elementPositions: Object.fromEntries(
      slots.map((name, i) => [
        name,
        { x: 0.1, y: 0.1 + i * 0.2, w: 0.8, h: 0.15 },
      ]),
    ),
  }) as Layout

const template: Template = {
  id: 'built-1',
  permalinkSlug: 'built-1',
  ownerId: 'system',
  name: 'Shipped',
  theme: { background: '#ffffff', text: '#000000', accent: '#ff0000' },
  layouts: [
    layout('content', 'Content', ['title', 'contentMark']),
    layout('list', 'List', ['listMark']),
  ],
  visibility: 'public',
  voteScore: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
}

const setup = (
  props: Partial<Parameters<typeof LayoutPickerModal>[0]> = {},
) => {
  const onPick = vi.fn()
  const onClose = vi.fn()
  render(
    <LayoutPickerModal
      template={template}
      current="content"
      onPick={onPick}
      onClose={onClose}
      onChangeTemplate={vi.fn()}
      {...props}
    />,
  )
  return { onPick, onClose }
}

describe('LayoutPickerModal (EDIT-3)', () => {
  it('shows a preview of every layout, not just its name', () => {
    setup()
    expect(screen.getAllByTestId('layout-preview')).toHaveLength(2)
  })

  it('previews each layout as itself, in the deck’s template', () => {
    setup()
    // Read off the drawn slide rather than off the card's label: a preview
    // that showed the same layout twice would still carry both names.
    expect(screen.getByText('contentMark')).toBeInTheDocument()
    expect(screen.getByText('listMark')).toBeInTheDocument()
    const [first] = screen.getAllByTestId('layout-preview')
    expect(first).toHaveStyle({ backgroundColor: '#ffffff' })
  })

  it('keeps the name and the purpose under the picture', () => {
    setup()
    expect(screen.getByText('List')).toBeInTheDocument()
    expect(screen.getByText('use for list')).toBeInTheDocument()
  })

  it('still names each choice by its layout, the preview being decoration', () => {
    // The e2e suites pick a layout by this name; a preview that announced
    // itself would bury it.
    setup()
    expect(screen.getByRole('radio', { name: /List/ })).toHaveAccessibleName(
      /^List\s*use for list$/,
    )
  })

  it('frames the slide rather than the card', () => {
    // A wall of slides should read as slides: no tile around the picture and
    // its words, a hairline on the picture itself, and the picture lifts
    // under the pointer — which the frame used to do with a border colour.
    setup()
    const card = screen.getByRole('radio', { name: /List/ })
    expect(card.className).not.toMatch(/border/)
    const frame = screen.getAllByTestId('layout-preview')[1]!.parentElement!
    expect(frame).toHaveClass('border', 'border-slate-200')
    expect(frame).toHaveClass('group-hover:shadow-lg')
  })

  it('rings the chosen slide instead of resizing it', () => {
    // A ring paints outside the box, so picking one does not shuffle the row.
    setup()
    const frame = screen.getAllByTestId('layout-preview')[0]!.parentElement!
    expect(frame).toHaveClass('ring-1', 'ring-indigo-600')
  })

  it('marks the slide’s current layout as checked', () => {
    setup()
    expect(screen.getByRole('radio', { name: /Content/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('picks a layout by clicking its card', () => {
    const { onPick } = setup()
    fireEvent.click(screen.getByRole('radio', { name: /List/ }))
    expect(onPick).toHaveBeenCalledWith('list')
  })
})
