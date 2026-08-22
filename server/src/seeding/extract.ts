/**
 * Baseline seed-content extraction (SEED-1/SEED-2): PDFs, DOCX, and
 * plain-text files yield text; DOCX embedded photos become their own
 * image assets; uploaded images become photo assets directly. Runs
 * fire-and-forget after the upload response, never throws to the
 * caller, and marks the asset 'failed' quietly on any error. The AI
 * tier (ai-extract.ts) layers on when GEMINI_API_KEY exists: vision
 * captions/keywords for photos and OCR for scanned PDFs; without a key
 * the baseline stands unchanged.
 */
import AdmZip from 'adm-zip'
import mammoth from 'mammoth'
import { extractText, getDocumentProxy } from 'unpdf'
import { SeedAssetModel, type SeedAssetDb } from '../models/seed-asset'
import { describeImage, ocrPdf } from './ai-extract'
import { getStorage } from '../storage'
import type { HydratedDocument } from 'mongoose'

/** Extracted text is context, not an archive — keep it bounded. */
const MAX_TEXT_CHARS = 100_000
/** Ignore tiny embedded images (bullets, logos, borders). */
const MIN_EMBEDDED_IMAGE_BYTES = 10_240
const MAX_EMBEDDED_IMAGES = 12

const IMAGE_EXTENSIONS: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

/** Below this much embedded text, a PDF is treated as scanned and the
 * AI tier (when a key exists) is asked to read it instead. */
export const SCANNED_PDF_TEXT_THRESHOLD = 64

/** Filename → keyword tokens ("cell-membrane_2.png" → cell, membrane). */
export const keywordsFromName = (name: string): string[] =>
  name
    .replace(/\.[a-z0-9]+$/i, '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(word => word.length > 2)

const pdfText = async (buffer: Buffer): Promise<string> => {
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  const { text } = await extractText(pdf, { mergePages: true })
  return text
}

/** Plain text arrives ready to use; only the stray BOM needs removing. */
const plainText = (buffer: Buffer): string =>
  buffer.toString('utf8').replace(/^\ufeff/, '')

const docxText = async (buffer: Buffer): Promise<string> => {
  const { value } = await mammoth.extractRawText({ buffer })
  return value
}

/** DOCX files are zips; photos live under word/media. Each becomes its
 * own image asset so enrichment can use them individually. */
const extractDocxImages = async (
  parent: HydratedDocument<SeedAssetDb>,
  buffer: Buffer,
): Promise<void> => {
  const storage = getStorage()
  const entries = new AdmZip(buffer)
    .getEntries()
    .filter(e => e.entryName.startsWith('word/media/'))
    .filter(e => {
      const ext = e.entryName.split('.').pop()?.toLowerCase() ?? ''
      return (
        ext in IMAGE_EXTENSIONS && e.header.size >= MIN_EMBEDDED_IMAGE_BYTES
      )
    })
    .slice(0, MAX_EMBEDDED_IMAGES)

  for (const entry of entries) {
    const fileName = entry.entryName.split('/').pop()!
    const ext = fileName.split('.').pop()!.toLowerCase()
    const child = await SeedAssetModel.create({
      projectId: parent.projectId,
      deckId: parent.deckId,
      type: 'image',
      name: `${parent.name} — ${fileName}`,
      status: 'processing',
      keywords: keywordsFromName(parent.name),
    })
    const key = `seed/${child._id.toString()}/${fileName}`
    const bytes = entry.getData()
    await storage.put(key, bytes, IMAGE_EXTENSIONS[ext]!)
    child.storageKey = key
    child.imageUrl = storage.publicUrl(key)
    // AI tier: caption the embedded photo (quietly skipped without a key)
    const described = await describeImage(bytes, IMAGE_EXTENSIONS[ext]!)
    if (described) {
      child.caption = described.caption
      child.keywords = [...new Set([...child.keywords, ...described.keywords])]
    }
    child.status = 'ready'
    await child.save()
  }
}

/**
 * Fire-and-forget processing of a freshly uploaded asset. The upload
 * response has already been sent when this runs.
 */
export const processSeedAsset = async (
  assetId: string,
  buffer: Buffer,
  mimeType: string,
): Promise<void> => {
  const asset = await SeedAssetModel.findById(assetId).catch(() => null)
  if (!asset) return
  try {
    if (mimeType === 'application/pdf') {
      let text = (await pdfText(buffer)).trim()
      // Scanned PDFs have no text layer; the AI tier reads the pages
      if (text.length < SCANNED_PDF_TEXT_THRESHOLD) {
        text = (await ocrPdf(buffer)) ?? text
      }
      asset.text = text.slice(0, MAX_TEXT_CHARS)
    } else if (mimeType === 'text/plain') {
      asset.text = plainText(buffer).slice(0, MAX_TEXT_CHARS)
    } else if (mimeType.startsWith('image/')) {
      // The upload route already stored the binary and set imageUrl
      asset.keywords = [
        ...new Set([...asset.keywords, ...keywordsFromName(asset.name)]),
      ]
      // AI tier: vision caption + search keywords (quietly skipped
      // without a key); user-entered captions are never overwritten
      const described = await describeImage(buffer, mimeType)
      if (described) {
        asset.caption ??= described.caption
        asset.keywords = [
          ...new Set([...asset.keywords, ...described.keywords]),
        ]
      }
    } else {
      // DOCX: text plus any embedded photos worth keeping
      asset.text = (await docxText(buffer)).slice(0, MAX_TEXT_CHARS)
      await extractDocxImages(asset, buffer)
    }
    asset.status = 'ready'
    await asset.save()
  } catch (error) {
    // Extraction must never surface as an error anywhere (SEED-1)
    console.warn('Seed extraction failed:', error)
    await SeedAssetModel.updateOne(
      { _id: assetId },
      { status: 'failed' },
    ).catch(() => undefined)
  }
}
