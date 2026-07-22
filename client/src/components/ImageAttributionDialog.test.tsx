/**
 * Unit tests for the image attribution dialog (IMG-5): the full TASL field
 * set, the owner/editable form vs the read-only view, URL links, and the
 * empty state. Editable (user-uploaded) images show every field; read-only
 * (AI-sourced) images show only the fields that carry data.
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
  it('read-only: shows only the fields that have data, including the license URL', () => {
    // An AI-sourced image with partial credit: title, creator, license, and
    // its URL, but no caption/creatorUrl/source.
    render(
      <ImageAttributionDialog
        attribution={{
          title: 'Plant Cell',
          creator: 'Jane Doe',
          license: 'CC BY 4.0',
          licenseUrl: full.licenseUrl,
        }}
        editable={false}
        onSave={() => {}}
        onClose={() => {}}
      />,
    )
    // Present fields render
    expect(screen.getByText('Plant Cell')).toBeInTheDocument()
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('CC BY 4.0')).toBeInTheDocument()
    // The license URL is a real new-tab link (copyright requirement)
    const licenseLink = screen.getByRole('link', { name: full.licenseUrl })
    expect(licenseLink).toHaveAttribute('href', full.licenseUrl)
    expect(licenseLink).toHaveAttribute('target', '_blank')
    // Absent fields are not shown at all — no empty rows
    expect(screen.queryByText('Caption')).not.toBeInTheDocument()
    expect(screen.queryByText('Source')).not.toBeInTheDocument()
    expect(screen.queryByText('Creator URL')).not.toBeInTheDocument()
    // Read-only: no form
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument()
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
