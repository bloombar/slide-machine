/**
 * Unit tests for the image attribution dialog (IMG-5): read-only display,
 * the owner edit form, links, and the empty state.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ImageAttributionDialog from './ImageAttributionDialog'

const attribution = {
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:Cell.png',
  creator: 'Jane Doe (Wikimedia Commons)',
  license: 'CC BY 4.0',
}

describe('ImageAttributionDialog', () => {
  it('shows credit and license, with the source as a new-tab link', () => {
    render(
      <ImageAttributionDialog
        attribution={attribution}
        editable={false}
        onSave={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText('Jane Doe (Wikimedia Commons)')).toBeInTheDocument()
    expect(screen.getByText('CC BY 4.0')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: attribution.sourceUrl })
    expect(link).toHaveAttribute('href', attribution.sourceUrl)
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('tells a viewer when nothing is recorded', () => {
    render(
      <ImageAttributionDialog
        editable={false}
        onSave={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText(/no source or licensing/i)).toBeInTheDocument()
    // No form for a viewer
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument()
  })

  it('lets an owner edit and save the fields', () => {
    const onSave = vi.fn()
    render(
      <ImageAttributionDialog editable onSave={onSave} onClose={() => {}} />,
    )
    fireEvent.change(screen.getByLabelText('Source'), {
      target: { value: 'https://example.com/photo' },
    })
    fireEvent.change(screen.getByLabelText('Credit'), {
      target: { value: 'Ada' },
    })
    fireEvent.change(screen.getByLabelText('License'), {
      target: { value: 'CC0' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith({
      sourceUrl: 'https://example.com/photo',
      creator: 'Ada',
      license: 'CC0',
    })
  })

  it('saves empty fields as undefined so all-blank clears the credit', () => {
    const onSave = vi.fn()
    render(
      <ImageAttributionDialog
        attribution={attribution}
        editable
        onSave={onSave}
        onClose={() => {}}
      />,
    )
    for (const label of ['Source', 'Credit', 'License']) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: '' } })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith({
      sourceUrl: undefined,
      creator: undefined,
      license: undefined,
    })
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
