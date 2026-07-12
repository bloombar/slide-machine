/**
 * Serves locally stored uploads (the 'local' storage adapter's public
 * URLs): GET /api/files/<key>. Keys are uuid-prefixed and unguessable;
 * images must be loadable by <img> for anyone who can view the deck,
 * matching how external enrichment URLs behave. With the 's3' adapter
 * this router is never hit — public URLs point at the bucket.
 */
import { Router } from 'express'
import { HttpError } from '../middleware/error'
import { getStorage } from '../storage'

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

export const filesRouter = Router()

filesRouter.get('/files/*key', async (req, res) => {
  const key = (req.params.key as unknown as string[]).join('/')
  const body = await getStorage().get(key)
  if (!body) throw new HttpError(404, 'not_found', 'File not found')
  const ext = key.split('.').pop()?.toLowerCase() ?? ''
  res.setHeader(
    'Content-Type',
    CONTENT_TYPES[ext] ?? 'application/octet-stream',
  )
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  res.send(body)
})
