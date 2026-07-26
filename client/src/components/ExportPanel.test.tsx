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
      'export.status': () => ({ status: 200, body: { googleConnected: false, deckTitle: 'Bio' } }),
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

  it('switches the format to YAML and updates the button label', async () => {
    mockFetchRoutes({
      'export.status': () => ({ status: 200, body: { googleConnected: false, deckTitle: 'Bio' } }),
    })
    render(<ExportPanel deckId="d1" />)
    fireEvent.click(await screen.findByRole('radio', { name: /YAML/ }))
    expect(
      screen.getByRole('button', { name: 'Download YAML' }),
    ).toBeInTheDocument()
  })

  it('forces Drive for Google Slides and hides the destination choice', async () => {
    mockFetchRoutes({
      'export.status': () => ({ status: 200, body: { googleConnected: true, deckTitle: 'Bio' } }),
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
      'export.status': () => ({ status: 200, body: { googleConnected: false, deckTitle: 'Bio' } }),
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
      await screen.findByRole('button', { name: 'Save Google Slides to Drive' }),
    ).toBeInTheDocument()
    expect(connectBody.returnTo).toContain('settings=export')
  })

  it('redirects to Google consent in live mode', async () => {
    const consent = 'https://accounts.google.com/o/oauth2/v2/auth?x=1'
    const loc = { href: 'http://localhost:5173/d/x' }
    Object.defineProperty(window, 'location', { configurable: true, value: loc })
    mockFetchRoutes({
      'export.status': () => ({ status: 200, body: { googleConnected: false, deckTitle: 'Bio' } }),
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
      'export.status': () => ({ status: 200, body: { googleConnected: true, deckTitle: 'Bio' } }),
      'quiz.driveFolders': () => ({
        status: 200,
        body: { folders: [{ id: 'folder-1', name: 'Lectures' }] },
      }),
      'export.toDrive': init => {
        driveBody = JSON.parse(String(init?.body))
        return {
          status: 200,
          body: {
            fileName: 'bio.pdf',
            fileUrl: 'https://drive.google.com/file/d/x/view',
            driveFolderName: 'My Drive',
          },
        }
      },
    })
    render(<ExportPanel deckId="d1" />)
    // Switch to "Save to Google Drive" and open the picker.
    fireEvent.click(await screen.findByRole('radio', { name: /Save to Google Drive/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save PDF to Drive' }))
    await screen.findByRole('dialog', { name: 'Choose a Drive folder' })
    // Save into the current (root) folder.
    fireEvent.click(screen.getByRole('button', { name: 'Save here' }))
    const link = await screen.findByRole('link', { name: /bio\.pdf/ })
    expect(link).toHaveAttribute('href', 'https://drive.google.com/file/d/x/view')
    expect(screen.getByText(/Saved to My Drive/)).toBeInTheDocument()
    expect(driveBody).toMatchObject({ format: 'pdf', driveFolderId: 'root' })
  })

  it('surfaces an error when the status fails to load', async () => {
    mockFetchRoutes({ 'export.status': () => ({ status: 500, body: {} }) })
    render(<ExportPanel deckId="d1" />)
    expect(
      await screen.findByText(/could not load the export status/i),
    ).toBeInTheDocument()
  })
})
