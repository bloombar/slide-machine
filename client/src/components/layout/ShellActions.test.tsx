/**
 * Unit tests for the ShellActions slot: children portal into the shell's
 * slot when a provider hosts one, and render inline as a fallback without.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  ShellActionsProvider,
  ShellActions,
  useShellActionsSlot,
} from './ShellActions'

function Host() {
  const ctx = useShellActionsSlot()
  return <div data-testid="slot" ref={el => ctx?.setSlot(el)} />
}

describe('ShellActions', () => {
  it('portals children into the shell slot when a provider hosts one', () => {
    render(
      <ShellActionsProvider>
        <Host />
        <ShellActions>
          <button>Do it</button>
        </ShellActions>
      </ShellActionsProvider>,
    )
    expect(screen.getByTestId('slot')).toContainElement(
      screen.getByRole('button', { name: 'Do it' }),
    )
  })

  it('renders children inline without a provider', () => {
    render(
      <ShellActions>
        <button>Inline</button>
      </ShellActions>,
    )
    expect(screen.getByRole('button', { name: 'Inline' })).toBeInTheDocument()
  })
})
