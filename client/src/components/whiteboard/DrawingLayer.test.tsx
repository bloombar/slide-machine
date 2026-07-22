/**
 * Unit tests for the drawing overlay: a draw gesture commits a normalized
 * stroke to the slide under it, the eraser stamps a stroke as a timestamped
 * event (rather than deleting it), and the canvas only takes pointer events
 * when a tool is active. jsdom does no layout and has no 2D canvas context, so
 * rects are stubbed and rendering is a no-op — behavior, not pixels, is tested.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import type { Stroke, StrokeAnchor } from '@slide-machine/shared'
import DrawingLayer from './DrawingLayer'

const BOX = { left: 0, top: 0, width: 200, height: 200 }
const anchor: StrokeAnchor = { charAnchor: 5, source: 'appended' }
const buildAnchor = vi.fn((): StrokeAnchor => anchor)

const existing = (over: Partial<Stroke> = {}): Stroke => ({
  id: 'e1',
  tool: 'pen',
  color: '#000000',
  thickness: 0.05,
  points: [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
  ],
  startedAt: '2026-07-21T10:00:00.000Z',
  endedAt: '2026-07-21T10:00:01.000Z',
  anchor,
  ...over,
})

// Renders the overlay under a positioned container holding one slide box, the
// way the page mounts it.
const setup = (
  props: Partial<React.ComponentProps<typeof DrawingLayer>> = {},
) => {
  const onCommitStroke = vi.fn()
  const onEraseStroke = vi.fn()
  const result = render(
    <div style={{ position: 'relative' }}>
      <div data-slide-id="s1" />
      <DrawingLayer
        tool={null}
        penStyle={{ color: '#111111', thickness: 0.01 }}
        highlighterStyle={{ color: '#fde047', thickness: 0.03 }}
        strokesById={{}}
        buildAnchor={buildAnchor}
        onCommitStroke={onCommitStroke}
        onEraseStroke={onEraseStroke}
        {...props}
      />
    </div>,
  )
  const canvas = result.getByTestId('drawing-layer') as HTMLCanvasElement
  return { ...result, canvas, onCommitStroke, onEraseStroke }
}

beforeEach(() => {
  vi.clearAllMocks()
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  // jsdom has no 2D canvas; a no-op context lets redraw run (and stays quiet).
  const ctx = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    globalAlpha: 1,
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineCap: '',
    lineJoin: '',
  }
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ctx,
  ) as unknown as HTMLCanvasElement['getContext']
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    ...BOX,
    right: BOX.width,
    bottom: BOX.height,
    x: BOX.left,
    y: BOX.top,
    toJSON: () => ({}),
  } as DOMRect)
})

afterEach(() => vi.restoreAllMocks())

describe('DrawingLayer', () => {
  it('is transparent to clicks with no active tool, interactive with one', () => {
    const { canvas, rerender } = setup()
    expect(canvas).toHaveClass('pointer-events-none')
    rerender(
      <div style={{ position: 'relative' }}>
        <div data-slide-id="s1" />
        <DrawingLayer
          tool="pen"
          penStyle={{ color: '#111111', thickness: 0.01 }}
          highlighterStyle={{ color: '#fde047', thickness: 0.03 }}
          strokesById={{}}
          buildAnchor={buildAnchor}
          onCommitStroke={vi.fn()}
          onEraseStroke={vi.fn()}
        />
      </div>,
    )
    expect(canvas).toHaveClass('pointer-events-auto', 'cursor-crosshair')
  })

  it('commits a normalized stroke to the slide under the gesture', () => {
    const { canvas, onCommitStroke } = setup({ tool: 'pen' })
    fireEvent.pointerDown(canvas, {
      pointerId: 1,
      button: 0,
      clientX: 20,
      clientY: 40,
    })
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 100, clientY: 40 })
    fireEvent.pointerUp(canvas, { pointerId: 1 })

    expect(onCommitStroke).toHaveBeenCalledTimes(1)
    const [slideId, stroke] = onCommitStroke.mock.calls[0]!
    expect(slideId).toBe('s1')
    expect(stroke.tool).toBe('pen')
    // Points normalized 0..1 to the 200x200 box.
    expect(stroke.points[0]).toEqual({ x: 0.1, y: 0.2 })
    expect(stroke.points[1]).toEqual({ x: 0.5, y: 0.2 })
    expect(stroke.anchor).toBe(anchor)
    expect(buildAnchor).toHaveBeenCalledWith('s1', expect.any(Number))
  })

  it('erases a whole stroke as a timestamped event (does not delete)', () => {
    const { canvas, onEraseStroke, onCommitStroke } = setup({
      tool: 'eraser',
      strokesById: { s1: [existing()] },
    })
    // The stroke runs along y=0.1 (client y=20); press on it.
    fireEvent.pointerDown(canvas, {
      pointerId: 1,
      button: 0,
      clientX: 100,
      clientY: 20,
    })
    fireEvent.pointerUp(canvas, { pointerId: 1 })

    expect(onCommitStroke).not.toHaveBeenCalled()
    expect(onEraseStroke).toHaveBeenCalledTimes(1)
    expect(onEraseStroke).toHaveBeenCalledWith('s1', 'e1', anchor)
  })

  it('does not erase when the eraser misses every stroke', () => {
    const { canvas, onEraseStroke } = setup({
      tool: 'eraser',
      strokesById: { s1: [existing()] },
    })
    // Far from the y=20 line.
    fireEvent.pointerDown(canvas, {
      pointerId: 1,
      button: 0,
      clientX: 100,
      clientY: 180,
    })
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    expect(onEraseStroke).not.toHaveBeenCalled()
  })

  it('ignores an already-erased stroke', () => {
    const { canvas, onEraseStroke } = setup({
      tool: 'eraser',
      strokesById: { s1: [existing({ erasedAnchor: anchor })] },
    })
    fireEvent.pointerDown(canvas, {
      pointerId: 1,
      button: 0,
      clientX: 100,
      clientY: 20,
    })
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    expect(onEraseStroke).not.toHaveBeenCalled()
  })
})
