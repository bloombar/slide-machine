/**
 * Unit tests for the browser download helpers: the temporary anchor carries
 * the object URL and file name, is attached then removed, is clicked, and the
 * URL is revoked only after the deferred tick.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { downloadExport, saveBlob } from './download'

let created: Blob[]
let revoke: ReturnType<typeof vi.fn>
let anchors: HTMLAnchorElement[]
let attachedAtClick: boolean[]

beforeEach(() => {
  vi.useFakeTimers()
  created = []
  anchors = []
  attachedAtClick = []
  revoke = vi.fn()
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn((b: Blob) => {
      created.push(b)
      return 'blob:test-url'
    }),
    revokeObjectURL: revoke,
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    anchors.push(this)
    attachedAtClick.push(document.body.contains(this))
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('saveBlob', () => {
  it('clicks an attached anchor carrying the URL and name, then removes it', () => {
    const blob = new Blob(['a,b'])
    saveBlob(blob, 'out.csv')

    expect(created).toEqual([blob])
    expect(anchors).toHaveLength(1)
    expect(anchors[0]!.getAttribute('href')).toBe('blob:test-url')
    expect(anchors[0]!.download).toBe('out.csv')
    expect(attachedAtClick).toEqual([true])
    expect(document.body.contains(anchors[0]!)).toBe(false)
  })

  it('revokes the URL only after the deferred tick', () => {
    saveBlob(new Blob(['x']), 'out.csv')
    expect(revoke).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(revoke).toHaveBeenCalledWith('blob:test-url')
  })
})

describe('downloadExport', () => {
  it('decodes the base64 payload and saves it under the file name', async () => {
    downloadExport({
      fileName: 'deck.yaml',
      mimeType: 'text/yaml',
      contentBase64: btoa('hello'),
    })
    expect(created).toHaveLength(1)
    expect(created[0]!.type).toBe('text/yaml')
    expect(created[0]!.size).toBe(5)
    expect(anchors[0]!.download).toBe('deck.yaml')
    vi.runAllTimers()
    expect(revoke).toHaveBeenCalledWith('blob:test-url')
  })
})
