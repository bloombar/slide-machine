/**
 * Unit tests for the flattener — the step that turns what the browser drew
 * into the absolute geometry the exporters read.
 *
 * The measurements are injected, since jsdom lays nothing out. What matters
 * here is not the arithmetic but the promise it makes: whatever the browser
 * reports, the result is something the server will accept. A save refused
 * because a picture painted a pixel past its box is a save an author cannot
 * fix, or even see the cause of.
 */
import { describe, it, expect, vi } from 'vitest'
import type { Layout } from '@slide-machine/shared'
import { measureSlots } from './flatten'
import type { ThemeColors } from '../slide/theme'

const colors: ThemeColors = {
  background: '#000000',
  surface: '#111111',
  text: '#ffffff',
  muted: '#888888',
  accent: '#00ffff',
  penColor: '#000000',
  highlighterColor: '#ffff00',
  link: '#0ff',
}

const rect = (x: number, y: number, w: number, h: number): DOMRect =>
  ({
    left: x,
    top: y,
    width: w,
    height: h,
    right: x + w,
    bottom: y + h,
  }) as DOMRect

/** A canvas whose frame is 1000×562 with one slot at the given rectangle. */
const canvasWith = (box: DOMRect) => {
  const cell = document.createElement('div')
  const wrapper = document.createElement('span')
  wrapper.dataset.flipId = 'preview:title'
  cell.appendChild(wrapper)
  const canvas = document.createElement('div')
  canvas.appendChild(cell)
  document.body.appendChild(canvas)
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(
    rect(0, 0, 1000, 562),
  )
  vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue(box)
  return canvas
}

const slots: Layout['slots'] = [
  { name: 'title', kind: 'text', label: 'Slide title' },
]

describe('measuring a layout', () => {
  it('reports a box as fractions of the slide', () => {
    const out = measureSlots(
      canvasWith(rect(60, 56, 880, 100)),
      'preview',
      slots,
      colors,
    )
    expect(out.title).toMatchObject({ x: 0.06, w: 0.88 })
  })

  it('gives nothing back when the canvas has no size', () => {
    // Never on screen, or jsdom. The caller must read this as "no
    // measurement", not as "no boxes" — otherwise saving a template whose
    // tab was never opened would erase geometry the exporters rely on.
    const canvas = document.createElement('div')
    expect(measureSlots(canvas, 'preview', slots, colors)).toEqual({})
  })

  it('fits a box that the browser drew past the right edge', () => {
    // A picture can paint beyond its box. The server rejects a box running
    // off the slide, so the numbers are fitted rather than trusted.
    const out = measureSlots(
      canvasWith(rect(900, 0, 200, 100)),
      'preview',
      slots,
      colors,
    )!
    const box = out.title!
    expect(box.x + box.w).toBeLessThanOrEqual(1)
  })

  it('fits a box that starts off the slide', () => {
    const out = measureSlots(
      canvasWith(rect(-50, -20, 200, 100)),
      'preview',
      slots,
      colors,
    )
    expect(out.title).toMatchObject({ x: 0, y: 0 })
  })

  it('never reports a box too small for the schema to accept', () => {
    const out = measureSlots(
      canvasWith(rect(10, 10, 1, 1)),
      'preview',
      slots,
      colors,
    )!
    expect(out.title!.w).toBeGreaterThanOrEqual(0.01)
    expect(out.title!.h).toBeGreaterThanOrEqual(0.01)
  })

  it('keeps every box within what the geometry schema allows', () => {
    // The one promise that matters: a measurement cannot refuse a save.
    for (const r of [
      rect(0, 0, 1000, 562),
      rect(999, 561, 500, 500),
      rect(-500, -500, 3000, 3000),
    ]) {
      const box = measureSlots(canvasWith(r), 'preview', slots, colors).title!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.w).toBeGreaterThanOrEqual(0.01)
      expect(box.h).toBeGreaterThanOrEqual(0.01)
      expect(box.x + box.w).toBeLessThanOrEqual(1)
      expect(box.y + box.h).toBeLessThanOrEqual(1)
    }
  })
})
