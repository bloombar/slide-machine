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
      screen.getByRole('menuitem', { name: 'Delete slide' }),
    ).toBeInTheDocument()
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
      screen.queryByRole('menuitem', { name: 'Delete slide' }),
    ).not.toBeInTheDocument()
  })
})
