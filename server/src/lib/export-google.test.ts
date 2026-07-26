/**
 * Unit tests for the live Google export helpers (EXP-1/EXP-4): uploading a
 * generated file into a Drive folder, and building a native Google Slides
 * presentation from the deck. The Google REST calls are mocked at fetch.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { uploadFileToDriveLive, createGoogleSlidesLive } from './export-google'
import type { ExportDeck } from './deck-yaml'

vi.mock('../auth/google-connect', () => ({
  clientForRefreshToken: (t: string) => ({
    getAccessToken: async () => ({ token: `access-${t}` }),
  }),
}))

afterEach(() => vi.unstubAllGlobals())

const deck: ExportDeck = {
  title: 'Photosynthesis',
  templateId: 'classic',
  slides: [
    {
      layoutType: 'bullets',
      title: 'Where',
      body: 'Overview',
      bullets: ['Chloroplasts', 'Chlorophyll'],
    },
  ],
}

describe('uploadFileToDriveLive', () => {
  it('uploads the bytes and returns the id and view link', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'file-1', webViewLink: 'https://drive/view/1' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = await uploadFileToDriveLive(
      'tok',
      { name: 'deck.pdf', mimeType: 'application/pdf', data: new Uint8Array([1, 2, 3]) },
      'folder-1',
    )
    expect(res).toEqual({ id: 'file-1', fileUrl: 'https://drive/view/1' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('uploadType=multipart')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer access-tok')
    expect(String(init.headers['Content-Type'])).toContain('multipart/related')
  })

  it('falls back to a file URL when Drive omits the view link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 'file-2' }),
      }),
    )
    const res = await uploadFileToDriveLive('t', {
      name: 'd.yaml',
      mimeType: 'application/x-yaml',
      data: new Uint8Array([1]),
    })
    expect(res.fileUrl).toBe('https://drive.google.com/file/d/file-2/view')
  })

  it('throws when the upload fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    await expect(
      uploadFileToDriveLive('t', {
        name: 'd.pdf',
        mimeType: 'application/pdf',
        data: new Uint8Array(),
      }),
    ).rejects.toThrow(/Drive upload failed \(500\)/)
  })
})

describe('createGoogleSlidesLive', () => {
  it('creates the presentation, fills each slide, and returns the edit URL', async () => {
    const fetchMock = vi
      .fn()
      // presentations.create
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          presentationId: 'pres-1',
          slides: [{ objectId: 'default-slide' }],
        }),
      })
      // batchUpdate
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
      // move into folder
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    const res = await createGoogleSlidesLive('tok', deck, 'folder-1')
    expect(res).toEqual({
      id: 'pres-1',
      fileUrl: 'https://docs.google.com/presentation/d/pres-1/edit',
    })

    // The create call carries the deck title.
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1].body)).title).toBe(
      'Photosynthesis',
    )
    // The batchUpdate creates a slide, inserts title + body, and deletes the
    // blank default slide.
    const batch = JSON.parse(String(fetchMock.mock.calls[1]![1].body))
    const kinds = batch.requests.map((r: Record<string, unknown>) =>
      Object.keys(r)[0],
    )
    expect(kinds).toContain('createSlide')
    expect(kinds.filter((k: string) => k === 'insertText')).toHaveLength(2)
    expect(kinds).toContain('deleteObject')
    // The move PATCH re-parents into the chosen folder.
    const [moveUrl, moveInit] = fetchMock.mock.calls[2]!
    expect(moveInit.method).toBe('PATCH')
    expect(String(moveUrl)).toContain('addParents=folder-1')
  })

  it('skips the folder move when saving to My Drive root', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ presentationId: 'pres-2', slides: [] }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    await createGoogleSlidesLive('t', deck, 'root')
    // Only create + batchUpdate — no third (move) call.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws when presentation creation fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }))
    await expect(createGoogleSlidesLive('t', deck, 'root')).rejects.toThrow(
      /Slides create failed \(403\)/,
    )
  })
})
