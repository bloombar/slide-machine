/**
 * Unit tests for the storage health probe on both adapters. The S3 client
 * is stubbed so `HeadBucket` reachability is exercised without a live
 * endpoint; each case re-imports the module so the lazy provider singleton
 * picks up the test's STORAGE_PROVIDER.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

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

describe('storage healthCheck', () => {
  it('reports ok for local disk without probing', async () => {
    const { getStorage } = await import('./index')
    expect(await getStorage().healthCheck()).toEqual({
      status: 'ok',
      detail: 'local disk',
    })
  })

  it('reports ok and the endpoint host when HeadBucket succeeds', async () => {
    mockEnv.env.STORAGE_PROVIDER = 's3'
    mockEnv.env.S3_ENDPOINT = 'https://nyc3.digitaloceanspaces.com'
    mockEnv.env.S3_BUCKET = 'slide-machine'
    send.mockResolvedValue({})

    const { getStorage } = await import('./index')
    const res = await getStorage().healthCheck()

    expect(res.status).toBe('ok')
    expect(res.detail).toBe('s3 (nyc3.digitaloceanspaces.com)')
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
    expect(res.detail).toBe('NotFound')
  })
})
