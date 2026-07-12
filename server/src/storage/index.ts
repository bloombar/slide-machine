/**
 * Uploaded-file storage behind one small seam (SEED-1 / TECH-8):
 * 'local' writes to disk and serves via /api/files (dev/test default);
 * 's3' targets any S3-compatible endpoint (MinIO in dev, DO Spaces in
 * prod). Selected by STORAGE_PROVIDER; keys are caller-supplied and
 * already unguessable (uuid-prefixed).
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, normalize } from 'node:path'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { env } from '../config/env'

export interface FileStorage {
  readonly name: string
  put(key: string, body: Buffer, contentType: string): Promise<void>
  get(key: string): Promise<Buffer | null>
  /** URL the browser can load the file from. */
  publicUrl(key: string): string
  delete(key: string): Promise<void>
}

/** Rejects traversal — keys are internal, but never trust a path. */
const safeKey = (key: string): string => {
  const normalized = normalize(key)
  if (normalized.startsWith('..') || normalized.startsWith('/')) {
    throw new Error(`Unsafe storage key: ${key}`)
  }
  return normalized
}

const localStorageProvider = (): FileStorage => {
  const root = env.STORAGE_LOCAL_DIR
  return {
    name: 'local',
    async put(key, body) {
      const path = join(root, safeKey(key))
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, body)
    },
    async get(key) {
      try {
        return await readFile(join(root, safeKey(key)))
      } catch {
        return null
      }
    },
    publicUrl(key) {
      return `/api/files/${safeKey(key)}`
    },
    async delete(key) {
      await rm(join(root, safeKey(key)), { force: true })
    },
  }
}

const s3StorageProvider = (): FileStorage => {
  const client = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION ?? 'us-east-1',
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
    },
  })
  const bucket = env.S3_BUCKET ?? 'slide-machine'
  const base = env.S3_PUBLIC_BASE_URL ?? `${env.S3_ENDPOINT ?? ''}/${bucket}`
  return {
    name: 's3',
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: safeKey(key),
          Body: body,
          ContentType: contentType,
          ACL: 'public-read',
        }),
      )
    },
    async get(key) {
      try {
        const res = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: safeKey(key) }),
        )
        const bytes = await res.Body?.transformToByteArray()
        return bytes ? Buffer.from(bytes) : null
      } catch {
        return null
      }
    },
    publicUrl(key) {
      return `${base}/${safeKey(key)}`
    },
    async delete(key) {
      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: safeKey(key) }),
      )
    },
  }
}

let instance: FileStorage | undefined

/** The configured storage adapter (lazily created singleton). */
export const getStorage = (): FileStorage => {
  instance ??=
    env.STORAGE_PROVIDER === 's3' ? s3StorageProvider() : localStorageProvider()
  return instance
}
