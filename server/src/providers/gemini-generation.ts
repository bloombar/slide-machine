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
import { isVoiceCommand } from '@slide-machine/shared'
import { env } from '../config/env'
import { registry } from './registry'
import { freedomPolicy, renderGenerationPrompt } from './prompt-templates'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

/** The exact output contract, spelled out in the prompt. We ask for
 * JSON via responseMimeType but deliberately do NOT send a
 * responseSchema: constrained decoding sends current Gemini models
 * into degenerate repetition loops, while prompt-specified JSON stays
 * clean — and zod validates everything server-side regardless. The
 * "command" action exists only when the request offers voice commands
 * (GENERATION_VOICE_COMMANDS). */
const outputShape = (
  withCommands: boolean,
  withRefit: boolean,
  withDeckTitle: boolean,
): string => `{
  "action": "new" | "update" | "none"${withCommands ? ' | "command"' : ''},
  "layoutType": "<one of the layout types offered below>",
  "slots": { "title"?: string, "body"?: string, "bullets"?: string[], "caption"?: string },
  "imageGuidance"?: { "keywords": string[], "seededImageId"?: string, "none"?: boolean }${
    withRefit ? ',\n  "updateMode"?: "delta" | "refit"' : ''
  }${withCommands ? ',\n  "command"?: "<a command id from the list below>"' : ''}${
    withDeckTitle ? ',\n  "deckTitle"?: string' : ''
  }
}`

/** A command claim, validated separately: the model may (reasonably)
 * omit layoutType/slots when it picks "command", so it must not be
 * forced through the content schema. */
const commandClaimSchema = z.object({
  action: z.literal('command'),
  command: z.string().optional(),
})

/** Server-side validation of what the model claims (never trust it). */
const resultSchema = z.object({
  action: z.enum(['new', 'update', 'none']),
  updateMode: z.enum(['delta', 'refit']).optional(),
  // Models legitimately omit this on "none" and delta-update decisions
  // (the layout isn't changing); drift correction fills it in
  layoutType: z.string().optional(),
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
  deckTitle: z.string().optional(),
})

const instructions = (req: SlideGenerationRequest): string => {
  const layouts = req.layoutDescriptors
    .map(d => {
      const slots = d.slots
        .map(s => (s.maxChars ? `${s.name} (max ${s.maxChars} chars)` : s.name))
        .join(', ')
      return `- "${d.type}" (${d.label}): ${d.purpose}. Slots: ${slots}${
        d.constraints ? `. Constraints: ${JSON.stringify(d.constraints)}` : ''
      }`
    })
    .join('\n')

  const seededImages = req.seededImages?.length
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
    ? `\nCurrent slide load: ${req.currentSlide.bulletCount} bullets, ~${req.currentSlide.bodyChars} body characters (layout "${req.currentSlide.layoutType}"). If adding this phrase's content would exceed the layout's limits, choose "new" instead of "update".`
    : ''

  // Update semantics + the slide's exact content, present only when
  // layout re-fit is allowed (GEN-8): "delta" stays cheap (added
  // material only); "refit" pays for the complete re-mapped slide only
  // when the layout actually changes
  const updateRules =
    req.allowLayoutRefit && req.currentSlide?.content
      ? `\nFor "update", also set "updateMode":
- "delta": adds a small amount; slots contain ONLY the added material. Keep layoutType "${req.currentSlide.layoutType}" unless another layout still displays every slot this slide uses.
- "refit": the slide's combined content now fits a different layout better (e.g. prose grown into an enumeration fits "list"); slots must contain the COMPLETE slide re-mapped to the new layout — every existing point preserved plus the added material, reworded only as the new slots require.
Current slide content: ${JSON.stringify(req.currentSlide.content)}`
      : ''

  // A fourth action bullet, present only when commands are offered:
  // the bar is deliberately high — a wrong "command" hijacks the deck
  // mid-lecture, while a missed one merely adds a slide
  const voiceCommands = req.voiceCommands?.length
    ? `\n- "command": ONLY when the phrase is unmistakably the speaker operating the slide system rather than lecturing (e.g. "let's move on to the next slide", "go back one"). Set "command" to one id from the list below and leave slots empty. If the phrase could plausibly be lecture content, do NOT choose "command".\nCommand ids:\n${req.voiceCommands
        .map(c => `- "${c.id}": ${c.description}`)
        .join('\n')}`
    : ''

  // Untitled lecture: ask for a title alongside the slide decision;
  // the server stops asking once one is saved
  const deckTitle = req.suggestDeckTitle
    ? '\nThe lecture itself has no title yet. Once — and ONLY once — the speech and context give you a clear sense of the lecture topic, ALSO set "deckTitle": a concise lecture title (under 60 characters, no quotes). If the topic is not yet clear, omit deckTitle; you will be asked again.'
    : ''

  // Resolved language cascade (lecture ?? project ?? profile ??
  // browser tag); absent = the model mirrors the speech
  const language = req.language
    ? ` Write ALL slide text in the language with IETF tag "${req.language}", regardless of the language spoken.`
    : ''

  return renderGenerationPrompt({
    outputShape: outputShape(
      Boolean(req.voiceCommands?.length),
      Boolean(req.allowLayoutRefit && req.currentSlide?.content),
      Boolean(req.suggestDeckTitle),
    ),
    deckTitle,
    updateRules,
    voiceCommands,
    freedomPolicy: freedomPolicy(req.freedom ?? 3),
    layouts,
    seededImages,
    projectSeed,
    deckSeed,
    rolling,
    capacity,
    language,
    phrase: req.phrase,
  })
}

