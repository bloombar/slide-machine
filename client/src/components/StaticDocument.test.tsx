/**
 * Unit tests for the static-document renderer: the heading block, the
 * Markdown body, and the one thing that is not decoration — a link to
 * another page in the app has to be a router link, not a page load.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import StaticDocument from './StaticDocument'
import type { StaticDocument as Doc } from '../content/document'

const doc: Doc = {
  title: 'About us',
  summary: 'What this is.',
  updated: '5 August 2026',
  body: [
    '> A notice.',
    '',
    '## A section',
    '',
    'Some **emphatic** prose with an [internal link](/privacy) in it.',
    '',
    '- First point',
    '- Second point',
    '',
    'And an [external one](https://example.com).',
  ].join('\n'),
}

const renderDoc = (override: Partial<Doc> = {}) =>
  render(
    <MemoryRouter>
      <StaticDocument doc={{ ...doc, ...override }} />
    </MemoryRouter>,
  )

describe('StaticDocument', () => {
  it('shows the title, summary and date', () => {
    renderDoc()
    expect(
      screen.getByRole('heading', { level: 1, name: 'About us' }),
    ).toBeInTheDocument()
    expect(screen.getByText('What this is.')).toBeInTheDocument()
    expect(screen.getByText(/5 August 2026/)).toBeInTheDocument()
  })

  // About has no date to give; the line should be absent rather than empty.
  it('leaves the date out when the document has none', () => {
    renderDoc({ updated: undefined })
    expect(screen.queryByText(/Last updated/)).not.toBeInTheDocument()
  })

  it('renders the body as Markdown', () => {
    renderDoc()
    expect(
      screen.getByRole('heading', { level: 2, name: 'A section' }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('emphatic')).toBeInTheDocument()
  })

  // The documents link to each other; a plain <a> would reload the SPA.
  it('turns an in-app link into a router link', () => {
    renderDoc()
    const internal = screen.getByRole('link', { name: 'internal link' })
    expect(internal).toHaveAttribute('href', '/privacy')
    expect(internal).not.toHaveAttribute('target')
  })

  it('opens an external link in a new tab, safely', () => {
    renderDoc()
    const external = screen.getByRole('link', { name: 'external one' })
    expect(external).toHaveAttribute('href', 'https://example.com')
    expect(external).toHaveAttribute('target', '_blank')
    expect(external).toHaveAttribute('rel', 'noreferrer')
  })

  // The bodies are ours, but react-markdown must not start rendering HTML
  // just because a document happens to contain some.
  it('does not render raw HTML from the body', () => {
    renderDoc({ body: 'Before <button>press me</button> after.' })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
