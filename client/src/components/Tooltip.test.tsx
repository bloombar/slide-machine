/**
 * Unit tests for the icon-control tooltip.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Tooltip from './Tooltip'

describe('Tooltip', () => {
  it('renders the label alongside the control it describes', () => {
    render(
      <Tooltip label="Add a slide">
        <button aria-label="Add slide">+</button>
      </Tooltip>,
    )
    expect(screen.getByText('Add a slide')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add slide' })).toBeVisible()
  })

  it('hides the label from assistive tech, which reads the control instead', () => {
    render(
      <Tooltip label="Add a slide">
        <button aria-label="Add slide">+</button>
      </Tooltip>,
    )
    // Otherwise the name would be announced twice, once per source
    expect(screen.getByText('Add a slide')).toHaveAttribute('aria-hidden')
  })

  it('reveals the label on hover and on keyboard arrival, but not on click', () => {
    render(
      <Tooltip label="Add a slide">
        <button aria-label="Add slide">+</button>
      </Tooltip>,
    )
    const label = screen.getByText('Add a slide')
    expect(label).toHaveClass('opacity-0')
    expect(label).toHaveClass('group-hover/tt:opacity-100')
    // focus-visible, not focus-within: a click focuses the button too, and
    // focus-within would leave the label pinned open after it. Whether the
    // CSS truly behaves is proved in e2e — jsdom does not match :focus-visible.
    expect(label).toHaveClass('group-has-[:focus-visible]/tt:opacity-100')
  })

  it('centers the label by default but anchors it to the edge when asked', () => {
    const { rerender } = render(
      <Tooltip label="Delete image">
        <button aria-label="Remove image">x</button>
      </Tooltip>,
    )
    // Default: horizontally centered on the trigger
    expect(screen.getByText('Delete image')).toHaveClass('left-1/2')

    // align="end" pins the label's right edge so it grows inward, away
    // from a right edge that would otherwise clip it
    rerender(
      <Tooltip label="Delete image" align="end">
        <button aria-label="Remove image">x</button>
      </Tooltip>,
    )
    const label = screen.getByText('Delete image')
    expect(label).toHaveClass('right-0')
    expect(label).not.toHaveClass('left-1/2')
  })
})
