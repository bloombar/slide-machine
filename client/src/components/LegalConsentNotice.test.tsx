/**
 * Unit tests for the consent notice under the auth forms: both wordings
 * render, and each links the document it names.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import LegalConsentNotice from './LegalConsentNotice'

const renderNotice = (action: 'register' | 'signIn') =>
  render(
    <MemoryRouter>
      <LegalConsentNotice action={action} />
    </MemoryRouter>,
  )

afterEach(cleanup)

describe('LegalConsentNotice', () => {
  it('names both documents when creating an account', () => {
    renderNotice('register')
    expect(document.body.textContent).toContain('By creating an account')
    expect(
      screen.getByRole('link', { name: 'Terms & conditions' }),
    ).toHaveAttribute('href', '/terms')
    expect(
      screen.getByRole('link', { name: 'Privacy policy' }),
    ).toHaveAttribute('href', '/privacy')
  })

  it('uses the sign-in wording on the login form', () => {
    renderNotice('signIn')
    expect(document.body.textContent).toContain('By signing in')
    // The tags were interpolated, not left as literal source text
    expect(document.body.textContent).not.toContain('<')
  })
})
