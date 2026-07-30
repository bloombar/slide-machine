/**
 * Uploaded-file storage behind one small seam (SEED-1 / TECH-8):
 * 'local' writes to disk and serves via /api/files (dev/test default);
 * 's3' targets any S3-compatible endpoint (MinIO in dev, DO Spaces in
 * prod). Selected by STORAGE_PROVIDER; keys are caller-supplied and
 * already unguessable (uuid-prefixed).
 */
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, normalize } from 'node:path'
import { PassThrough } from 'node:stream'
import {
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListMultipartUploadsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import type { HealthComponent } from '@slide-machine/shared'
import { env } from '../config/env'

/** Bytes per multipart part. 5 MiB is S3's minimum for every part except the
 * last — lowering this breaks multipart uploads outright. */
const UPLOAD_PART_BYTES = 5 * 1024 * 1024
/** Parts in flight at once. Together with the part size this is the ceiling on
 * what one upload can hold in memory (~10 MB), so it is deliberately well
 * below the SDK's default of 4. */
const UPLOAD_QUEUE_SIZE = 2
/** How much unconsumed data an upload stream buffers before `write` reports
 * back-pressure. Explicit because the Node default (16 KB) is far too small to
 * ride out a slow upload, and an unbounded one would defeat the point. */
const UPLOAD_HIGH_WATER_MARK = 1024 * 1024

/**
 * An upload in progress: bytes are handed over as they arrive rather than
 * assembled in memory first, so an object of unknown (or unbounded) length
 * costs a fixed window instead of its full size.
 *
 * Stream-shaped on purpose — multipart parts are an S3 concept, and nothing
 * outside that adapter should have to know about them.
 */
export interface UploadStream {
  /**
   * Appends a chunk. Returns false when the consumer is behind; callers MUST
   * honour that (stop writing, or drop the data) or memory grows without bound
   * again — which is the whole problem this interface exists to solve.
   */
  write(chunk: Buffer): boolean
  /** Finishes the upload; resolves once the object is durable. */
  done(): Promise<void>
  /** Discards everything written — the object never appears at `key`. */
  abort(): Promise<void>
}

export interface FileStorage {
  readonly name: string
  put(key: string, body: Buffer, contentType: string): Promise<void>
  /**
   * Opens a streaming upload for `key`. For callers whose source is a push of
   * unknown total length — a live audio WebSocket — where buffering the whole
   * object first is what causes the memory problem (GEN-4).
   */
  createUploadStream(key: string, contentType: string): Promise<UploadStream>
  get(key: string): Promise<Buffer | null>
  /**
   * Bytes `[start, end)` of an object, without loading the rest. Lets callers
   * read a slice of a large blob — a few seconds out of an hour-long lecture
   * recording — instead of pulling the whole thing into memory (GEN-4).
   * `end` beyond the object simply returns what exists; an empty or
   * unsatisfiable range, a missing object, or any error yields null.
   */
  getRange(key: string, start: number, end: number): Promise<Buffer | null>
  /** URL the browser can load the file from. */
  publicUrl(key: string): string
  delete(key: string): Promise<void>
  /** Liveness probe for the health endpoint. */
  healthCheck(): Promise<HealthComponent>
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
    async createUploadStream(key) {
      const path = join(root, safeKey(key))
      await mkdir(dirname(path), { recursive: true })
      // Write beside the target and rename on completion, so an aborted or
      // crashed upload never leaves a half-written object at the real key —
      // the local stand-in for a multipart upload's all-or-nothing complete.
      const tempPath = `${path}.part-${randomUUID()}`
      const stream = createWriteStream(tempPath, {
        highWaterMark: UPLOAD_HIGH_WATER_MARK,
      })
      const finished = new Promise<void>((resolve, reject) => {
        stream.on('error', reject)
        stream.on('finish', resolve)
      })
      // Marks the rejection handled so an abort can't surface as an unhandled
      // rejection; `done()` still awaits and rethrows it.
      void finished.catch(() => {})
      return {
        write: chunk => stream.write(chunk),
        async done() {
          stream.end()
          await finished
          await rename(tempPath, path)
        },
        async abort() {
          stream.destroy()
          await rm(tempPath, { force: true })
        },
      }
    },
    async getRange(key, start, end) {
      if (end <= start || start < 0) return null
      let handle
      try {
        handle = await open(join(root, safeKey(key)), 'r')
        const buffer = Buffer.alloc(end - start)
        // A short read (range past EOF) is fine: return only what was filled.
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)
        return bytesRead > 0 ? buffer.subarray(0, bytesRead) : null
      } catch {
        return null
      } finally {
        await handle?.close().catch(() => {})
      }
    },
    publicUrl(key) {
      return `/api/files/${safeKey(key)}`
    },
    async delete(key) {
      await rm(join(root, safeKey(key)), { force: true })
    },
    async healthCheck() {
      // Local disk is always available to the running process; nothing to probe.
      return { status: 'ok', detail: 'local disk' }
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

  /**
   * Aborts any multipart upload still open for `key`.
   *
   * `Upload.abort()` alone is NOT sufficient on every S3-compatible provider:
   * verified against DigitalOcean Spaces, the upload stayed listed afterwards.
   * Orphaned parts consume paid storage and never appear in object listings,
   * so nothing surfaces the leak — hence the explicit sweep.
   */
  const abortLingeringUploads = async (key: string): Promise<void> => {
    const listed = await client.send(
      new ListMultipartUploadsCommand({ Bucket: bucket, Prefix: key }),
    )
    await Promise.all(
      (listed.Uploads ?? [])
        .filter(upload => upload.Key === key && upload.UploadId)
        .map(upload =>
          client.send(
            new AbortMultipartUploadCommand({
              Bucket: bucket,
              Key: key,
              UploadId: upload.UploadId,
            }),
          ),
        ),
    )
  }

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
    async createUploadStream(key, contentType) {
      // The source pushes; `Upload` pulls. A PassThrough bridges the two, and
      // its highWaterMark is what makes `write` report back-pressure instead of
      // queueing without limit.
      const body = new PassThrough({ highWaterMark: UPLOAD_HIGH_WATER_MARK })
      const upload = new Upload({
        client,
        params: {
          Bucket: bucket,
          Key: safeKey(key),
          Body: body,
          ContentType: contentType,
          ACL: 'public-read',
        },
        partSize: UPLOAD_PART_BYTES,
        queueSize: UPLOAD_QUEUE_SIZE,
      })
      // Starts consuming immediately; a body smaller than one part becomes a
      // plain PutObject, so short objects never pay multipart's overhead.
      const settled = upload.done()
      void settled.catch(() => {})
      return {
        write: chunk => body.write(chunk),
        async done() {
          body.end()
          await settled
        },
        async abort() {
          body.destroy()
          await upload.abort().catch(() => {})
          // Belt and braces: see abortLingeringUploads. Ending the stream and
          // awaiting done() would also clear the upload, but that COMPLETES it
          // — the object would persist, which is the opposite of an abort and
          // would retain audio we are discarding for lack of permission.
          await abortLingeringUploads(safeKey(key)).catch(() => {})
        },
      }
    },
    async getRange(key, start, end) {
      if (end <= start || start < 0) return null
      try {
        const res = await client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: safeKey(key),
            // HTTP ranges are inclusive on both ends; ours is half-open.
            Range: `bytes=${start}-${end - 1}`,
          }),
        )
        const bytes = await res.Body?.transformToByteArray()
        return bytes?.length ? Buffer.from(bytes) : null
      } catch {
        // Includes 416 when `start` is past the end of the object.
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
    async healthCheck() {
      // Vendor-neutral detail: the health panel names the capability, not
      // the specific object-storage provider/endpoint behind it.
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }))
        return { status: 'ok', detail: 'connected' }
      } catch {
        return { status: 'down', detail: 'unreachable' }
      }
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
