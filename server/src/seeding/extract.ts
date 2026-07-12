/**
 * Baseline seed-content extraction (SEED-1/SEED-2): PDFs and DOCX yield
 * text; DOCX embedded photos become their own image assets; uploaded
 * images become photo assets directly. Runs fire-and-forget after the
 * upload response, never throws to the caller, and marks the asset
 * 'failed' quietly on any error. An AI tier (vision captions, OCR)
 * plugs in behind this same function when credentials exist.
 */
import AdmZip from 'adm-zip'
import mammoth from 'mammoth'
import { extractText, getDocumentProxy } from 'unpdf'
import { SeedAssetModel, type SeedAssetDb } from '../models/seed-asset'
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
    await storage.put(key, entry.getData(), IMAGE_EXTENSIONS[ext]!)
    child.storageKey = key
    child.imageUrl = storage.publicUrl(key)
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
      asset.text = (await pdfText(buffer)).slice(0, MAX_TEXT_CHARS)
    } else if (mimeType.startsWith('image/')) {
      // The upload route already stored the binary and set imageUrl
      asset.keywords = [
        ...new Set([...asset.keywords, ...keywordsFromName(asset.name)]),
      ]
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
