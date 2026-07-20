/**
 * Unit tests for the deck viewer's floating, draggable toolbar.
 *
 * jsdom performs no layout, so every element would report a zero-sized
 * rect at the origin; the pill's box and the window size are stubbed to
 * fixed values, which is what makes the drag and clamping maths testable.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  type RenderResult,
} from '@testing-library/react'
import DeckPageHeader from './DeckPageHeader'

const DECK = 'deck-1'
const key = (deckId: string) => `sm:deck-toolbar:${deckId}`

const PILL = { left: 0, top: 0, width: 300, height: 46 }
const WINDOW = { width: 1024, height: 768 }

// The reachable area: inside the window, and clear of the sticky nav
// (h-14 = 56) at the top and the health footer (h-8 = 32) at the bottom,
// both of which paint over the pill
const MAX_X = WINDOW.width - PILL.width - 8
const MIN_Y = 56 + 8
const MAX_Y = WINDOW.height - 32 - PILL.height - 8

const setWindowSize = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { value: width, writable: true })
  Object.defineProperty(window, 'innerHeight', {
    value: height,
    writable: true,
  })
}

const renderToolbar = (props: Partial<{ deckId: string }> = {}): RenderResult =>
  render(<DeckPageHeader deckId={props.deckId ?? DECK} />)

const grip = () =>
  screen.getByRole('button', { name: 'Drag to move the toolbar' })
const pill = () => screen.getByTestId('deck-toolbar')
const header = (container: HTMLElement) =>
  container.querySelector('header') as HTMLElement

/**
 * Drags to a point from anywhere on the pill — by default its centre.
 * Pointer events bubble, so pressing a button inside drags too, which is
 * exactly the behaviour under test.
 */
const dragTo = (x: number, y: number, from: HTMLElement = pill()) => {
  fireEvent.pointerDown(from, {
    pointerId: 1,
    button: 0,
    clientX: PILL.width / 2,
    clientY: PILL.height / 2,
  })
  fireEvent.pointerMove(from, { pointerId: 1, clientX: x, clientY: y })
  fireEvent.pointerUp(from, { pointerId: 1 })
}

