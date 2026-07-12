/**
 * Unit tests for the slot system: the registry mounts the right editor
 * for each media kind, descriptors drive labels, and every editor
 * produces a patch keyed by its slide field.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { LayoutSlot, Slide } from '@slide-machine/shared'
import SlideSlot from './slots'
import type { ThemeColors } from './theme'

const colors: ThemeColors = {
  background: '#000',
  surface: '#111',
  text: '#fff',
  muted: '#888',
  accent: '#0ff',
}

const slide = (overrides: Partial<Slide>): Slide => ({
  id: 's1',
  deckId: 'd1',
  index: 0,
  layoutType: 'content',
  ...overrides,
})

describe('SlideSlot', () => {
  it('renders text slots read-only without an edit handler', () => {
    render(
      <SlideSlot
        slot="title"
        slide={slide({ title: 'Osmosis' })}
        colors={colors}
      />,
    )
    expect(screen.getByText('Osmosis')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('mounts an editor labeled by the slot descriptor and patches its field', () => {
    vi.useFakeTimers()
    const onEdit = vi.fn()
    render(
      <SlideSlot
        slot="caption"
        slide={slide({ caption: 'A cell' })}
        colors={colors}
        onEdit={onEdit}
      />,
    )
    fireEvent.click(screen.getByTitle('Click to edit Slide caption'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Slide caption' }), {
      target: { value: 'A plant cell' },
    })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Slide caption' }), {
      key: 'Enter',
    })
    vi.runAllTimers()
    expect(onEdit).toHaveBeenCalledWith({ caption: 'A plant cell' })
    vi.useRealTimers()
  })

  it('edits bullets as a whole and patches them as an array', () => {
    vi.useFakeTimers()
    const onEdit = vi.fn()
    render(
      <SlideSlot
        slot="bullets"
        slide={slide({ bullets: ['sun', 'water'] })}
        colors={colors}
        onEdit={onEdit}
      />,
    )
    fireEvent.click(screen.getByTitle('Click to edit Slide bullets'))
    const box = screen.getByRole('textbox', { name: 'Slide bullets' })
    fireEvent.change(box, { target: { value: 'sun\nwater\nCO2' } })
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    vi.runAllTimers()
    expect(onEdit).toHaveBeenCalledWith({ bullets: ['sun', 'water', 'CO2'] })
    vi.useRealTimers()
  })

  it('keeps image slots reserved: skeleton while pending, quiet block after', () => {
    const { rerender } = render(
      <SlideSlot slot="image" slide={slide({})} colors={colors} imagePending />,
    )
    expect(screen.getByTestId('image-skeleton')).toBeInTheDocument()
    rerender(<SlideSlot slot="image" slide={slide({})} colors={colors} />)
    expect(screen.getByTestId('image-fallback')).toBeInTheDocument()
  })

  it("lets the template's slot spec override the conventional defaults", () => {
    render(
      <SlideSlot
        slot="title"
        spec={{ name: 'title', kind: 'text', label: 'Headline' }}
        slide={slide({ title: 'Osmosis' })}
        colors={colors}
        onEdit={vi.fn()}
      />,
    )
    // The template-declared label reaches the editor affordances
    expect(screen.getByTitle('Click to edit Headline')).toBeInTheDocument()
  })

  it('renders nothing for a slot without a descriptor', () => {
    const { container } = render(
      <SlideSlot
        slot={'hologram' as LayoutSlot}
        slide={slide({})}
        colors={colors}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
