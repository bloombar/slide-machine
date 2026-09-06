/**
 * Unit tests for the shared sign-in form. The email/password path is
 * covered through the pages that render this form; what is asserted here is
 * the ordering the form owns — Google first, email second.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import SignInForm from './SignInForm'

vi.mock('../config', () => ({
  config: { apiBaseUrl: '', googleAuthEnabled: true },
}))

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ login: vi.fn() }),
}))

describe('SignInForm', () => {
  it('offers Google above the email fields', () => {
    render(
      <MemoryRouter>
        <SignInForm onSuccess={vi.fn()} />
      </MemoryRouter>,
    )
    const google = screen.getByRole('link', { name: /google/i })
    const email = screen.getByLabelText(/email/i)
    expect(
      google.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})
