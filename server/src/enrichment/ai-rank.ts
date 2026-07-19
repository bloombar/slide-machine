/**
 * AI re-rank + caption reconciliation (IMG-1). Given a slide's content and a
 * shortlist of image candidates, one Gemini call (a) picks the candidate that
 * best fits the slide and (b) writes a caption that matches THAT image, so the
 * visible caption and the sourced picture agree (they are otherwise authored
 * at different times — caption blind, image afterward).
 *
 * Text-only by default (candidate metadata), fast enough to finish inside the
 * client's image poll. `IMAGE_RERANK_VISION` additionally sends candidate
 * thumbnails so the model judges visually — more accurate, slower, hence
 * opt-in. Like all enrichment, it is key-gated and NEVER throws: any failure
 * returns null and the caller falls back to heuristic scoring (IMG-2).
 */
import { z } from 'zod'
import { env } from '../config/env'
import type { ImageCandidate, SlideImageContext } from './types'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

/** Per-thumbnail fetch budget in vision mode; a slow image is just skipped. */
const THUMB_TIMEOUT_MS = 2500
/** Skip absurdly large thumbnails so the multimodal payload stays bounded. */
const MAX_THUMB_BYTES = 3_000_000
const IMAGE_MIME = /^image\/(jpeg|png|webp|gif)$/

const replySchema = z.object({
  index: z.coerce.number().int(),
  caption: z.string().optional(),
})

export interface RankResult {
  /** Index into the shortlist handed in — always a valid candidate. */
  index: number
  /** Caption matching the chosen image, if the model wrote one. */
  caption?: string
}

/** Compact, model-facing view of one candidate's metadata. */
const candidateMeta = (c: ImageCandidate, i: number) => ({
  index: i,
  title: c.title || undefined,
  description: c.attribution?.caption || undefined,
  tags: c.tags.length ? c.tags.slice(0, 8) : undefined,
  source: c.source,
  size: c.width && c.height ? `${c.width}x${c.height}` : undefined,
})

/** Fetches a thumbnail as base64 + mime, or null on any problem. */
const fetchThumb = async (
  url: string,
): Promise<{ mimeType: string; data: string } | null> => {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(THUMB_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const mimeType = (res.headers.get('content-type') ?? '')
      .split(';')[0]!
      .trim()
    if (!IMAGE_MIME.test(mimeType)) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (!buf.length || buf.length > MAX_THUMB_BYTES) return null
    return { mimeType, data: buf.toString('base64') }
  } catch {
    return null
  }
}

/** Builds the prompt text: slide context + numbered candidate metadata. */
const promptText = (
  ctx: SlideImageContext,
  candidates: ImageCandidate[],
): string => {
  const slide = {
    title: ctx.title || undefined,
    body: ctx.body || undefined,
    bullets: ctx.bullets?.length ? ctx.bullets : undefined,
    currentCaption: ctx.caption || undefined,
    keywords: ctx.imageKeywords?.length ? ctx.imageKeywords : undefined,
    lectureBackground: ctx.seedContext || undefined,
  }
  const budget = ctx.captionMaxChars ?? 80
  return [
    'You are choosing the best stock image for a lecture slide and writing its caption.',
    '',
    'SLIDE:',
    JSON.stringify(slide),
    '',
    'CANDIDATES (metadata; images may also follow, labeled "Image N"):',
    JSON.stringify(candidates.map(candidateMeta)),
    '',
    `Pick the candidate whose actual subject best matches the slide's meaning. Respond with ONLY one JSON object, no markdown fences: {"index": <the chosen candidate index, or -1 if none fit>, "caption": "<a caption for the chosen image, at most ${budget} characters, describing what the image shows as it relates to the slide; no quotes>"}`,
  ].join('\n')
}

/**
 * Asks Gemini to pick the best candidate and caption it. Returns the chosen
 * shortlist index (+ caption), or null when unavailable / no candidate fits /
 * anything goes wrong — the caller then falls back to heuristic selection.
 */
export const rankAndCaption = async (
  ctx: SlideImageContext,
  candidates: ImageCandidate[],
): Promise<RankResult | null> => {
  if (!env.GEMINI_API_KEY || !env.IMAGE_RERANK_ENABLED) return null
  if (!candidates.length) return null

  const parts: unknown[] = [{ text: promptText(ctx, candidates) }]

  // Vision mode: attach thumbnails, each labeled so the model maps image→index.
  if (env.IMAGE_RERANK_VISION) {
    const thumbs = await Promise.all(candidates.map(c => fetchThumb(c.url)))
    thumbs.forEach((thumb, i) => {
      if (!thumb) return
      parts.push({ text: `Image ${i}:` })
      parts.push({ inlineData: { mimeType: thumb.mimeType, data: thumb.data } })
    })
  }

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
            responseMimeType: 'application/json',
            temperature: 0.2,
            maxOutputTokens: 256,
          },
        }),
        signal: AbortSignal.timeout(env.IMAGE_RERANK_TIMEOUT_MS),
      },
    )
    if (!res.ok) return null
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) return null
    const parsed = replySchema.parse(JSON.parse(text))
    // Out of range (including the model's "-1 = none") → fall back.
    if (parsed.index < 0 || parsed.index >= candidates.length) return null
    const caption = parsed.caption?.trim()
    return { index: parsed.index, caption: caption || undefined }
  } catch {
    // Timeouts, network, bad JSON: heuristic scoring stands (IMG-2).
    return null
  }
}
