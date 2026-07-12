/**
 * Gemini GenerationProvider (GEN-1/GEN-2/GEN-6/GEN-7/GEN-8): one
 * structured-output call per finalized phrase. The prompt carries the
 * template's layout descriptors as the only allowed option set, both
 * seed-context layers (the lecture's outranking the project's), the
 * rolling slide context, and any seeded images the model may select.
 * The response is forced to JSON by responseSchema and still validated
 * with zod before it touches the pipeline — a confused model must never
 * produce a malformed slide.
 *
 * Selected via GENERATION_PROVIDER=gemini; the mock stays the default
 * for tests and CI.
 */
import { z } from 'zod'
import type {
  GenerationProvider,
  SlideGenerationRequest,
  SlideGenerationResult,
  LayoutType,
} from '@slide-machine/shared'
import { env } from '../config/env'
import { registry } from './registry'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

/** The exact output contract, spelled out in the prompt. We ask for
 * JSON via responseMimeType but deliberately do NOT send a
 * responseSchema: constrained decoding sends current Gemini models
 * into degenerate repetition loops, while prompt-specified JSON stays
 * clean — and zod validates everything server-side regardless. */
const OUTPUT_SHAPE = `{
  "action": "new" | "update" | "none",
  "layoutType": "<one of the layout types offered below>",
  "slots": { "title"?: string, "body"?: string, "bullets"?: string[], "caption"?: string },
  "imageGuidance"?: { "keywords": string[], "seededImageId"?: string, "none"?: boolean }
}`

/** Server-side validation of what the model claims (never trust it). */
const resultSchema = z.object({
  action: z.enum(['new', 'update', 'none']),
  layoutType: z.string(),
  slots: z
    .object({
      title: z.string().optional(),
      body: z.string().optional(),
      bullets: z.array(z.string()).optional(),
      caption: z.string().optional(),
    })
    .default({}),
  imageGuidance: z
    .object({
      keywords: z.array(z.string()).default([]),
      seededImageId: z.string().optional(),
      none: z.boolean().optional(),
    })
    .optional(),
})

/** The content-freedom policy for a 1-10 setting: the number anchors a
 * gradient, the band text makes it operational for the model. */
const freedomPolicy = (level: number): string => {
  const n = Math.min(10, Math.max(1, Math.round(level)))
  const band =
    n <= 2
      ? `Slide content must come ONLY from what the speaker explicitly said in this phrase. Titles must reuse the speaker's own words. Reword minimally for presentation style; NEVER add topics, themes, examples, facts, terminology, or details the speaker did not say. When the phrase is thin, make a thin slide.`
      : n <= 4
        ? `Slide content must come from what the speaker said. Reword freely for concision, but do not add topics, themes, examples, or facts the speaker did not mention.`
        : n <= 6
          ? `Stay within what the speaker said. You may add a short clarifying connective or complete an obviously truncated thought, but do not introduce new topics, themes, or examples.`
          : n <= 8
            ? `You may lightly enrich slides with closely related supporting details consistent with the speaker's point and the seed context, keeping the speaker's actual content primary.`
            : `You may elaborate freely around the speaker's point, drawing on the seed context and general knowledge, while making sure everything the speaker said is represented.`
  return `CONTENT FREEDOM ${n}/10 (1 = only what was said, 10 = free elaboration): ${band}`
}