beforeEach(() => {
  localStorage.clear()
  setWindowSize(WINDOW.width, WINDOW.height)
  // jsdom implements neither pointer capture nor layout
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

afterEach(() => vi.restoreAllMocks())

describe('DeckPageHeader', () => {
  it('renders page actions', () => {
    render(
      <DeckPageHeader deckId={DECK} actions={<button>Add slide</button>} />,
    )
    expect(screen.getByRole('button', { name: 'Add slide' })).toBeVisible()
  })

  it('renders just the grip when a viewer has no actions', () => {
    renderToolbar()
    // Only the drag grip — the view toggle now lives in the header
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(grip()).toBeVisible()
  })

  // Pinning and dragging are layout behaviours; jsdom cannot lay out
  // sticky/fixed positioning, so e2e/tests/toolbar-pinned.spec.ts proves
  // they hold in a real browser. These assert the wiring underneath.
  it('pins itself below the nav until it is dragged', () => {
    const { container } = renderToolbar()
    expect(header(container)).toHaveClass('sticky', 'top-16', 'z-30')
    expect(pill()).not.toHaveClass('fixed')
  })

  it('floats the pill at the dropped point and holds its row open', () => {
    const { container } = renderToolbar()
    dragTo(400, 300)

    // Grabbed at the pill's centre, so the corner lands offset by that much
    expect(pill()).toHaveClass('fixed')
    expect(pill()).toHaveStyle({ left: '250px', top: '277px' })
    // The vacated row keeps its height, so the slides do not jump up
    expect(header(container)).toHaveStyle({ height: '46px' })
    expect(header(container)).not.toHaveClass('sticky')
  })

  it('keeps following the pointer for the rest of a drag', () => {
    renderToolbar()
    fireEvent.pointerDown(pill(), {
      pointerId: 1,
      button: 0,
      clientX: 150,
      clientY: 23,
    })
    // First move crosses the threshold and starts the drag
    fireEvent.pointerMove(pill(), { pointerId: 1, clientX: 400, clientY: 300 })
    expect(pill()).toHaveStyle({ left: '250px', top: '277px' })

    // Every move after just tracks — a real drag is dozens of these
    fireEvent.pointerMove(pill(), { pointerId: 1, clientX: 500, clientY: 400 })
    expect(pill()).toHaveStyle({ left: '350px', top: '377px' })
    fireEvent.pointerUp(pill(), { pointerId: 1 })
  })

  it('drags from a button without firing it', () => {
    const onAdd = vi.fn()
    render(
      <DeckPageHeader
        deckId={DECK}
        actions={<button onClick={onAdd}>Add slide</button>}
      />,
    )
    const button = screen.getByRole('button', { name: 'Add slide' })
    dragTo(400, 300, button)
    // A real browser fires click after pointerup; it must be swallowed
    fireEvent.click(button)

    expect(pill()).toHaveStyle({ left: '250px', top: '277px' })
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('still clicks a button when the press barely moves', () => {
    const onAdd = vi.fn()
    render(
      <DeckPageHeader
        deckId={DECK}
        actions={<button onClick={onAdd}>Add slide</button>}
      />,
    )
    const button = screen.getByRole('button', { name: 'Add slide' })
    // Under the 4px threshold: a shaky click is still a click
    fireEvent.pointerDown(button, {
      pointerId: 1,
      button: 0,
      clientX: 150,
      clientY: 23,
    })
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 152, clientY: 24 })
    fireEvent.pointerUp(button, { pointerId: 1 })
    fireEvent.click(button)

    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(pill()).not.toHaveClass('fixed')
  })

  it('ignores a non-primary button press', () => {
    renderToolbar()
    // Right-click must not drag the toolbar away
    fireEvent.pointerDown(pill(), {
      pointerId: 1,
      button: 2,
      clientX: 150,
      clientY: 23,
    })
    fireEvent.pointerMove(pill(), { pointerId: 1, clientX: 400, clientY: 300 })
    expect(pill()).not.toHaveClass('fixed')
  })

  it('clamps a drag past the edge back inside the window', () => {
    renderToolbar()
    dragTo(5000, 5000)
    expect(pill()).toHaveStyle({ left: `${MAX_X}px`, top: `${MAX_Y}px` })
  })

  it('will not let the pill be dragged behind the nav', () => {
    renderToolbar()
    dragTo(400, -500)
    // Stops at the nav's lower edge — exactly where it parks
    expect(pill()).toHaveStyle({ top: `${MIN_Y}px` })
  })

  it('will not let the pill be dragged behind the health footer', () => {
    renderToolbar()
    dragTo(400, 5000)
    // The footer owns the last 32px, so the pill stops short of it
    expect(pill()).toHaveStyle({ top: `${MAX_Y}px` })
    expect(MAX_Y + PILL.height).toBeLessThanOrEqual(WINDOW.height - 32)
  })

  it('ignores pointer movement that is not part of a drag', () => {
    renderToolbar()
    fireEvent.pointerMove(grip(), { pointerId: 1, clientX: 400, clientY: 300 })
    expect(pill()).not.toHaveClass('fixed')
  })

  it('nudges the pill with the arrow keys', () => {
    renderToolbar()
    fireEvent.keyDown(grip(), { key: 'ArrowRight' })
    // One 16px step right; vertically it cannot rise above the nav
    expect(pill()).toHaveStyle({ left: '16px', top: `${MIN_Y}px` })

    fireEvent.keyDown(grip(), { key: 'ArrowDown' })
    expect(pill()).toHaveStyle({ left: '16px', top: `${MIN_Y + 16}px` })

    fireEvent.keyDown(grip(), { key: 'ArrowLeft' })
    fireEvent.keyDown(grip(), { key: 'ArrowUp' })
    expect(pill()).toHaveStyle({ left: '8px', top: `${MIN_Y}px` })
  })

  it('leaves unrelated keys alone', () => {
    renderToolbar()
    fireEvent.keyDown(grip(), { key: 'a' })
    expect(pill()).not.toHaveClass('fixed')
  })

  it('parks the pill back under the nav on Escape', () => {
    const { container } = renderToolbar()
    dragTo(400, 300)
    expect(pill()).toHaveClass('fixed')

    fireEvent.keyDown(grip(), { key: 'Escape' })
    expect(pill()).not.toHaveClass('fixed')
    expect(header(container)).toHaveClass('sticky', 'top-16')
  })

  it('re-clamps a floating pill when the window shrinks', () => {
    renderToolbar()
    dragTo(700, 600)
    expect(pill()).toHaveStyle({ left: '550px' })

    setWindowSize(400, 300)
    fireEvent(window, new Event('resize'))

    // 400 - 300 - 8 = 92 across; 300 - 32 - 46 - 8 = 214 down
    expect(pill()).toHaveStyle({ left: '92px', top: '214px' })
  })

  it('stops listening for resizes once parked again', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    renderToolbar()
    dragTo(400, 300)
    fireEvent.keyDown(grip(), { key: 'Escape' })
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function))
  })

  describe('remembering the position per lecture', () => {
    it('stores where the pill was dropped', () => {
      renderToolbar()
      dragTo(400, 300)
      expect(JSON.parse(localStorage.getItem(key(DECK))!)).toEqual({
        x: 250,
        y: 277,
      })
    })

    it('restores the remembered position on reload', () => {
      localStorage.setItem(key(DECK), JSON.stringify({ x: 120, y: 340 }))
      renderToolbar()
      expect(pill()).toHaveClass('fixed')
      expect(pill()).toHaveStyle({ left: '120px', top: '340px' })
    })

    it('starts a different lecture pinned, ignoring another lecture', () => {
      localStorage.setItem(key(DECK), JSON.stringify({ x: 120, y: 340 }))
      renderToolbar({ deckId: 'deck-2' })
      expect(pill()).not.toHaveClass('fixed')
    })

    it('forgets the position once the pill is parked again', () => {
      renderToolbar()
      dragTo(400, 300)
      expect(localStorage.getItem(key(DECK))).not.toBeNull()

      fireEvent.keyDown(grip(), { key: 'Escape' })
      expect(localStorage.getItem(key(DECK))).toBeNull()
    })

    it('re-fits a remembered position that no longer suits the window', () => {
      localStorage.setItem(key(DECK), JSON.stringify({ x: 900, y: 700 }))
      setWindowSize(400, 300)
      renderToolbar()
      // Clamped before first paint: 400-300-8 across, 300-32-46-8 down
      expect(pill()).toHaveStyle({ left: '92px', top: '214px' })
    })

    it('rescues a remembered position stuck behind the nav', () => {
      // The regression: a position stored before the nav band was excluded
      // would restore the pill under the header, hidden and unreachable on
      // every reload. Restoring must re-clamp it into view.
      localStorage.setItem(key(DECK), JSON.stringify({ x: 300, y: 0 }))
      renderToolbar()
      expect(pill()).toHaveStyle({ left: '300px', top: `${MIN_Y}px` })
    })

    it('starts pinned when the stored entry is unusable', () => {
      localStorage.setItem(key(DECK), 'not json at all')
      renderToolbar()
      expect(pill()).not.toHaveClass('fixed')
    })

    it('starts pinned when the stored entry has the wrong shape', () => {
      localStorage.setItem(key(DECK), JSON.stringify({ x: 'left', y: null }))
      renderToolbar()
      expect(pill()).not.toHaveClass('fixed')
    })

    it('still drags when storage is unavailable', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('private browsing')
      })
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('private browsing')
      })
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('private browsing')
      })
      renderToolbar()
      dragTo(400, 300)
      // The position is simply not remembered; the pill still moves
      expect(pill()).toHaveStyle({ left: '250px', top: '277px' })
    })
  })
})
