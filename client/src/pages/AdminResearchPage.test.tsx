/**
 * Unit tests for the admin research export page (SPEC EVAL-2): the download
 * button, its date-range scoping (end date inclusive), the failure state,
 * and the de-identification caveats.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AdminResearchPage from './AdminResearchPage'
import { mockFetchRoutes } from '../test/fetch-mock'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Stubs the object-URL anchor plumbing the download handler drives. */
const stubObjectUrl = () => {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:bundle'),
    revokeObjectURL: vi.fn(),
  })
}

describe('AdminResearchPage', () => {
  it('downloads the bundle, unscoped by default', async () => {
    stubObjectUrl()
    const { calls } = mockFetchRoutes({
      '/api/admin/research/export': () => ({ status: 200, body: 'PK' }),
    })
    render(<AdminResearchPage />)
    fireEvent.click(screen.getByRole('button', { name: /download bundle/i }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toContain('/api/admin/research/export')
    expect(calls[0]).not.toContain('from=')
  })

  it('scopes the request to the chosen dates, end date inclusive', async () => {
    stubObjectUrl()
    const { calls } = mockFetchRoutes({
      '/api/admin/research/export': () => ({ status: 200, body: 'PK' }),
    })
    render(<AdminResearchPage />)
    fireEvent.change(screen.getByLabelText('From'), {
      target: { value: '2026-09-01' },
    })
    fireEvent.change(screen.getByLabelText('To'), {
      target: { value: '2026-12-20' },
    })
    fireEvent.click(screen.getByRole('button', { name: /download bundle/i }))
    await waitFor(() => expect(calls).toHaveLength(1))
    const params = new URLSearchParams(calls[0]!.split('?')[1])
    expect(params.get('from')).toBe('2026-09-01T00:00:00.000Z')
    expect(params.get('to')).toBe('2026-12-20T23:59:59.999Z')
  })

  it('reports a failed export instead of downloading nothing', async () => {
    mockFetchRoutes({
      '/api/admin/research/export': () => ({ status: 500 }),
    })
    render(<AdminResearchPage />)
    fireEvent.click(screen.getByRole('button', { name: /download bundle/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not build/i,
    )
  })

  it('says plainly that free text is not scrubbed', () => {
    render(<AdminResearchPage />)
    expect(
      screen.getByText(/titles, slide bodies, and transcripts/i),
    ).toBeInTheDocument()
  })
})
