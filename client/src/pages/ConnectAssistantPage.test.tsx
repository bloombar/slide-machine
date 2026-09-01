/**
 * Unit test for the "Connecting an AI assistant" page: it renders its
 * document, and that document keeps the two things a reader came for — the
 * name of the standard, and the ChatGPT menu that is easy to miss. The
 * document's other invariants are tested in content/documents.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import ConnectAssistantPage from './ConnectAssistantPage'

describe('ConnectAssistantPage', () => {
  it('renders the document', () => {
    render(
      <MemoryRouter>
        <ConnectAssistantPage />
      </MemoryRouter>,
    )
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Connecting an AI assistant',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'What it will never do' }),
    ).toBeInTheDocument()
  })

  it('gives each assistant its own steps, and names MCP', () => {
    render(
      <MemoryRouter>
        <ConnectAssistantPage />
      </MemoryRouter>,
    )
    const body = document.body.textContent ?? ''
    expect(body).toContain('MCP')
    expect(
      screen.getByRole('heading', { level: 3, name: 'Claude' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 3, name: 'ChatGPT' }),
    ).toBeInTheDocument()
    // ChatGPT renamed this area twice; a reader who cannot find it gives up,
    // so the page has to name the current menu and its two old names.
    expect(body).toContain('Plugins')
    expect(body).toContain('Connectors')
    expect(body).toContain('Developer mode')
  })

  // The public page is about the site the reader is on. Running your own
  // Slide Machine is a developer concern and stays in docs/.
  it('says nothing about connecting to a local instance', () => {
    render(
      <MemoryRouter>
        <ConnectAssistantPage />
      </MemoryRouter>,
    )
    const body = document.body.textContent ?? ''
    expect(body).not.toContain('localhost')
    expect(body).not.toContain('PUBLIC_BASE_URL')
  })
})
