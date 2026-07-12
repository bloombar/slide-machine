/**
 * The AI tier of seed-content extraction (SEED-1/SEED-2), layered on
 * top of the keyless baseline in extract.ts:
 *
 * - describeImage: Gemini vision captions + search keywords for photo
 *   assets, so enrichment matching doesn't depend on filenames.
 * - ocrPdf: full-text extraction for scanned PDFs whose embedded text
 *   layer is empty (the baseline parser finds nothing to extract).
 *
 * Both are gated on GEMINI_API_KEY and NEVER throw — extraction must
 * stay fault-tolerant, so every failure returns null and the baseline
 * result stands.
 */
import { z } from 'zod'
import { env } from '../config/env'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'
/** Media calls are off the critical path; allow more than generation. */
const AI_EXTRACT_TIMEOUT_MS = 30_000

const imageSchema = z.object({
  caption: z.string().min(1),
  keywords: z.array(z.string().min(1)).min(1).max(8),
})

export interface ImageDescription {
  caption: string
  keywords: string[]
}

const generate = async (
  parts: unknown[],
  jsonOutput: boolean,
): Promise<string | null> => {
  if (!env.GEMINI_API_KEY) return null
  try {
    const res = await fetch(
      `${API_BASE}/models/${env.GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            ...(jsonOutput ? { responseMimeType: 'application/json' } : {}),
            temperature: 0.2,
            maxOutputTokens: 4096,
          },
        }),
        signal: AbortSignal.timeout(AI_EXTRACT_TIMEOUT_MS),
      },
    )
    if (!res.ok) return null
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null
  } catch {
    // Timeouts, network failures: the baseline result stands
    return null
  }
}

/** Captions a photo and proposes enrichment keywords, or null. */
export const describeImage = async (
  image: Buffer,
  mimeType: string,
): Promise<ImageDescription | null> => {
  const text = await generate(
    [
      {
        text: `Describe this image for a lecture slide library. Respond with ONLY one JSON object, no markdown fences: {"caption": "<one concise sentence>", "keywords": ["3-6 concrete search terms"]}`,
      },
      { inlineData: { mimeType, data: image.toString('base64') } },
    ],
    true,
  )
  if (!text) return null
  try {
    const parsed = imageSchema.parse(JSON.parse(text))
    return {
      caption: parsed.caption.trim(),
      keywords: parsed.keywords.map(k => k.trim().toLowerCase()),
    }
  } catch {
    return null
  }
}

/** Extracts the text of a scanned PDF via the model, or null. */
export const ocrPdf = async (pdf: Buffer): Promise<string | null> => {
  const text = await generate(
    [
      {
        text: 'Extract ALL text content from this document, in reading order. Output the text only — no commentary, no formatting markers.',
      },
      {
        inlineData: {
          mimeType: 'application/pdf',
          data: pdf.toString('base64'),
        },
      },
    ],
    false,
  )
  const trimmed = text?.trim()
  return trimmed ? trimmed : null
}
