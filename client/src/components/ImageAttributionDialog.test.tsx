/**
 * Unit tests for the image attribution dialog (IMG-5). Editable
 * (user-uploaded) images show every TASL field as a form; read-only
 * (AI-sourced) images show three consolidated clickable lines — Source,
 * Credit, License — each linking its text to the matching URL, with the
 * source label falling back title → caption → credit → the raw URL.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ImageAttributionDialog from './ImageAttributionDialog'

const full = {
  caption: 'A single plant cell',
  title: 'Plant Cell',
  creator: 'Jane Doe',
  creatorUrl: 'https://commons.wikimedia.org/wiki/User:Jane',
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:Cell.png',
  sourceName: 'Wikimedia Commons',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
}

describe('ImageAttributionDialog', () => {
  it('read-only: License name links to the license URL, with no separate URL row', () => {
    render(
      <ImageAttributionDialog
        attribution={{ license: 'CC BY 4.0', licenseUrl: full.licenseUrl }}
        editable={false}
        onSave={() => {}}
        onClose={() => {}}
      />,
    )
    // The license NAME is the link (not the raw URL shown separately)
    const licenseLink = screen.getByRole('link', { name: 'CC BY 4.0' })
    expect(licenseLink).toHaveAttribute('href', full.licenseUrl)
    expect(licenseLink).toHaveAttribute('target', '_blank')
    // The URL itself is never printed as its own line
    expect(screen.queryByText(full.licenseUrl)).not.toBeInTheDocument()
    // Read-only: no form
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument()
  })

  it('read-only: Source uses the title as the link text, pointing at the source URL', () => {
    render(
      <ImageAttributionDialog
        attribution={{
          title: 'Plant Cell',
          caption: 'A single plant cell',
          sourceUrl: full.sourceUrl,
        }}
        editable={false}
        onSave={() => {}}
        onClose={() => {}}
      />,
    )
    const source = screen.getByRole('link', { name: 'Plant Cell' })
    expect(source).toHaveAttribute('href', full.sourceUrl)
    // The source URL is not printed separately
    expect(screen.queryByText(full.sourceUrl)).not.toBeInTheDocument()
  })

  it('read-only: Source falls back title → caption → credit → the raw URL', () => {
    const { rerender } = render(
      <ImageAttributionDialog
        attribution={{
          caption: 'A single plant cell',
          sourceUrl: full.sourceUrl,
        }}
        editable={false}
        onSave={() => {}}
        onClose={() => {}}
      />,
    )
    // No title → caption is the source link text
    expect(
      screen.getByRole('link', { name: 'A single plant cell' }),
    ).toHaveAttribute('href', full.sourceUrl)

    // No title/caption → credit is the source link text
    rerender(
      <ImageAttributionDialog
        attribution={{ creator: 'Jane Doe', sourceUrl: full.sourceUrl }}
        editable={false}
        onSave={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByRole('link', { name: 'Jane Doe' })).toHaveAttribute(
      'href',
      full.sourceUrl,
    )

    // No title/caption/credit → the raw URL is the link text (direct link)
    rerender(
      <ImageAttributionDialog
        attribution={{ sourceUrl: full.sourceUrl }}
        editable={false}
        onSave={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByRole('link', { name: full.sourceUrl })).toHaveAttribute(
      'href',
      full.sourceUrl,
    )
  })

  it('read-only: Credit uses the creator name as the link to the creator URL', () => {
    render(
      <ImageAttributionDialog
        attribution={{ creator: 'Jane Doe', creatorUrl: full.creatorUrl }}
        editable={false}
        onSave={() => {}}
        onClose={() => {}}
      />,
    )
    const credit = screen.getByRole('link', { name: 'Jane Doe' })
    expect(credit).toHaveAttribute('href', full.creatorUrl)
    expect(screen.queryByText(full.creatorUrl)).not.toBeInTheDocument()
  })

  it('read-only: values with no URL render as plain text, not links', () => {
    render(
      <ImageAttributionDialog
        attribution={{ creator: 'Jane Doe', license: 'CC BY 4.0' }}
        editable={false}
        onSave={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('CC BY 4.0')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('read-only: tells a viewer when nothing is recorded', () => {
    render(
      <ImageAttributionDialog
        editable={false}
        onSave={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText(/no source or licensing/i)).toBeInTheDocument()
  })

  it('editable: shows every attribution field as an input', () => {
    render(
      <ImageAttributionDialog editable onSave={() => {}} onClose={() => {}} />,
    )
    for (const label of [
      'Title',
      'Caption',
      'Credit',
      'Creator URL',
      'Source',
      'Source URL',
      'License',
      'License URL',
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }
  })

  it('editable: an owner edits and saves all the fields', () => {
    const onSave = vi.fn()
    render(
      <ImageAttributionDialog editable onSave={onSave} onClose={() => {}} />,
    )
    const set = (label: string, value: string) =>
      fireEvent.change(screen.getByLabelText(label), { target: { value } })

    set('Title', full.title)
    set('Caption', full.caption)
    set('Credit', full.creator)
    set('Creator URL', full.creatorUrl)
    set('Source', full.sourceName)
    set('Source URL', full.sourceUrl)
    set('License', full.license)
    set('License URL', full.licenseUrl)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave).toHaveBeenCalledWith(full)
  })

  it('editable: pre-fills from existing attribution and clears blanked fields to undefined', () => {
    const onSave = vi.fn()
    render(
      <ImageAttributionDialog
        attribution={full}
        editable
        onSave={onSave}
        onClose={() => {}}
      />,
    )
    // The form is pre-populated from the passed attribution
    expect(screen.getByLabelText('License URL')).toHaveValue(full.licenseUrl)
    // Clearing every field saves an empty attribution (undefined throughout)
    for (const label of [
      'Title',
      'Caption',
      'Credit',
      'Creator URL',
      'Source',
      'Source URL',
      'License',
      'License URL',
    ]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: '' } })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith({})
  })

  it('closes on Cancel and on Escape', () => {
    const onClose = vi.fn()
    render(
      <ImageAttributionDialog editable onSave={() => {}} onClose={onClose} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
