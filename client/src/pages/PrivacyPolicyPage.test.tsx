/**
 * Unit test for the Privacy policy page: it renders its document, dated, with
 * the sections a reader comes looking for.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import PrivacyPolicyPage from './PrivacyPolicyPage'

describe('PrivacyPolicyPage', () => {
  it('renders the policy, dated', () => {
    render(
      <MemoryRouter>
        <PrivacyPolicyPage />
      </MemoryRouter>,
    )
    expect(
      screen.getByRole('heading', { level: 1, name: 'Privacy policy' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Last updated:/)).toBeInTheDocument()
    for (const section of [
      'What we collect',
      'AI processing',
      'How long we keep it',
      'Your choices',
    ]) {
      expect(
        screen.getByRole('heading', { level: 2, name: section }),
      ).toBeInTheDocument()
    }
  })
})
