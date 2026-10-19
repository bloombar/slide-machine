/**
 * Unit tests for the admin Export CSV button (SPEC BILL-7, EVAL-1): a
 * successful fetch is saved under the given name, a failure is reported, and
 * the button is disabled while the download is in flight.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ExportCsvButton from './ExportCsvButton'
import { saveBlob } from '../../lib/download'

vi.mock('../../lib/download')

beforeEach(() => vi.mocked(saveBlob).mockReset())

describe('ExportCsvButton', () => {
  it('saves the fetched blob under the given file name', async () => {
    const blob = new Blob(['a,b'])
    render(
      <ExportCsvButton
        download={async () => blob}
        fileName={() => 'cost-1.csv'}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    await waitFor(() =>
      expect(saveBlob).toHaveBeenCalledWith(blob, 'cost-1.csv'),
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows an alert when the download fails, and saves nothing', async () => {
    render(
      <ExportCsvButton
        download={() => Promise.reject(new Error('401'))}
        fileName={() => 'x.csv'}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not export/i,
    )
    expect(saveBlob).not.toHaveBeenCalled()
  })

  it('is disabled while the download is pending, then re-enabled', async () => {
    let finish: (b: Blob) => void = () => {}
    const download = vi.fn(
      () => new Promise<Blob>(resolve => (finish = resolve)),
    )
    render(<ExportCsvButton download={download} fileName={() => 'x.csv'} />)
    const button = screen.getByRole('button', { name: 'Export CSV' })
    expect(button).toHaveAttribute('type', 'button')
    fireEvent.click(button)
    await waitFor(() => expect(button).toBeDisabled())
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toHaveTextContent('Exporting…')
    fireEvent.click(button)
    expect(download).toHaveBeenCalledTimes(1)
    finish(new Blob(['x']))
    await waitFor(() => expect(button).toBeEnabled())
    expect(button).toHaveTextContent('Export CSV')
    expect(button).toHaveAttribute('aria-busy', 'false')
  })

  it('stays disabled while the caller says the period is unknown', () => {
    const download = vi.fn(async () => new Blob(['x']))
    render(
      <ExportCsvButton download={download} fileName={() => 'x.csv'} disabled />,
    )
    const button = screen.getByRole('button', { name: 'Export CSV' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(download).not.toHaveBeenCalled()
  })

  it('names the file when clicked, not when rendered', async () => {
    const fileName = vi.fn(() => 'later.csv')
    render(
      <ExportCsvButton
        download={async () => new Blob(['x'])}
        fileName={fileName}
      />,
    )
    expect(fileName).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    await waitFor(() =>
      expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'later.csv'),
    )
  })

  it('clears an earlier failure when retried', async () => {
    const download = vi
      .fn<() => Promise<Blob>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(new Blob(['ok']))
    render(<ExportCsvButton download={download} fileName={() => 'x.csv'} />)
    const button = screen.getByRole('button', { name: 'Export CSV' })
    fireEvent.click(button)
    await screen.findByRole('alert')
    fireEvent.click(button)
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(saveBlob).toHaveBeenCalledTimes(1)
  })
})
