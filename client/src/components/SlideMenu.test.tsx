/**
 * Unit tests for the per-slide kebab: it shows only the actions it's given,
 * and renders nothing at all (no icon) when it has none — so a read-only
 * viewer with TTS disabled sees no menu.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SlideMenu from './SlideMenu'

const openMenu = (number: number) =>
  fireEvent.click(
    screen.getByRole('button', { name: `Options for slide ${number}` }),
  )

describe('SlideMenu', () => {
  it('renders nothing when given no actions', () => {
    const { container } = render(<SlideMenu number={1} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('fires onSpeak from the "Speak this slide" item', () => {
    const onSpeak = vi.fn()
    render(<SlideMenu number={1} onSpeak={onSpeak} />)
    openMenu(1)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Speak this slide' }))
    expect(onSpeak).toHaveBeenCalledOnce()
  })

  it('shows every item for an editor with TTS on', () => {
    render(
      <SlideMenu
        number={2}
        onSpeak={vi.fn()}
        onChangeLayout={vi.fn()}
        onDuplicate={vi.fn()}
        onEditTranscript={vi.fn()}
        onRefine={vi.fn()}
        onPlayOriginalAudio={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    openMenu(2)
    expect(
      screen.getByRole('menuitem', { name: 'Speak this slide' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: 'Change layout' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: 'Duplicate slide' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: 'Edit spoken transcript' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: 'Refine this slide with AI' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: 'Play original audio' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: 'Delete slide' }),
    ).toBeInTheDocument()
    // Grouped by what they act on: what the slide says, then how it is
    // improved or edited.
    expect(screen.getAllByRole('menuitem').map(i => i.textContent)).toEqual([
      'Speak this slide',
      'Play original audio',
      'Refine this slide with AI',
      'Edit spoken transcript',
      'Change layout',
      'Duplicate slide',
      'Delete slide',
    ])
  })

  it('fires onDuplicate from the "Duplicate slide" item', () => {
    const onDuplicate = vi.fn()
    render(<SlideMenu number={1} onDuplicate={onDuplicate} />)
    openMenu(1)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate slide' }))
    expect(onDuplicate).toHaveBeenCalledOnce()
  })

  it('fires onRefine from the "Refine this slide" item', () => {
    const onRefine = vi.fn()
    render(<SlideMenu number={1} onRefine={onRefine} />)
    openMenu(1)
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Refine this slide with AI' }),
    )
    expect(onRefine).toHaveBeenCalledOnce()
  })

  it('fires onEditTranscript from the "Edit spoken transcript" item', () => {
    const onEditTranscript = vi.fn()
    render(<SlideMenu number={1} onEditTranscript={onEditTranscript} />)
    openMenu(1)
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Edit spoken transcript' }),
    )
    expect(onEditTranscript).toHaveBeenCalledOnce()
  })

  it('fires onPlayOriginalAudio, and omits the item when unavailable', () => {
    const onPlayOriginalAudio = vi.fn()
    const { rerender } = render(
      <SlideMenu number={1} onPlayOriginalAudio={onPlayOriginalAudio} />,
    )
    openMenu(1)
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Play original audio' }),
    )
    expect(onPlayOriginalAudio).toHaveBeenCalledOnce()

    // Without the callback (no retained audio), the item is not rendered.
    rerender(<SlideMenu number={1} onSpeak={vi.fn()} />)
    openMenu(1)
    expect(
      screen.queryByRole('menuitem', { name: 'Play original audio' }),
    ).not.toBeInTheDocument()
  })

  it('gives a read-only viewer only the speak item', () => {
    render(<SlideMenu number={3} onSpeak={vi.fn()} />)
    openMenu(3)
    expect(
      screen.getByRole('menuitem', { name: 'Speak this slide' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'Change layout' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'Duplicate slide' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'Edit spoken transcript' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'Delete slide' }),
    ).not.toBeInTheDocument()
  })

  // The open menu must clear the whiteboard drawing overlay (z-20); otherwise
  // strokes on the slide would render over it.
  it('rises above the drawing overlay while its menu is open', () => {
    render(<SlideMenu number={1} onDelete={vi.fn()} />)
    const wrapper = screen
      .getByRole('button', { name: 'Options for slide 1' })
      .closest('div')!
    // Closed and no active tool: sits in the base (z-10) tier.
    expect(wrapper.className).toContain('z-10')
    expect(wrapper.className).not.toContain('z-30')
    // Opening lifts the whole kebab above the drawing canvas (z-30 > z-20).
    openMenu(1)
    expect(wrapper.className).toContain('z-30')
  })

  it('stays elevated while a drawing tool is active', () => {
    render(<SlideMenu number={1} onDelete={vi.fn()} elevated />)
    const wrapper = screen
      .getByRole('button', { name: 'Options for slide 1' })
      .closest('div')!
    expect(wrapper.className).toContain('z-30')
  })
})
