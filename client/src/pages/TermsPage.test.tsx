/**
 * Unit test for the Terms page: it renders its document, dated, with the
 * sections a reader comes looking for.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import TermsPage from './TermsPage'

describe('TermsPage', () => {
  it('renders the terms, dated', () => {
    render(
      <MemoryRouter>
        <TermsPage />
      </MemoryRouter>,
    )
    expect(
      screen.getByRole('heading', { level: 1, name: 'Terms & conditions' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Last updated:/)).toBeInTheDocument()
    for (const section of [
      'Your content',
      'AI-generated content',
      'Plans, payment and cancellation',
      'Liability',
    ]) {
      expect(
        screen.getByRole('heading', { level: 2, name: section }),
      ).toBeInTheDocument()
    }
  })
})
