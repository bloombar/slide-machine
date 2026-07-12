/**
 * Unit tests for the seed-material manager: upload flow, status chips,
 * enable toggle, caption save, and delete.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { SeedAsset } from '@slide-machine/shared'
import SeedMaterial from './SeedMaterial'
import { mockFetchRoutes } from '../test/fetch-mock'

const asset = (overrides: Partial<SeedAsset> = {}): SeedAsset => ({
  id: 'a1',
  projectId: 'p1',
  type: 'pdf',
  name: 'syllabus.pdf',
  status: 'ready',
  text: 'Photosynthesis converts light energy',
  keywords: [],
  enabled: true,
  createdAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SeedMaterial', () => {
  it('lists assets with status and a text preview', async () => {
    mockFetchRoutes({
      '/api/actions/seedAsset.list': () => ({ status: 200, body: [asset()] }),
    })
    render(<SeedMaterial projectId="p1" />)
    expect(await screen.findByText('syllabus.pdf')).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(
      screen.getByText('Photosynthesis converts light energy'),
    ).toBeInTheDocument()
  })

  it('uploads a picked file and shows it as processing', async () => {
    let uploaded: FormData | undefined
    mockFetchRoutes({
      '/api/actions/seedAsset.list': () => ({ status: 200, body: [] }),
      '/api/seed-assets': init => {
        uploaded = init?.body as FormData
        return {
          status: 201,
          body: asset({
            status: 'processing',
            name: 'cells.png',
            type: 'image',
          }),
        }
      },
    })
    render(<SeedMaterial projectId="p1" />)

    const file = new File(['png-bytes'], 'cells.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('Upload seed material'), {
      target: { files: [file] },
    })

    expect(await screen.findByText('cells.png')).toBeInTheDocument()
    expect(screen.getByText('Processing…')).toBeInTheDocument()
    expect(uploaded?.get('projectId')).toBe('p1')
    expect((uploaded?.get('file') as File).name).toBe('cells.png')
  })

  it('toggles an asset out of generation', async () => {
    let sent: unknown
    mockFetchRoutes({
      '/api/actions/seedAsset.list': () => ({ status: 200, body: [asset()] }),
      '/api/actions/seedAsset.update': init => {
        sent = JSON.parse(String(init?.body))
        return { status: 200, body: asset({ enabled: false }) }
      },
    })
    render(<SeedMaterial projectId="p1" />)
    fireEvent.click(
      await screen.findByRole('checkbox', {
        name: 'Use syllabus.pdf in generation',
      }),
    )
    await vi.waitFor(() =>
      expect(sent).toEqual({ assetId: 'a1', enabled: false }),
    )
  })

  it('saves image captions with a debounce', async () => {
    vi.useFakeTimers()
    let sent: unknown
    const photo = asset({
      id: 'a2',
      type: 'image',
      name: 'cells.png',
      text: undefined,
      imageUrl: '/api/files/seed/a2/cells.png',
    })
    mockFetchRoutes({
      '/api/actions/seedAsset.list': () => ({ status: 200, body: [photo] }),
      '/api/actions/seedAsset.update': init => {
        sent = JSON.parse(String(init?.body))
        return { status: 200, body: { ...photo, caption: 'Plant cells' } }
      },
    })
    render(<SeedMaterial projectId="p1" />)

    const field = await vi.waitFor(() =>
      screen.getByLabelText('Caption for cells.png'),
    )
    fireEvent.change(field, { target: { value: 'Plant cells' } })
    vi.advanceTimersByTime(800)

    await vi.waitFor(() =>
      expect(sent).toEqual({ assetId: 'a2', caption: 'Plant cells' }),
    )
    vi.useRealTimers()
  })

  it('deletes an asset', async () => {
    mockFetchRoutes({
      '/api/actions/seedAsset.list': () => ({ status: 200, body: [asset()] }),
      '/api/actions/seedAsset.delete': () => ({
        status: 200,
        body: { deleted: true },
      }),
    })
    render(<SeedMaterial projectId="p1" />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete syllabus.pdf' }),
    )
    expect(await screen.findByText('No seed material yet.')).toBeInTheDocument()
  })
})
