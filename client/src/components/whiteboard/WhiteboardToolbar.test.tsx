/**
 * Unit tests for the vertical whiteboard toolbar: tool selection, the
 * press-and-hold color/thickness popover, and the drag/persist mechanics
 * (shared with DeckPageHeader, so covered lightly here). jsdom does no layout,
 * so rects are stubbed like the DeckPageHeader tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import WhiteboardToolbar from './WhiteboardToolbar'
import { useWhiteboard } from './useWhiteboard'

const DECK = 'deck-1'
const key = `sm:wb-toolbar:${DECK}`
const PILL = { left: 0, top: 0, width: 44, height: 160 }

const setWindowSize = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { value: width, writable: true })
  Object.defineProperty(window, 'innerHeight', {
    value: height,
    writable: true,
  })
}

// The toolbar owns its whiteboard state; tests assert the active tool through
// the buttons' aria-pressed rather than reaching into the hook.
function Harness({ onNew = () => {} }: { onNew?: () => void }) {
  const wb = useWhiteboard()
  return (
    <WhiteboardToolbar
      deckId={DECK}
      whiteboard={wb}
      onNewWhiteboardSlide={onNew}
    />
  )
}

const pill = () => screen.getByTestId('whiteboard-toolbar')
const grip = () =>
  screen.getByRole('button', { name: 'Drag to move the whiteboard toolbar' })
const toolBtn = (name: string) => screen.getByRole('button', { name })
const isActive = (name: string) =>
  toolBtn(name).getAttribute('aria-pressed') === 'true'

beforeEach(() => {
  localStorage.clear()
  setWindowSize(1024, 768)
  vi.useFakeTimers()
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    ...PILL,
    right: PILL.width,
    bottom: PILL.height,
    x: PILL.left,
    y: PILL.top,
    toJSON: () => ({}),
  } as DOMRect)
})

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('WhiteboardToolbar', () => {
  it('selects and clears a tool on click', () => {
    render(<Harness />)
    fireEvent.click(toolBtn('Pen'))
    expect(isActive('Pen')).toBe(true)
    // Clicking again toggles it off.
    fireEvent.click(toolBtn('Pen'))
    expect(isActive('Pen')).toBe(false)
  })

  it('switches directly between tools', () => {
    render(<Harness />)
    fireEvent.click(toolBtn('Highlighter'))
    expect(isActive('Highlighter')).toBe(true)
    fireEvent.click(toolBtn('Eraser'))
    expect(isActive('Eraser')).toBe(true)
    expect(isActive('Highlighter')).toBe(false)
  })

  it('invokes the new-whiteboard-slide callback and is not a selectable tool', () => {
    const onNew = vi.fn()
    render(<Harness onNew={onNew} />)
    const btn = toolBtn('New whiteboard slide')
    // It acts, it doesn't select — no aria-pressed state.
    expect(btn).not.toHaveAttribute('aria-pressed')
    fireEvent.click(btn)
    expect(onNew).toHaveBeenCalledOnce()
  })

  it('selects the tool and opens its popover on press-and-hold', () => {
    render(<Harness />)
    const pen = toolBtn('Pen')

    // Hold past the threshold → the tool is selected AND its popover opens; the
    // trailing click must not toggle it back off.
    fireEvent.pointerDown(pen)
    act(() => vi.advanceTimersByTime(400))
    expect(
      screen.getByRole('dialog', { name: /pen color and thickness/i }),
    ).toBeVisible()
    fireEvent.pointerUp(pen)
    fireEvent.click(pen)
    expect(isActive('Pen')).toBe(true) // holding selected the pen

    // Choosing a color marks that swatch as selected.
    const swatches = screen.getAllByRole('button', { name: /^Color / })
    fireEvent.click(swatches[1]!)
    expect(swatches[1]!.getAttribute('aria-pressed')).toBe('true')
  })

  it('treats a quick press as a tool selection, no popover', () => {
    render(<Harness />)
    const pen = toolBtn('Pen')
    fireEvent.pointerDown(pen)
    act(() => vi.advanceTimersByTime(100)) // released before the hold fires
    fireEvent.pointerUp(pen)
    fireEvent.click(pen)
    expect(isActive('Pen')).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('drags by the grip and remembers the position per lecture', () => {
    render(<Harness />)
    fireEvent.pointerDown(grip(), {
      pointerId: 1,
      button: 0,
      clientX: 20,
      clientY: 20,
    })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 250 })
    fireEvent.pointerUp(window, { pointerId: 1 })
    // Grabbed at (20,20) within the pill → corner tracks the pointer offset.
    expect(pill()).toHaveStyle({ left: '280px', top: '230px' })
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ x: 280, y: 230 })
  })

  it('restores a remembered position on reload', () => {
    localStorage.setItem(key, JSON.stringify({ x: 120, y: 200 }))
    render(<Harness />)
    expect(pill()).toHaveStyle({ left: '120px', top: '200px' })
  })
})
