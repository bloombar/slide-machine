/**
 * Spoken narration of a slide's content via Gemini (IMG-1-style hand-rolled
 * fetch). Used by the TTS route only when a slide has no stored transcript to
 * read during whole-deck playback: rather than reading terse slide fragments,
 * the model turns them into a natural few-sentence narration. Key-gated and
 * NEVER throws — a null return makes the route fall back to the raw content.
 */
import { env } from '../config/env'
import {
  meterGeminiUsage,
  type GeminiUsageMetadata,
} from '../providers/usage-metadata'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

/**
 * Returns a natural spoken narration of the slide content, or null when
 * unavailable (no key, empty input, or any failure).
 */
export const narrateSlide = async (
  contentText: string,
  languageCode: string,
): Promise<string | null> => {
  if (!env.GEMINI_API_KEY || !contentText.trim()) return null
  const prompt = `Turn the following lecture slide into a natural, concise spoken narration (2-4 sentences) as if a lecturer were presenting it aloud. Write in the language with IETF tag "${languageCode}". Output ONLY the narration text — no markdown, no preamble.\n\nSlide:\n${contentText}`
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
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 400 },
        }),
        signal: AbortSignal.timeout(env.GEMINI_TIMEOUT_MS),
      },
    )
    if (!res.ok) return null
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      usageMetadata?: GeminiUsageMetadata
    }
    // Charged to whoever the caller put in the usage context — the deck's
    // owner, since this narration is part of producing their lecture.
    await meterGeminiUsage(data.usageMetadata)
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null
  } catch {
    return null
  }
}