const instructions = (req: SlideGenerationRequest): string => {
  const layouts = req.layoutDescriptors
    .map(
      d =>
        `- "${d.type}" (${d.label}): ${d.purpose}. Slots: ${d.slots.join(', ')}${
          d.constraints ? `. Constraints: ${JSON.stringify(d.constraints)}` : ''
        }`,
    )
    .join('\n')

  const seeded = req.seededImages?.length
    ? `\nInstructor-provided images (set imageGuidance.seededImageId to an id ONLY when one clearly fits the slide):\n${req.seededImages
        .map(
          i => `- id "${i.id}": ${i.caption ?? ''} [${i.keywords.join(', ')}]`,
        )
        .join('\n')}`
    : ''

  const projectSeed = req.seedContext?.project
    ? `\nCourse background (general):\n${req.seedContext.project}`
    : ''
  const deckSeed = req.seedContext?.deck
    ? `\nThis lecture's plan (more specific — prefer over course background):\n${req.seedContext.deck}`
    : ''

  const rolling = req.rollingContext.length
    ? `\nRecent slides, oldest to newest (the LAST one is the current slide):\n${req.rollingContext
        .map((s, i) => `${i + 1}. ${s}`)
        .join('\n')}`
    : '\nNo slides exist yet.'

  const capacity = req.currentSlide
    ? `\nCurrent slide load: ${req.currentSlide.bulletCount} bullets, ~${req.currentSlide.bodyWords} body words (layout "${req.currentSlide.layoutType}"). If adding this phrase's content would exceed the layout's limits, choose "new" instead of "update".`
    : ''

  return `You turn live lecture speech into presentation slides, one decision per spoken phrase.

Respond with ONLY one JSON object, no markdown fences, exactly this shape:
${OUTPUT_SHAPE}

${freedomPolicy(req.freedom ?? 3)}

Decide exactly one action for the new phrase:
- "none": filler, asides, or classroom logistics — changes nothing.
- "update": ONLY when the phrase adds a SMALL amount (one bullet or one short sentence) to the CURRENT (last) slide's exact topic AND the slide has room left. Put ONLY the added material in slots; never repeat existing content.
- "new": the phrase starts new material, shifts the angle, or the current slide is already comfortably full — produce a complete slide. Prefer "new" whenever in doubt: many small slides beat one crowded slide.

Choose layoutType strictly from this set:
${layouts}

Slide text must be concise and presentation-ready: tight bullets, no filler words, no first person. Constraints list APPROXIMATE WORD BUDGETS (maxTitleWords, maxBodyWords, maxBulletWords, maxCaptionWords, maxBullets) — never exceed them; the server rejects overloaded slides.

For imageGuidance: 2-4 concrete search keywords when an illustrative photo would help; set none=true for text-only slides (title/section/quote usually).${seeded}
${projectSeed}${deckSeed}
${rolling}${capacity}

New phrase: "${req.phrase}"`
}

export class GeminiGenerationProvider implements GenerationProvider {
  readonly name = 'gemini'

  async generateSlideContent(
    req: SlideGenerationRequest,
  ): Promise<SlideGenerationResult> {
    if (!env.GEMINI_API_KEY) {
      throw new Error('GENERATION_PROVIDER=gemini requires GEMINI_API_KEY')
    }

    const res = await fetch(
      `${API_BASE}/models/${env.GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: instructions(req) }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.4,
            // Slides are short (the budget includes thinking tokens);
            // this also hard-stops degenerate loops
            maxOutputTokens: 2048,
          },
        }),
        signal: AbortSignal.timeout(env.GEMINI_TIMEOUT_MS),
      },
    )
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(
        `Gemini request failed (${res.status}): ${detail.slice(0, 300)}`,
      )
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) throw new Error('Gemini returned no candidate text')

    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      throw new Error('Gemini returned unparseable JSON')
    }
    const parsed = resultSchema.parse(raw)

    // The model must pick from the offered layouts; drift falls back to
    // the closest sane default rather than crashing the live session
    const allowed = new Set(req.layoutDescriptors.map(d => d.type))
    const layoutType = (
      allowed.has(parsed.layoutType as LayoutType)
        ? parsed.layoutType
        : allowed.has('content')
          ? 'content'
          : (req.layoutDescriptors[0]?.type ?? 'content')
    ) as LayoutType

    // Seeded-image ids likewise must be ones we offered
    const seededIds = new Set(req.seededImages?.map(i => i.id) ?? [])
    const guidance = parsed.imageGuidance
    return {
      action: parsed.action,
      layoutType,
      slots: parsed.slots,
      imageGuidance: guidance
        ? {
            keywords: guidance.keywords.slice(0, 6),
            seededImageId:
              guidance.seededImageId && seededIds.has(guidance.seededImageId)
                ? guidance.seededImageId
                : undefined,
            none: guidance.none,
          }
        : undefined,
    }
  }
}

registry.register('generation', 'gemini', () => new GeminiGenerationProvider())
