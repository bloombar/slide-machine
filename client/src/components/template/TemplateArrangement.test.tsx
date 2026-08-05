/**
 * Unit tests for arranging a layout (TMPL-4). Boxes are stored as fractions
 * of the slide, 0-1 (docs/TEMPLATES.md §4), and only the label a person reads
 * is in percent. Both routes to moving a box — pointer and keyboard — write
 * the same numbers, so both are covered here.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ElementPositions, Layout } from '@slide-machine/shared'
import TemplateArrangement from './TemplateArrangement'

const layout = (positions?: ElementPositions): Layout =>
  ({
    type: 'content',
    label: 'Content',
    purpose: 'body text',
    slots: [
      { name: 'title', kind: 'text', label: 'Slide title' },
      { name: 'body', kind: 'text', label: 'Slide body', multiline: true },
    ],
    elementPositions: positions ?? {},
  }) as Layout

const arranged: ElementPositions = {
  title: { x: 0.1, y: 0.1, w: 0.5, h: 0.2 },
  body: { x: 0.1, y: 0.4, w: 0.5, h: 0.4 },
}

const renderIt = (positions?: ElementPositions) => {
  const onChange = vi.fn()
  render(<TemplateArrangement layout={layout(positions)} onChange={onChange} />)
  return onChange
}

/** The box the last change put at `name`. */
const changedBox = (onChange: ReturnType<typeof vi.fn>, name: string) =>
  (onChange.mock.calls.at(-1)![0] as ElementPositions)[name]!

describe('an unarranged layout', () => {
  it('keeps its hand-tuned component until someone opts in', () => {
    renderIt()
    expect(
      screen.getByRole('button', { name: 'Arrange this layout' }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText(/^title:/)).toBeNull()
  })

  it('seeds a box per slot, inside the slide', () => {
    const onChange = renderIt()
    fireEvent.click(screen.getByRole('button', { name: 'Arrange this layout' }))
    const seeded = onChange.mock.calls[0]![0] as ElementPositions
    expect(Object.keys(seeded)).toEqual(['title', 'body'])
    for (const box of Object.values(seeded)) {
      // Fractions, and every side within the slide
      expect(box.w).toBeLessThanOrEqual(1)
      expect(box.x + box.w).toBeLessThanOrEqual(1)
      expect(box.y + box.h).toBeLessThanOrEqual(1)
    }
  })

  it('has nothing to arrange when the layout has no slots', () => {
    render(
      <TemplateArrangement
        layout={{ ...layout(), slots: [] } as Layout}
        onChange={vi.fn()}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Arrange this layout' }),
    ).toBeDisabled()
  })
})

describe('an arranged layout', () => {
  it('labels each box with where it sits, in percent', () => {
    renderIt(arranged)
    expect(screen.getByLabelText(/^title:/)).toHaveAttribute(
      'aria-label',
      'title: 10% from the left, 10% down, 50% wide, 20% tall',
    )
  })

  it('moves the focused box with an arrow key', () => {
    const onChange = renderIt(arranged)
    fireEvent.keyDown(screen.getByLabelText(/^title:/), { key: 'ArrowRight' })
    expect(changedBox(onChange, 'title').x).toBeCloseTo(0.12)
  })

  it('resizes it when shift is held', () => {
    const onChange = renderIt(arranged)
    fireEvent.keyDown(screen.getByLabelText(/^title:/), {
      key: 'ArrowDown',
      shiftKey: true,
    })
    expect(changedBox(onChange, 'title').h).toBeCloseTo(0.22)
  })

  it('keeps a box inside the slide', () => {
    const onChange = renderIt({ title: { x: 0, y: 0, w: 0.5, h: 0.2 } })
    fireEvent.keyDown(screen.getByLabelText(/^title:/), { key: 'ArrowLeft' })
    expect(changedBox(onChange, 'title').x).toBe(0)
  })

  it('keeps a box big enough to grab', () => {
    const onChange = renderIt({ title: { x: 0, y: 0, w: 0.05, h: 0.05 } })
    fireEvent.keyDown(screen.getByLabelText(/^title:/), {
      key: 'ArrowLeft',
      shiftKey: true,
    })
    expect(changedBox(onChange, 'title').w).toBe(0.05)
  })

  it('keeps the styling a box already carries when it is moved', () => {
    const onChange = renderIt({
      title: { x: 0.1, y: 0.1, w: 0.5, h: 0.2, align: 'center', fontSize: 8 },
    })
    fireEvent.keyDown(screen.getByLabelText(/^title:/), { key: 'ArrowDown' })
    expect(changedBox(onChange, 'title')).toMatchObject({
      align: 'center',
      fontSize: 8,
    })
  })

  it('ignores a key that is not an arrow', () => {
    const onChange = renderIt(arranged)
    fireEvent.keyDown(screen.getByLabelText(/^title:/), { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('hands the layout back to its hand-tuned component', () => {
    const onChange = renderIt(arranged)
    fireEvent.click(
      screen.getByRole('button', { name: 'Use the built-in arrangement' }),
    )
    expect(onChange).toHaveBeenCalledWith({})
  })

  it('drags a box to where the pointer went', () => {
    const onChange = renderIt(arranged)
    const box = screen.getByLabelText(/^title:/)
    // jsdom has no layout, so give the canvas a size to measure against
    const canvas = box.parentElement!
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 1000,
      height: 500,
    } as DOMRect)
    // Grab the box at its top-left, then move 100px right and 50px down
    fireEvent.pointerDown(box, { clientX: 100, clientY: 50 })
    fireEvent(
      window,
      new PointerEvent('pointermove', { clientX: 200, clientY: 100 }),
    )
    fireEvent(window, new PointerEvent('pointerup'))
    expect(changedBox(onChange, 'title').x).toBeCloseTo(0.2)
    expect(changedBox(onChange, 'title').y).toBeCloseTo(0.2)
  })
})