export class GeminiGenerationProvider implements GenerationProvider {
  readonly name = 'gemini'

  async generateSlideContent(
    req: SlideGenerationRequest,
  ): Promise<SlideGenerationResult> {
    if (!env.GEMINI_API_KEY) {
      throw new Error('GENERATION_PROVIDER=gemini requires GEMINI_API_KEY')
    }

    const prompt = instructions(req)
    if (env.GENERATION_LOG_PROMPTS) {
      console.log(
        `\n===== GENERATION PROMPT (${env.GEMINI_MODEL}) =====\n${prompt}\n===== END PROMPT =====`,
      )
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
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
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
      // Keep the whole body: the quota metric name (e.g. "...PerDay...")
      // and RetryInfo sit at the end, so callers can tell a daily cap from
      // a transient one and honor the server's retry delay.
      throw new Error(
        `Gemini request failed (${res.status}): ${detail.slice(0, 2000)}`,
      )
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (env.GENERATION_LOG_PROMPTS) {
      console.log(
        `===== GENERATION RESPONSE =====\n${text ?? '(no candidate text)'}\n===== END RESPONSE =====`,
      )
    }
    if (!text) throw new Error('Gemini returned no candidate text')

    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      throw new Error('Gemini returned unparseable JSON')
    }
    // A "command" claim is validated on its own (the model may omit
    // content fields) and honored only when commands were offered AND
    // the id is one we listed; anything else is treated as filler —
    // never guess at a command mid-lecture
    const claim = commandClaimSchema.safeParse(raw)
    if (claim.success) {
      const offered = new Set(req.voiceCommands?.map(c => c.id) ?? [])
      const { command } = claim.data
      return isVoiceCommand(command) && offered.has(command)
        ? { action: 'command', command, layoutType: 'content', slots: {} }
        : { action: 'none', layoutType: 'content', slots: {} }
    }

    const parsed = resultSchema.parse(raw)

    // The model must pick from the offered layouts; a missing or
    // drifted claim falls back to the closest sane default rather than
    // crashing the live session — for updates, the slide's own layout
    const allowed = new Set(req.layoutDescriptors.map(d => d.type))
    const layoutType = (
      parsed.layoutType && allowed.has(parsed.layoutType as LayoutType)
        ? parsed.layoutType
        : parsed.action === 'update' && req.currentSlide
          ? req.currentSlide.layoutType
          : allowed.has('content')
            ? 'content'
            : (req.layoutDescriptors[0]?.type ?? 'content')
    ) as LayoutType

    // Seeded-image ids likewise must be ones we offered
    const seededIds = new Set(req.seededImages?.map(i => i.id) ?? [])
    const guidance = parsed.imageGuidance
    return {
      action: parsed.action,
      // An updateMode claim only counts when refit was actually offered
      updateMode:
        req.allowLayoutRefit && parsed.action === 'update'
          ? parsed.updateMode
          : undefined,
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
      // A title claim only counts when we asked for one
      deckTitle:
        req.suggestDeckTitle && parsed.deckTitle?.trim()
          ? parsed.deckTitle.trim().slice(0, 80)
          : undefined,
    }
  }
}

registry.register('generation', 'gemini', () => new GeminiGenerationProvider())
