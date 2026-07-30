/**
 * Unit tests for the storage health probe on both adapters. The S3 client
 * is stubbed so `HeadBucket` reachability is exercised without a live
 * endpoint; each case re-imports the module so the lazy provider singleton
 * picks up the test's STORAGE_PROVIDER.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
}))

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
