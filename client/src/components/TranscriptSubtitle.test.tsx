/**
 * Unit tests for the reusable one-line transcript subtitle.
 *
 * jsdom does not run a real layout engine, so it cannot confirm that text
 * visually clips at the front rather than the back — that is a rendering
 * fact, not a DOM fact. What these tests check instead: the box's height is
 * a fixed, content-independent value (never "auto", never dependent on
 * `text`), and the front-clipping technique (rtl direction + nowrap +
 * hidden overflow) is applied with the full phrase still present in the DOM
 * — i.e. the tail is not lost, only visually cropped.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import TranscriptSubtitle from './TranscriptSubtitle'

describe('TranscriptSubtitle', () => {
  it('renders the given text', () => {
    render(<TranscriptSubtitle text="the mitochondria is the powerhouse" />)
    expect(
      screen.getByText('the mitochondria is the powerhouse'),
    ).toBeInTheDocument()
  })

  it('keeps its box mounted with an empty textContent when text is empty', () => {
    render(<TranscriptSubtitle text="" testId="subtitle" />)
    const box = screen.getByTestId('subtitle')
    expect(box).toBeInTheDocument()
    expect(box).toHaveTextContent('')
  })

  it('reserves a fixed height regardless of content length', () => {
    const { rerender } = render(
      <TranscriptSubtitle text="" testId="subtitle" />,
    )
    const box = screen.getByTestId('subtitle')
    const emptyHeight = box.style.height
    expect(emptyHeight).not.toBe('')

    rerender(<TranscriptSubtitle text="one" testId="subtitle" />)
    expect(box.style.height).toBe(emptyHeight)

    rerender(
      <TranscriptSubtitle
        text="the krebs cycle turns acetyl coa into energy carriers like nadh and fadh2"
        testId="subtitle"
      />,
    )
    expect(box.style.height).toBe(emptyHeight)
  })

  it('never wraps and clips overflow from the front, keeping the tail readable', () => {
    const longPhrase =
      'the krebs cycle turns acetyl coa into energy carriers like nadh and fadh2'
    render(<TranscriptSubtitle text={longPhrase} testId="subtitle" />)
    const box = screen.getByTestId('subtitle')
    // The full phrase stays in the DOM — nothing is sliced off — so the
    // browser is the one doing the cropping, not this component.
    expect(box).toHaveTextContent(longPhrase)
    // The technique: rtl direction anchors the box to its trailing edge and
    // never lets the line wrap, so overflow is cropped off the front.
    expect(box.style.whiteSpace).toBe('nowrap')
    expect(box.style.direction).toBe('rtl')
    expect(box.className).toContain('overflow-hidden')
  })

  it('keeps the existing aria-live announcement and muted italic styling', () => {
    render(<TranscriptSubtitle text="hello" testId="subtitle" />)
    const box = screen.getByTestId('subtitle')
    expect(box).toHaveAttribute('aria-live', 'polite')
    expect(box.className).toContain('italic')
    expect(box.className).toContain('text-slate-400')
  })

  it('merges caller-supplied className without dropping the base styling', () => {
    render(
      <TranscriptSubtitle text="hello" className="extra-class" testId="s" />,
    )
    const box = screen.getByTestId('s')
    expect(box.className).toContain('extra-class')
    expect(box.className).toContain('italic')
  })
})
