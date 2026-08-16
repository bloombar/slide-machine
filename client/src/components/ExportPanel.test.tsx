/**
 * Unit tests for the Export tab (EXP-1/EXP-2/EXP-4): choosing a format and
 * destination, downloading PDF/YAML files, the Google-Slides Drive-only rule,
 * connecting Google, saving to a chosen Drive folder, and error handling. The
 * Google actions and the file download are stubbed at the fetch/DOM layer.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ExportPanel from './ExportPanel'
import { mockFetchRoutes } from '../test/fetch-mock'

// A tiny base64 payload ("hi") the download path decodes.
const CONTENT_B64 = 'aGk='
const MIME_PPTX =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'

afterEach(() => vi.unstubAllGlobals())

beforeEach(() => {
  // jsdom implements neither of these; add them onto the real URL (keeping it
  // a usable constructor for `new URL(...)`) for the download path.
  URL.createObjectURL = vi.fn(() => 'blob:mock')
  URL.revokeObjectURL = vi.fn()
})

describe('ExportPanel', () => {
  it('downloads a PDF by default, sending the deck id and format', async () => {
    let downloadBody: { format?: string } = {}
    const clickSpy = vi.fn()
    const realCreate = document.createElement.bind(document)
    const createSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation(tag => {
        const el = realCreate(tag)
        if (tag === 'a') el.click = clickSpy
        return el
      })
    mockFetchRoutes({
      'export.status': () => ({
        status: 200,
        body: {
          googleConnected: false,
          deckTitle: 'Bio',
          hasWhiteboard: false,
          exports: [],
        },
      }),
      'export.download': init => {
        downloadBody = JSON.parse(String(init?.body))
        return {
          status: 200,
          body: {
            fileName: 'bio.pdf',
            mimeType: 'application/pdf',
            contentBase64: CONTENT_B64,
          },
        }
      },
    })
    render(<ExportPanel deckId="d1" />)

    const button = await screen.findByRole('button', { name: 'Download PDF' })
    fireEvent.click(button)
    await waitFor(() => expect(clickSpy).toHaveBeenCalled())
    expect(downloadBody.format).toBe('pdf')
    createSpy.mockRestore()
  })

  it('shows what the file could not carry (EXP-7)', async () => {
    const realCreate = document.createElement.bind(document)
    const createSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation(tag => {
        const el = realCreate(tag)
        if (tag === 'a') el.click = vi.fn()
        return el
      })
    mockFetchRoutes({
      'export.status': () => ({
        status: 200,
        body: {
          googleConnected: false,
          deckTitle: 'Bio',
          hasWhiteboard: false,
          exports: [],
        },
      }),
      'export.download': () => ({
        status: 200,
        body: {
          fileName: 'bio.pdf',
          mimeType: 'application/pdf',
          contentBase64: CONTENT_B64,
          notes: [{ reason: 'math-not-typeset', detail: '\\frac{1}{' }],
        },
      }),
    })
    render(<ExportPanel deckId="d1" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Download PDF' }))
    // Said, not logged: the alternative is an author finding a hole in a
    // slide months later
    expect(
      await screen.findByText(/could not be carried into this file/i),
    ).toBeVisible()
    expect(screen.getByText(/could not be typeset/i)).toBeVisible()
    createSpy.mockRestore()
  })

  it('says nothing when the file carried everything', async () => {
    const realCreate = document.createElement.bind(document)
    const createSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation(tag => {
        const el = realCreate(tag)
        if (tag === 'a') el.click = vi.fn()
        return el
      })
    mockFetchRoutes({
      'export.status': () => ({
        status: 200,
        body: {
          googleConnected: false,
          deckTitle: 'Bio',
          hasWhiteboard: false,
          exports: [],
        },
      }),
      'export.download': () => ({
        status: 200,
        body: {
          fileName: 'bio.pdf',
          mimeType: 'application/pdf',
          contentBase64: CONTENT_B64,
        },
      }),
    })
    render(<ExportPanel deckId="d1" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Download PDF' }))
    // A report that appears when there is nothing to report trains people to
    // ignore it
    await waitFor(() =>
      expect(
        screen.queryByText(/could not be carried into this file/i),
      ).toBeNull(),
    )
    createSpy.mockRestore()
  })

  it('switches the format to YAML and updates the button label', async () => {
    mockFetchRoutes({
      'export.status': () => ({
        status: 200,
        body: {
          googleConnected: false,
          deckTitle: 'Bio',
          hasWhiteboard: false,
          exports: [],
        },
      }),
    })
    render(<ExportPanel deckId="d1" />)
    fireEvent.click(await screen.findByRole('radio', { name: /YAML/ }))
    expect(
      screen.getByRole('button', { name: 'Download YAML' }),
    ).toBeInTheDocument()
  })

  it('forces Drive for Google Slides and hides the destination choice', async () => {
    mockFetchRoutes({
      'export.status': () => ({
        status: 200,
        body: {
          googleConnected: true,
          deckTitle: 'Bio',
          hasWhiteboard: false,
          exports: [],
        },
      }),
    })
    render(<ExportPanel deckId="d1" />)
    fireEvent.click(await screen.findByRole('radio', { name: /Google Slides/ }))
    // The download/drive radios are gone; a note explains it is Drive-only.
    expect(screen.queryByRole('radio', { name: 'Download' })).toBeNull()
    expect(
      screen.getByText(/always saved to your Google Drive/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Save Google Slides to Drive' }),
    ).toBeInTheDocument()
  })

  it('connects Google (returning to the Export tab) before saving to Drive', async () => {
    let connectBody: { returnTo?: string } = {}
    mockFetchRoutes({
      'export.status': () => ({
        status: 200,
        body: {
          googleConnected: false,
          deckTitle: 'Bio',
          hasWhiteboard: false,
          exports: [],
        },
      }),
      'quiz.connectGoogle': init => {
        connectBody = JSON.parse(String(init?.body))
        return { status: 200, body: { status: 'connected' } }
      },
    })
    render(<ExportPanel deckId="d1" />)
    // Pick Google Slides (Drive-only) — the button prompts to connect.
    fireEvent.click(await screen.findByRole('radio', { name: /Google Slides/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Connect Google' }))
    // Mock connect flips to connected; the button now offers the save.
    expect(
      await screen.findByRole('button', {
        name: 'Save Google Slides to Drive',
      }),
    ).toBeInTheDocument()
    expect(connectBody.returnTo).toContain('settings=export')
  })

  it('redirects to Google consent in live mode', async () => {
    const consent = 'https://accounts.google.com/o/oauth2/v2/auth?x=1'
    const loc = { href: 'http://localhost:5173/d/x' }
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: loc,
    })
    mockFetchRoutes({
      'export.status': () => ({
        status: 200,
        body: {
          googleConnected: false,
          deckTitle: 'Bio',
          hasWhiteboard: false,
          exports: [],
        },
      }),
      'quiz.connectGoogle': () => ({
        status: 200,
        body: { status: 'redirect', url: consent },
      }),
    })
    render(<ExportPanel deckId="d1" />)
    fireEvent.click(await screen.findByRole('radio', { name: /Google Slides/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Connect Google' }))
    await waitFor(() => expect(loc.href).toBe(consent))
  })

  it('saves to a chosen Drive folder and shows the resulting link', async () => {
    let driveBody: { format?: string; driveFolderId?: string } = {}
    mockFetchRoutes({
      'export.status': () => ({
        status: 200,
        body: {
          googleConnected: true,
          deckTitle: 'Bio',
          hasWhiteboard: false,
          exports: [],
        },
      }),
      'quiz.driveFolders': () => ({
        status: 200,
        body: { folders: [{ id: 'folder-1', name: 'Lectures' }] },
      }),
      'export.toDrive': init => {
        driveBody = JSON.parse(String(init?.body))
        return {
          status: 200,
          body: {
            fileId: 'x',
            fileName: 'bio.pdf',
            fileUrl: 'https://drive.google.com/file/d/x/view',
            format: 'pdf',
            driveFolderName: 'My Drive',
            exportedAt: '2026-01-01T00:00:00.000Z',
          },
        }
      },
    })
    render(<ExportPanel deckId="d1" />)
    // Switch to "Save to Google Drive" and open the picker.
    fireEvent.click(
      await screen.findByRole('radio', { name: /Save to Google Drive/ }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save PDF to Drive' }))
    await screen.findByRole('dialog', { name: 'Choose a Drive folder' })
    // Save into the current (root) folder.
    fireEvent.click(screen.getByRole('button', { name: 'Save here' }))
    // The file appears both in the confirmation and the "Saved to Drive" list.
    const links = await screen.findAllByRole('link', { name: /bio\.pdf/ })
    expect(links[0]).toHaveAttribute(
      'href',
      'https://drive.google.com/file/d/x/view',
    )
    expect(screen.getByText('Saved to Drive')).toBeInTheDocument()
    expect(driveBody).toMatchObject({ format: 'pdf', driveFolderId: 'root' })
  })

  it('shows the whiteboard option only for PDF/Slides when the deck has marks', async () => {
    let downloadBody: { includeWhiteboard?: boolean } = {}
    mockFetchRoutes({
      'export.status': () => ({
        status: 200,
        body: {
          googleConnected: false,
          deckTitle: 'Bio',
          hasWhiteboard: true,
          exports: [],
        },
      }),
      'export.download': init => {
        downloadBody = JSON.parse(String(init?.body))
        return {
          status: 200,
          body: {
            fileName: 'bio.pdf',
            mimeType: 'application/pdf',
            contentBase64: CONTENT_B64,
          },
        }
      },
    })
    render(<ExportPanel deckId="d1" />)
    // PDF (default): the checkbox is shown and checked by default.
    const checkbox = await screen.findByRole('checkbox', {
      name: /include whiteboard markups/i,
    })
    expect(checkbox).toBeChecked()
    // YAML: no visual surface → the option disappears.
    fireEvent.click(screen.getByRole('radio', { name: /YAML/ }))
    expect(
      screen.queryByRole('checkbox', { name: /include whiteboard markups/i }),
    ).toBeNull()
    // Back to PDF, untick, and download — the flag rides along.
    fireEvent.click(screen.getByRole('radio', { name: /PDF/ }))
    fireEvent.click(
      screen.getByRole('checkbox', { name: /include whiteboard markups/i }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }))
    await waitFor(() => expect(downloadBody.includeWhiteboard).toBe(false))
  })

  /**
   * The two shapes EXP-1 offers. Flat is the default because it is what most
   * people want to hand someone; the layouts are what make the file editable
   * as a design and importable back without being rearranged.
   */
  it('offers the reusable-layouts choice for the slide formats only', async () => {
    let downloadBody: { withLayouts?: boolean } = {}
    mockFetchRoutes({
      'export.status': () => ({
        status: 200,
        body: {
          googleConnected: false,
          deckTitle: 'Bio',
          hasWhiteboard: false,
          exports: [],
        },
      }),
      'export.download': init => {
        downloadBody = JSON.parse(String(init?.body))
        return {
          status: 200,
          body: {
            fileName: 'bio.pptx',
            mimeType: MIME_PPTX,
            contentBase64: CONTENT_B64,
          },
        }
      },
    })
    render(<ExportPanel deckId="d1" />)
    const named = /keep the design as reusable layouts/i
    // PDF is a picture of each slide — nowhere to put a layout.
    await screen.findByRole('radio', { name: /PDF/ })
    expect(screen.queryByRole('checkbox', { name: named })).toBeNull()
    // PowerPoint has somewhere to put them, and starts off.
    fireEvent.click(screen.getByRole('radio', { name: /PowerPoint/ }))
    const checkbox = screen.getByRole('checkbox', { name: named })
    expect(checkbox).not.toBeChecked()
    // Ticked, it rides along with the download.
    fireEvent.click(checkbox)
    fireEvent.click(
      screen.getByRole('button', { name: /Download PowerPoint/i }),
    )
    await waitFor(() => expect(downloadBody.withLayouts).toBe(true))
  })

  it('lists a saved Drive export and deletes it', async () => {
    let deleteBody: { fileId?: string } = {}
    mockFetchRoutes({
      'export.status': () => ({
        status: 200,
        body: {
          googleConnected: true,
          deckTitle: 'Bio',
          hasWhiteboard: false,
          exports: [
            {
              fileId: 'file-9',
              fileUrl: 'https://drive/9',
              fileName: 'bio.pdf',
              format: 'pdf',
              exportedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
      }),
      'export.delete': init => {
        deleteBody = JSON.parse(String(init?.body))
        return { status: 200, body: { deleted: true } }
      },
    })
    render(<ExportPanel deckId="d1" />)
    expect(await screen.findByText('Saved to Drive')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete bio.pdf' }))
    await waitFor(() => expect(deleteBody.fileId).toBe('file-9'))
    // The row is removed from the list.
    await waitFor(() => expect(screen.queryByText('Saved to Drive')).toBeNull())
  })

  it('explains when a deleted export still lives in another user’s Drive', async () => {
    mockFetchRoutes({
      'export.status': () => ({
        status: 200,
        body: {
          googleConnected: true,
          deckTitle: 'Bio',
          hasWhiteboard: false,
          exports: [
            {
              fileId: 'file-9',
              fileUrl: 'https://drive/9',
              fileName: 'bio.pdf',
              format: 'pdf',
              exportedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
      }),
      'export.delete': () => ({
        status: 200,
        body: { deleted: true, remainsInOtherDrive: true },
      }),
    })
    render(<ExportPanel deckId="d1" />)
    expect(await screen.findByText('Saved to Drive')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete bio.pdf' }))
    // A modal explains the file remains in the other collaborator's Drive.
    expect(
      await screen.findByText(/still exists in their Drive/i),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    await waitFor(() =>
      expect(screen.queryByText(/still exists in their Drive/i)).toBeNull(),
    )
  })

  it('surfaces an error when the status fails to load', async () => {
    mockFetchRoutes({ 'export.status': () => ({ status: 500, body: {} }) })
    render(<ExportPanel deckId="d1" />)
    expect(
      await screen.findByText(/could not load the export status/i),
    ).toBeInTheDocument()
  })

  it('offers to reconnect when the Drive folders fail to load', async () => {
    mockFetchRoutes({
      'export.status': () => ({
        status: 200,
        body: {
          googleConnected: true,
          deckTitle: 'Bio',
          hasWhiteboard: false,
          exports: [],
        },
      }),
      'quiz.driveFolders': () => ({ status: 500, body: {} }),
    })
    render(<ExportPanel deckId="d1" />)
    fireEvent.click(
      await screen.findByRole('radio', { name: /Save to Google Drive/ }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save PDF to Drive' }))
    expect(
      await screen.findByText(/may not have granted Drive access/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Reconnect Google' }),
    ).toBeInTheDocument()
  })

  it('explains when a connect returned without Drive access (drive_denied)', async () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: 'http://localhost/d/x', search: '?connect=drive_denied' },
    })
    mockFetchRoutes({
      'export.status': () => ({
        status: 200,
        body: {
          googleConnected: false,
          deckTitle: 'Bio',
          hasWhiteboard: false,
          exports: [],
        },
      }),
    })
    render(<ExportPanel deckId="d1" />)
    expect(
      await screen.findByText(/Drive access wasn.t allowed/i),
    ).toBeInTheDocument()
  })
})
