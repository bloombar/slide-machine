/**
 * Unit test for the About page: it renders its document. The document's own
 * invariants are tested in content/documents.test.ts, and the rendering in
 * components/StaticDocument.test.tsx.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import AboutPage from './AboutPage'

describe('AboutPage', () => {
  it('renders the About document', () => {
    render(
      <MemoryRouter>
        <AboutPage />
      </MemoryRouter>,
    )
    expect(
      screen.getByRole('heading', { level: 1, name: 'About us' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'How it works' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'feedback form' })).toHaveAttribute(
      'href',
      '/feedback',
    )
  })

  it('points at the assistant how-to', () => {
    render(
      <MemoryRouter>
        <AboutPage />
      </MemoryRouter>,
    )
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'Made from your AI assistant',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'How to connect an assistant' }),
    ).toHaveAttribute('href', '/assistants')
  })
})
