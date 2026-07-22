/**
 * Unit tests for the reusable bottom-center notification pill.
 */
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import NotificationPill from './NotificationPill'

describe('NotificationPill', () => {
  it('renders its message as a neutral status by default', () => {
    render(<NotificationPill>Refining this slide…</NotificationPill>)
    const pill = screen.getByRole('status')
    expect(pill).toHaveTextContent('Refining this slide…')
    expect(pill.className).toContain('bg-slate-800')
  })

  it('uses the error tone and alert role when asked', () => {
    render(
      <NotificationPill tone="error" role="alert">
        Something went wrong
      </NotificationPill>,
    )
    const pill = screen.getByRole('alert')
    expect(pill.className).toContain('bg-red-600')
  })

  it('renders an action button that fires its handler', () => {
    const onClick = vi.fn()
    render(
      <NotificationPill action={{ label: 'Resume', onClick }}>
        Content generation paused
      </NotificationPill>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('applies the action ariaLabel when the label is a glyph', () => {
    render(
      <NotificationPill
        action={{ label: '✕', ariaLabel: 'Dismiss', onClick: () => {} }}
      >
        Upload failed
      </NotificationPill>,
    )
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
  })

  it('omits the button when no action is given', () => {
    render(<NotificationPill>Playing original audio…</NotificationPill>)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
