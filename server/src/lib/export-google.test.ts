/**
 * Unit tests for the live Google export helpers (EXP-1/EXP-4): uploading a
 * generated file into a Drive folder, and building a native Google Slides
 * presentation by uploading a .pptx with Drive conversion. The Google REST
 * calls are mocked at fetch.
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
      layoutType: 'list',
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
      {
        name: 'deck.pdf',
        mimeType: 'application/pdf',
        data: new Uint8Array([1, 2, 3]),
      },
      'folder-1',
    )
    expect(res).toEqual({ id: 'file-1', fileUrl: 'https://drive/view/1' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('uploadType=multipart')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer access-tok')
    // A plain upload: the stored type equals the media type (no conversion).
    const sent = await (init.body as Blob).text()
    expect(sent).toContain('"mimeType":"application/pdf"')
    expect(sent).toContain('"parents":["folder-1"]')
  })

  it('converts the media to a Google type when convertTo is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'pres-1', webViewLink: 'https://slides/1' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    await uploadFileToDriveLive('t', {
      name: 'Deck',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      data: new Uint8Array([1]),
      convertTo: 'application/vnd.google-apps.presentation',
    })
    const sent = await (fetchMock.mock.calls[0]![1].body as Blob).text()
    // Metadata declares the DESTINATION (converted) type…
    expect(sent).toContain('"mimeType":"application/vnd.google-apps.presentation"')
    // …while the media part still carries the source .pptx type.
    expect(sent).toContain('presentationml.presentation')
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
  it('uploads a .pptx with Slides conversion and returns the presentation URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'pres-1',
        webViewLink: 'https://docs.google.com/presentation/d/pres-1/edit',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await createGoogleSlidesLive('tok', deck, 'folder-1')
    expect(res).toEqual({
      id: 'pres-1',
      fileUrl: 'https://docs.google.com/presentation/d/pres-1/edit',
    })
    // A single Drive upload call, converting to native Google Slides.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('uploadType=multipart')
    const sent = await (init.body as Blob).text()
    expect(sent).toContain('"name":"Photosynthesis"')
    expect(sent).toContain('"mimeType":"application/vnd.google-apps.presentation"')
    expect(sent).toContain('"parents":["folder-1"]')
  })

  it('saves to My Drive root without pinning a parent', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'pres-2', webViewLink: 'https://slides/2' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    await createGoogleSlidesLive('t', deck, 'root')
    const sent = await (fetchMock.mock.calls[0]![1].body as Blob).text()
    expect(sent).not.toContain('parents')
  })

  it('throws when the Drive conversion upload fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }))
    await expect(createGoogleSlidesLive('t', deck, 'root')).rejects.toThrow(
      /Drive upload failed \(403\)/,
    )
  })
})
