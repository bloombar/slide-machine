/**
 * Unit tests for the Design tab's export section (EXP-2 / EXP-6).
 *
 * The section is scoped to a template id and nothing else — that is what lets
 * the lecture, project and account Design tabs share it — so these tests are
 * about which id each destination is asked for, and about the two failures a
 * user can act on: a refused download, and a Drive save with no Google
 * account connected.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import TemplateExportSection from './TemplateExportSection'
import { dispatchAction } from '../../api/actions'
import { downloadExport } from '../../lib/download'
import { ApiError } from '../../api/http'

vi.mock('../../api/actions')
vi.mock('../../lib/download')

/** A stand-in for the Drive folder chooser: the picker's own behaviour is its
 * own suite's, and this one only needs a folder to come back. */
vi.mock('../DrivePicker', () => ({
  default: ({
    onPick,
  }: {
    onPick: (folder: { id: string; name: string }) => void
  }) => (
    <button type="button" onClick={() => onPick({ id: 'f1', name: 'Course' })}>
      pick folder
    </button>
  ),
}))

const mockDispatch = vi.mocked(dispatchAction)

beforeEach(() => {
  vi.clearAllMocks()
  mockDispatch.mockResolvedValue({} as never)
})
afterEach(cleanup)

describe('TemplateExportSection', () => {
  it('offers the three destinations one design can go to', () => {
    render(<TemplateExportSection templateId="t1" />)
    expect(screen.getByRole('button', { name: 'As YAML' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'As PowerPoint' })).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'As Google Slides' }),
    ).toBeVisible()
  })

  it('downloads the named design as YAML', async () => {
    const file = { filename: 'x.yaml', contentType: 'text/yaml', content: 'a' }
    mockDispatch.mockResolvedValue(file as never)
    render(<TemplateExportSection templateId="t1" />)

    fireEvent.click(screen.getByRole('button', { name: 'As YAML' }))

    await vi.waitFor(() =>
      expect(mockDispatch).toHaveBeenCalledWith('template.export', {
        templateId: 't1',
      }),
    )
    await vi.waitFor(() => expect(downloadExport).toHaveBeenCalledWith(file))
  })

  it('asks for PowerPoint by naming the format', async () => {
    render(<TemplateExportSection templateId="t2" />)

    fireEvent.click(screen.getByRole('button', { name: 'As PowerPoint' }))

    await vi.waitFor(() =>
      expect(mockDispatch).toHaveBeenCalledWith('template.export', {
        templateId: 't2',
        format: 'pptx',
      }),
    )
  })

  // A quiet failure here is indistinguishable from a button that does
  // nothing, which is how this last went wrong.
  it('says so when a download is refused', async () => {
    mockDispatch.mockRejectedValue(new Error('nope'))
    render(<TemplateExportSection templateId="t1" />)

    fireEvent.click(screen.getByRole('button', { name: 'As YAML' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not export the design as a file',
    )
  })

  it('saves the design to the chosen Drive folder and links to it', async () => {
    mockDispatch.mockResolvedValue({
      fileUrl: 'https://slides.example/1',
    } as never)
    render(<TemplateExportSection templateId="t3" />)

    fireEvent.click(screen.getByRole('button', { name: 'As Google Slides' }))
    fireEvent.click(screen.getByRole('button', { name: 'pick folder' }))

    await vi.waitFor(() =>
      expect(mockDispatch).toHaveBeenCalledWith('template.exportToDrive', {
        templateId: 't3',
        driveFolderId: 'f1',
        driveFolderName: 'Course',
      }),
    )
    expect(
      await screen.findByRole('link', {
        name: 'Saved to Drive — open in Google Slides',
      }),
    ).toHaveAttribute('href', 'https://slides.example/1')
  })

  it('names the one Drive failure the user can act on', async () => {
    mockDispatch.mockRejectedValue(new ApiError(403, 'forbidden', 'no'))
    render(<TemplateExportSection templateId="t3" />)

    fireEvent.click(screen.getByRole('button', { name: 'As Google Slides' }))
    fireEvent.click(screen.getByRole('button', { name: 'pick folder' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Connect a Google account to save designs to Drive.',
    )
  })
})
