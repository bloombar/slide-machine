/**
 * Unit tests for the Google sign-in button, which shows only when Google
 * sign-in is configured.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import GoogleSignInButton from './GoogleSignInButton'
import { takeReturnPath } from '../auth/returnPath'
import { config } from '../config'

// config is a frozen object built from import.meta.env; spy on the flag
vi.mock('../config', () => ({
  config: { apiBaseUrl: '', googleAuthEnabled: true },
}))

describe('GoogleSignInButton', () => {
  beforeEach(() => {
    ;(config as { googleAuthEnabled: boolean }).googleAuthEnabled = true
  })

  it('links to the server OAuth start route with the given action label', () => {
    render(<GoogleSignInButton action="Sign in" />)
    const link = screen.getByRole('link', { name: /sign in with google/i })
    expect(link).toHaveAttribute('href', '/api/auth/google/start')
  })

  it('uses the action verb the caller passes', () => {
    render(<GoogleSignInButton action="Sign up" />)
    expect(
      screen.getByRole('link', { name: /sign up with google/i }),
    ).toBeInTheDocument()
  })

  // The OAuth callback always lands on /app and this link takes the whole
  // tab, so the page being left has to be parked before it goes — otherwise
  // choosing Google from the sign-in dialog loses the lecture (AUTH-8).
  it('parks the page it is leaving, for the /app landing to pick up', () => {
    sessionStorage.clear()
    window.history.replaceState({}, '', '/d/shared-abc123?slide=s2')
    render(<GoogleSignInButton action="Sign in" />)
    fireEvent.click(screen.getByRole('link', { name: /sign in with google/i }))
    expect(takeReturnPath()).toBe('/d/shared-abc123?slide=s2')
  })

  it('renders nothing until Google sign-in is configured', () => {
    ;(config as { googleAuthEnabled: boolean }).googleAuthEnabled = false
    const { container } = render(<GoogleSignInButton action="Sign in" />)
    expect(container).toBeEmptyDOMElement()
  })
})
