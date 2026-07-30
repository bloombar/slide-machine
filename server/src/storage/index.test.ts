/**
 * Unit tests for the storage health probe on both adapters. The S3 client
 * is stubbed so `HeadBucket` reachability is exercised without a live
 * endpoint; each case re-imports the module so the lazy provider singleton
 * picks up the test's STORAGE_PROVIDER.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PassThrough } from 'node:stream'
import type { FileStorage } from './index'

const send = vi.fn()
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(function () {
    return { send }
  }),
  HeadBucketCommand: vi.fn(function (input: unknown) {
    return { input }
  }),
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
  ListMultipartUploadsCommand: vi.fn(function (input: unknown) {
    return { __type: 'ListMultipartUploads', input }
  }),
  AbortMultipartUploadCommand: vi.fn(function (input: unknown) {
    return { __type: 'AbortMultipartUpload', input }
  }),
}))

// lib-storage's Upload orchestrates the multipart calls; stubbing it keeps the
// adapter's configuration and lifecycle assertable without a live endpoint.
// Real multipart behaviour is covered by the MinIO/Spaces smoke tests.
const uploadMock = vi.hoisted(() => {
  const done = vi.fn(() => Promise.resolve())
  const abort = vi.fn(() => Promise.resolve())
  const ctor = vi.fn(function (_input: unknown) {
    return { done, abort }
  })
  return { ctor, done, abort }
})
vi.mock('@aws-sdk/lib-storage', () => ({ Upload: uploadMock.ctor }))

const mockEnv = vi.hoisted(() => ({
  env: {
    STORAGE_PROVIDER: 'local' as 'local' | 's3',
    STORAGE_LOCAL_DIR: '/tmp/uploads-test',
    S3_ENDPOINT: undefined as string | undefined,
    S3_REGION: undefined as string | undefined,
    S3_BUCKET: undefined as string | undefined,
    S3_FORCE_PATH_STYLE: false,
    S3_ACCESS_KEY_ID: undefined as string | undefined,
    S3_SECRET_ACCESS_KEY: undefined as string | undefined,
    S3_PUBLIC_BASE_URL: undefined as string | undefined,
  },
}))
vi.mock('../config/env', () => mockEnv)

beforeEach(() => {
  vi.resetModules()
  send.mockReset()
  uploadMock.ctor.mockClear()
  uploadMock.done.mockClear()
  uploadMock.abort.mockClear()
  Object.assign(mockEnv.env, {
    STORAGE_PROVIDER: 'local',
    S3_ENDPOINT: undefined,
    S3_BUCKET: undefined,
  })
})

describe('local getRange', () => {
  // Ranged reads are what keep slide playback from loading a whole lecture
  // recording into memory, so the boundary behaviour is load-bearing.
  const seed = async (): Promise<{ storage: FileStorage; key: string }> => {
    mockEnv.env.STORAGE_LOCAL_DIR = await mkdtemp(
      join(tmpdir(), 'slide-machine-range-'),
    )
    const { getStorage } = await import('./index')
    const storage = getStorage()
    const key = 'audio/deck/take.bin'
    await storage.put(
      key,
      Buffer.from('0123456789'),
      'application/octet-stream',
    )
    return { storage, key }
  }

  it('returns exactly the half-open byte window', async () => {
    const { storage, key } = await seed()
    expect((await storage.getRange(key, 2, 5))?.toString()).toBe('234')
    expect((await storage.getRange(key, 0, 1))?.toString()).toBe('0')
  })

  it('returns only what exists when the range runs past the end', async () => {
    const { storage, key } = await seed()
    // Callers derive `end` from a rounded durationMs, so over-reading by a few
    // bytes is expected and must not fail the read.
    expect((await storage.getRange(key, 8, 100))?.toString()).toBe('89')
  })

  it('returns null for an empty, negative, or past-the-end range', async () => {
    const { storage, key } = await seed()
    expect(await storage.getRange(key, 5, 5)).toBeNull()
    expect(await storage.getRange(key, 5, 2)).toBeNull()
    expect(await storage.getRange(key, -1, 4)).toBeNull()
    expect(await storage.getRange(key, 50, 60)).toBeNull()
  })

  it('returns null for a missing object rather than throwing', async () => {
    const { storage } = await seed()
    expect(await storage.getRange('audio/deck/gone.bin', 0, 4)).toBeNull()
  })
})

describe('local createUploadStream', () => {
  const openUpload = async (key = 'audio/deck/take.pcm') => {
    mockEnv.env.STORAGE_LOCAL_DIR = await mkdtemp(
      join(tmpdir(), 'slide-machine-upload-'),
    )
    const { getStorage } = await import('./index')
    const storage = getStorage()
    return { storage, key, upload: await storage.createUploadStream(key, 'x') }
  }

  it('streams chunks into one object', async () => {
    const { storage, key, upload } = await openUpload()
    upload.write(Buffer.from('abc'))
    upload.write(Buffer.from('def'))
    await upload.done()
    expect((await storage.get(key))?.toString()).toBe('abcdef')
  })

  it('leaves nothing at the key until done resolves', async () => {
    // All-or-nothing, matching multipart's complete: a reader must never find
    // a half-written recording.
    const { storage, key, upload } = await openUpload()
    upload.write(Buffer.from('partial'))
    expect(await storage.get(key)).toBeNull()
    await upload.done()
    expect(await storage.get(key)).not.toBeNull()
  })

  it('abort discards everything, leaving no object and no temp file', async () => {
    const { storage, key, upload } = await openUpload()
    upload.write(Buffer.from('discard me'))
    await upload.abort()
    expect(await storage.get(key)).toBeNull()
    // The temp file lives beside the target; the directory should be empty.
    const dir = join(mockEnv.env.STORAGE_LOCAL_DIR, 'audio/deck')
    expect(await readdir(dir)).toEqual([])
  })

  it('reports back-pressure once the buffer is full', async () => {
    // `write` returning false is what the audio socket keys off; if it always
    // returned true the buffer would grow without bound.
    const { upload } = await openUpload()
    let sawBackPressure = false
    for (let i = 0; i < 64 && !sawBackPressure; i++) {
      sawBackPressure = !upload.write(Buffer.alloc(256 * 1024))
    }
    expect(sawBackPressure).toBe(true)
    await upload.abort()
  })
})

describe('s3 createUploadStream', () => {
  const openUpload = async () => {
    mockEnv.env.STORAGE_PROVIDER = 's3'
    mockEnv.env.S3_BUCKET = 'slide-machine'
    mockEnv.env.S3_ENDPOINT = 'https://nyc3.digitaloceanspaces.com'
    const { getStorage } = await import('./index')
    const upload = await getStorage().createUploadStream(
      'audio/deck/take.pcm',
      'audio/L16',
    )
    const input = uploadMock.ctor.mock.calls[0]![0] as {
      params: {
        Bucket: string
        Key: string
        ContentType: string
        Body: PassThrough
      }
      partSize: number
      queueSize: number
    }
    return { upload, input }
  }

  it('configures a bounded multipart upload', async () => {
    const { input } = await openUpload()
    expect(input.params.Bucket).toBe('slide-machine')
    expect(input.params.Key).toBe('audio/deck/take.pcm')
    expect(input.params.ContentType).toBe('audio/L16')
    // 5 MiB is S3's floor for every non-final part — going below breaks
    // multipart outright; queueSize is what bounds in-flight memory.
    expect(input.partSize).toBe(5 * 1024 * 1024)
    expect(input.queueSize).toBe(2)
  })

  it('ends the body and awaits completion on done', async () => {
    const { upload, input } = await openUpload()
    upload.write(Buffer.from('hi'))
    await upload.done()
    expect(input.params.Body.writableEnded).toBe(true)
    expect(uploadMock.done).toHaveBeenCalled()
  })

  it('aborts the upload so uploaded parts cannot linger', async () => {
    // Orphaned parts bill invisibly and never show in object listings.
    send.mockResolvedValue({ Uploads: [] })
    const { upload } = await openUpload()
    upload.write(Buffer.from('hi'))
    await upload.abort()
    expect(uploadMock.abort).toHaveBeenCalledTimes(1)
  })

  it('sweeps a multipart upload that abort left behind', async () => {
    // Verified against DO Spaces: Upload.abort() returns without removing the
    // upload, so without this sweep the parts stay and bill silently.
    send.mockImplementation((command: { __type?: string }) =>
      Promise.resolve(
        command.__type === 'ListMultipartUploads'
          ? {
              Uploads: [
                { Key: 'audio/deck/take.pcm', UploadId: 'upload-1' },
                { Key: 'audio/deck/other.pcm', UploadId: 'upload-2' },
              ],
            }
          : {},
      ),
    )
    const { upload } = await openUpload()
    upload.write(Buffer.from('hi'))
    await upload.abort()

    const aborts = send.mock.calls
      .map(([c]) => c as { __type?: string; input?: { UploadId?: string } })
      .filter(c => c.__type === 'AbortMultipartUpload')
    // Only this key's upload — never another session's.
    expect(aborts).toHaveLength(1)
    expect(aborts[0]!.input?.UploadId).toBe('upload-1')
  })
})

describe('storage healthCheck', () => {
  it('reports ok for local disk without probing', async () => {
    const { getStorage } = await import('./index')
    expect(await getStorage().healthCheck()).toEqual({
      status: 'ok',
      detail: 'local disk',
    })
  })

  it('reports ok with a vendor-neutral detail when HeadBucket succeeds', async () => {
    mockEnv.env.STORAGE_PROVIDER = 's3'
    mockEnv.env.S3_ENDPOINT = 'https://nyc3.digitaloceanspaces.com'
    mockEnv.env.S3_BUCKET = 'slide-machine'
    send.mockResolvedValue({})

    const { getStorage } = await import('./index')
    const res = await getStorage().healthCheck()

    expect(res.status).toBe('ok')
    // No provider/endpoint leaks into the detail.
    expect(res.detail).toBe('connected')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('reports down when HeadBucket rejects', async () => {
    mockEnv.env.STORAGE_PROVIDER = 's3'
    mockEnv.env.S3_ENDPOINT = 'https://nyc3.digitaloceanspaces.com'
    send.mockRejectedValue(
      Object.assign(new Error('missing'), { name: 'NotFound' }),
    )

    const { getStorage } = await import('./index')
    const res = await getStorage().healthCheck()

    expect(res.status).toBe('down')
    expect(res.detail).toBe('unreachable')
  })
})
