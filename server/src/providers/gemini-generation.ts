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
 * Active when GENERATION_PROVIDER=gemini, and the call requires
 * GEMINI_API_KEY — without it each request throws rather than degrading.
 * Other provider values select a different adapter (e.g. the mock used by
 * tests and keyless runs).
 */
import { z } from 'zod'
import type {
  GenerationProvider,
  SlideGenerationRequest,
  SlideGenerationResult,
  SlideReformatRequest,
  SlideReformatResult,
  SlideRefineRequest,
  SlideRefineResult,
  SlideNarrateRequest,
  SlideNarrateResult,
  SlideRefitRequest,
  SlideRefitResult,
  RefitSlotDescriptor,
  LayoutType,
} from '@slide-machine/shared'
import { isVoiceCommand, WHITEBOARD_LAYOUT_TYPE } from '@slide-machine/shared'
import type { HealthComponent } from '@slide-machine/shared'
import { env } from '../config/env'
import { registry } from './registry'
import { meterGeminiUsage, type GeminiUsageMetadata } from './usage-metadata'
import { GenerationUnavailableError } from './errors'
import { freedomPolicy, renderGenerationPrompt } from './prompt-templates'
import {
  renderRefinePrompt,
  renderNarratePrompt,
  renderReformatPrompt,
  renderRefitPrompt,
} from './refine-prompts'

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
      // Image generation (IMG-4) is not supported yet: the prompt never
      // offers it, and any stray "generate" key the model invents is
      // stripped here — so the app can never be told to generate an image.
    })
    .optional(),
  deckTitle: z.string().optional(),
})

/**
 * Known synonyms the live model reaches for instead of the contract's
 * verbs — the only drift we will confidently remap to a supported action.
 */
const ACTION_SYNONYMS: Record<string, 'new' | 'update' | 'none' | 'command'> = {
  new: 'new',
  create: 'new',
  add: 'new',
  insert: 'new',
  append: 'update',
  update: 'update',
  edit: 'update',
  modify: 'update',
  change: 'update',
  revise: 'update',
  none: 'none',
  skip: 'none',
  ignore: 'none',
  noop: 'none',
  command: 'command',
}

/**
 * Maps a possibly-drifted action label onto the contract's vocabulary. The
 * prompt already demands an exact value; this is the safety net for when
 * the model still drifts (a synonym like "create"/"edit", or a "new slide"
 * suffix). Only a confident remap is honored — anything we cannot map to a
 * supported action falls back to "none" so a mislabeled phrase quietly does
 * nothing rather than crashing the live session or guessing wrong.
 */
const normalizeAction = (
  value: unknown,
): 'new' | 'update' | 'none' | 'command' => {
  if (typeof value !== 'string') return 'none'
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]*slide$/, '')
    .trim()
  return ACTION_SYNONYMS[key] ?? 'none'
}

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

  // Deck-structure context (GENERATION_DECK_STRUCTURE): the running outline of
  // heading slides + positional signals AND the heading-decision instructions,
  // so the model judges title/section slides from the deck's shape, not just the
  // last few slides. One fragment carries both, so the server flag (which simply
  // omits req.deckStructure) removes the data and its instructions together.
  const deckStructure = req.deckStructure
    ? `\nDeck structure so far: ${req.deckStructure.totalSlides} slide(s), ${
        req.deckStructure.slidesSinceHeader
      } since the last heading; the deck ${
        req.deckStructure.hasTitleSlide ? 'HAS' : 'does NOT yet have'
      } an opening title slide.${
        req.deckStructure.outline.length
          ? `\nHeadings so far (slide number, layout, title):\n${req.deckStructure.outline
              .map(
                h =>
                  `${h.position}. [${h.layoutType}] ${h.title || '(untitled)'}`,
              )
              .join('\n')}`
          : ''
      }\nUse a "section" layout to open a NEW major topic when this phrase clearly shifts to one and several slides have accrued since the last heading; do not duplicate a section already in the outline. Use a "title" layout ONLY as the deck's opening slide. Otherwise prefer a content layout.`
    : ''

  // The current slide's layout can be one that is NOT selectable — a freehand
  // whiteboard canvas. It has no text slots and is absent from the set above, so
  // the model must never "update" it or echo its layout; content goes to a "new"
  // slide. Surfacing its "load" (as for a normal slide) invited exactly that bug.
  const capacity = req.currentSlide
    ? req.currentSlide.layoutType === WHITEBOARD_LAYOUT_TYPE
      ? `\nThe current slide is a freehand whiteboard drawing canvas: it has NO text slots and its layout ("${WHITEBOARD_LAYOUT_TYPE}") is NOT in the set above. NEVER choose "update" for it and NEVER output layoutType "${WHITEBOARD_LAYOUT_TYPE}". This phrase's content must go on a "new" slide (or "none" if it is filler).`
      : `\nCurrent slide load: ${req.currentSlide.bulletCount} bullets, ~${req.currentSlide.bodyChars} body characters (layout "${req.currentSlide.layoutType}"). If adding this phrase's content would exceed the layout's limits, choose "new" instead of "update".`
    : ''

  // Update semantics + the slide's exact content, present only when
  // layout re-fit is allowed (GEN-8): "delta" stays cheap (added
  // material only); "refit" pays for the complete re-mapped slide only
  // when the layout actually changes
  // "refit" is the complete-slide mode. With rephrasing on it serves two
  // purposes (change the layout, or re-state the same layout for clarity);
  // with it off it is strictly for genuine layout changes.
  const refitRule = req.allowRephrase
    ? `- "refit": provide the COMPLETE slide (every existing point preserved plus any added material). Use it EITHER to (a) move to a layoutType that fits the combined content better (e.g. prose grown into an enumeration fits "list"), OR (b) keep the SAME layoutType but re-state the whole slide when a clearer, tighter phrasing would improve it.`
    : `- "refit": ONLY when the slide's combined content now fits a DIFFERENT layout better (e.g. prose grown into an enumeration fits "list") — the layoutType must actually change; slots must contain the COMPLETE slide re-mapped to the new layout, every existing point preserved plus the added material, reworded only as the new slots require.`
  const updateRules =
    req.allowLayoutRefit &&
    req.currentSlide?.content &&
    // A whiteboard canvas is never updated (see `capacity`); don't hand the
    // model update rules that reference its non-selectable layout.
    req.currentSlide.layoutType !== WHITEBOARD_LAYOUT_TYPE
      ? `\nFor "update", also set "updateMode":
- "delta": adds a small amount; slots contain ONLY the added material. Keep layoutType "${req.currentSlide.layoutType}" unless another layout still displays every slot this slide uses.
${refitRule}
Current slide content: ${JSON.stringify(req.currentSlide.content)}`
      : ''

  // The raw speech captured while on the current slide, so the model can judge
  // what it already covers (distinct from the polished slot content above).
  const currentTranscript = req.currentSlide?.sourceTranscript
    ? `\nWhat the speaker has ALREADY said while on the current slide (its raw spoken transcript — use it to judge what the slide already covers and to avoid repeating points):\n"${req.currentSlide.sourceTranscript}"`
    : ''

  // A fourth action bullet, present only when commands are offered:
  // the bar is deliberately high — a wrong "command" hijacks the deck
  // mid-lecture, while a missed one merely adds a slide
  const voiceCommands = req.voiceCommands?.length
    ? `\n- "command": ONLY when the phrase is unmistakably the speaker operating the slide system rather than lecturing (e.g. "let's move on to the next slide", "go back one"). Set "command" to one id from the list below and leave slots empty. If the phrase could plausibly be lecture content, do NOT choose "command".\nCommand ids:\n${req.voiceCommands
        .map(c => `- "${c.id}": ${c.description}`)
        .join('\n')}`
    : ''

  // The user is drawing on the current slide right now (WB-3): it must not be
  // rearranged under their hand. Keep its layout and prefer touching only the
  // transcript over restructuring it. The server enforces this too.
  const lockLayout =
    req.lockLayout && req.currentSlide
      ? `\nIMPORTANT: the user is annotating the CURRENT slide by hand right now. Do NOT change its layout — for any "update", keep layoutType EXACTLY "${req.currentSlide.layoutType}" and never "refit". Prefer "update" or "none" over "new" so the slide being drawn on is not replaced or restructured.`
      : ''

  // The current slide is a heading (title/section) slide — usually the deck's
  // opening title card. It introduces rather than accumulates, so its layout is
  // pinned: sharpening its title/caption is fine, converting it into a content
  // slide mid-lecture is not. The server enforces this too.
  const pinLayout =
    req.pinLayout && req.currentSlide
      ? `\nIMPORTANT: the current slide is a heading slide (layout "${req.currentSlide.layoutType}") that introduces a topic rather than accumulating content. Its layout is FIXED: for any "update", keep layoutType EXACTLY "${req.currentSlide.layoutType}" and never "refit" it to a different layout. Only a sharper title (or caption) may update it — anything needing body text or bullets must be a "new" slide.`
      : ''

  // Untitled lecture: ask for a title alongside the slide decision;
  // the server stops asking once one is saved
  const deckTitle = req.suggestDeckTitle
    ? '\nThe lecture\'s title is still auto-managed. ALSO set "deckTitle": a concise lecture title (under 60 characters, no quotes) that best captures everything covered so far. Refine it as the lecture broadens and the full range of topics becomes clear; omit deckTitle only while the topic is not yet clear enough to name.'
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
    lockLayout,
    pinLayout,
    voiceCommands,
    freedomPolicy: freedomPolicy(req.freedom ?? 2),
    layouts,
    seededImages,
    projectSeed,
    deckSeed,
    rolling,
    deckStructure,
    capacity,
    currentTranscript,
    language,
    phrase: req.phrase,
  })
}

/** Validates a reformat result (GEN-4 Phase 4); never trust the model. */
const reformatResultSchema = z.object({
  layoutType: z.string().optional(),
  slots: z.object({
    title: z.string().optional(),
    body: z.string().optional(),
    bullets: z.array(z.string()).optional(),
    caption: z.string().optional(),
  }),
  imageGuidance: z
    .object({ keywords: z.array(z.string()), none: z.boolean().optional() })
    .optional(),
})

/** The `- type: purpose` layout menu shared by the refine/reformat prompts. */
const layoutMenu = (
  descriptors: SlideReformatRequest['layoutDescriptors'],
): string => descriptors.map(d => `- ${d.type}: ${d.purpose}`).join('\n')

/** The optional "Lecture context" fragment (empty when there is no seed). */
const contextFragment = (
  seedContext: SlideReformatRequest['seedContext'],
): string => {
  const seed = [seedContext?.project, seedContext?.deck]
    .filter(Boolean)
    .join('\n')
  return seed ? `\n\nLecture context:\n${seed}` : ''
}

/** The optional "Write the slide text in" language fragment. */
const languageFragment = (language: string | undefined): string =>
  language ? `\n\nWrite the slide text in: ${language}` : ''

/** An optional labelled source fragment (empty when the text is blank). */
const sourceFragment = (label: string, text: string | undefined): string =>
  text?.trim() ? `\n\n${label}\n${text.trim()}` : ''

/** Builds the reformat prompt: the current slide plus its role-annotated
 * transcript, with the lecturer authoritative and students' turns to be
 * rendered as questions/feedback. Wording lives in config/prompts/reformat.txt. */
const reformatPrompt = (req: SlideReformatRequest): string =>
  renderReformatPrompt({
    current: JSON.stringify(req.current),
    transcript: req.turns
      .map(t => `[${t.role.toUpperCase()}] ${t.text}`)
      .join('\n'),
    context: contextFragment(req.seedContext),
    language: languageFragment(req.language),
    layouts: layoutMenu(req.layoutDescriptors),
  })

/** POSTs a JSON-output prompt to Gemini and returns the candidate text; maps
 * quota (429) / overload (503) to a user-facing GenerationUnavailableError. */
const callGemini = async (prompt: string, label: string): Promise<string> => {
  if (!env.GEMINI_API_KEY)
    throw new Error('GENERATION_PROVIDER=gemini requires GEMINI_API_KEY')
  if (env.GENERATION_LOG_PROMPTS)
    console.log(`\n===== ${label} PROMPT =====\n${prompt}\n===== END =====`)
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
          maxOutputTokens: 2048,
        },
      }),
      signal: AbortSignal.timeout(env.GEMINI_TIMEOUT_MS),
    },
  )
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    if (res.status === 429 || res.status === 503) {
      console.warn(`Gemini ${label} ${res.status}: ${detail.slice(0, 500)}`)
      throw new GenerationUnavailableError(
        `${label} is unavailable — the AI provider is out of quota or busy.`,
        res.status === 503,
      )
    }
    throw new Error(
      `Gemini ${label} failed (${res.status}): ${detail.slice(0, 500)}`,
    )
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    usageMetadata?: GeminiUsageMetadata
  }
  await meterGeminiUsage(data.usageMetadata)
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error(`Gemini ${label} returned no candidate text`)
  return text
}

/** Slide-refine prompt: improve the slide at a 1–5 strength. */
const refinePrompt = (req: SlideRefineRequest): string =>
  renderRefinePrompt({
    level: String(req.level),
    current: JSON.stringify(req.current),
    transcript: sourceFragment(
      'Original spoken transcript for this slide:',
      req.transcript,
    ),
    context: contextFragment(req.seedContext),
    language: languageFragment(req.language),
    layouts: layoutMenu(req.layoutDescriptors),
  })

const refitResultSchema = z.object({
  slots: z.record(
    z.string(),
    z.union([z.string(), z.array(z.string()), z.number(), z.boolean()]),
  ),
})

/** One box, as the refit prompt lists it: what it is, its limits, and what
 * it holds. Limits are stated inline so the model reads them beside the
 * box they apply to rather than in a separate table. */
const refitSlotLine = (slot: RefitSlotDescriptor): string => {
  const limits = [
    slot.maxChars ? `max ${slot.maxChars} chars` : '',
    slot.maxItems ? `max ${slot.maxItems} items` : '',
  ]
    .filter(Boolean)
    .join(', ')
  const held =
    slot.value === undefined
      ? 'empty'
      : Array.isArray(slot.value)
        ? JSON.stringify(slot.value)
        : JSON.stringify(slot.value)
  return `- "${slot.name}" (${slot.label}; ${slot.kind}${
    slot.textStyle ? `, styled ${slot.textStyle}` : ''
  }${limits ? `; ${limits}` : ''}): ${held}`
}

/** Layout-refit prompt: fill only the boxes the switch left empty (GEN-9).
 * Wording lives in config/prompts/refit.txt. */
const refitPrompt = (req: SlideRefitRequest): string =>
  renderRefitPrompt({
    fromLayout: req.from.label,
    fromSlots: req.from.slots.map(refitSlotLine).join('\n'),
    toLayout: req.to.label,
    toPurpose: req.to.purpose,
    toSlots: req.to.slots.map(refitSlotLine).join('\n'),
    fill: req.fill
      .map(name => {
        const spec = req.to.slots.find(s => s.name === name)
        return spec ? refitSlotLine(spec) : `- "${name}"`
      })
      .join('\n'),
    orphaned: req.orphaned.length
      ? `\nContent that no longer has a box (use this first):\n${req.orphaned
          .map(refitSlotLine)
          .join('\n')}`
      : '',
    context: contextFragment(req.seedContext),
    language: languageFragment(req.language),
  })

const narrateResultSchema = z.object({ transcript: z.string() })

/** A plain narration built straight from the slide's text — the fallback when
 * the model reply is unusable, and the shape the prompt asks for. */
const plainNarration = (s: SlideNarrateRequest['slide']): string =>
  [s.title, s.body, ...(s.bullets ?? [])].filter(Boolean).join('. ')

/** Narration prompt: what the lecturer would say to present this slide.
 * Wording lives in config/prompts/narrate.txt. */
const narratePrompt = (req: SlideNarrateRequest): string => {
  // With role-tagged turns the narration is regenerated from them (span-level
  // attribution woven at speaker switches); the whole-slide studentContext note
  // and the prior-narration base are both dropped so nothing compounds.
  const hasTurns = Boolean(req.turns?.length)
  return renderNarratePrompt({
    level: String(req.level),
    studentContext:
      !hasTurns && req.studentContext
        ? '\nThis slide represents a STUDENT question or comment — narrate it as' +
          ' presenting the student’s question/feedback, not as the lecturer’s' +
          ' own assertion.'
        : '',
    turns: hasTurns
      ? '\nNarrate the discussion below in order. Present each [STUDENT] turn' +
        ' with a brief, natural spoken attribution at that point (e.g. “A' +
        ' student then asked, …” / “One student noted …”) — never as the' +
        ' lecturer’s own assertion — and keep [LECTURER] turns authoritative.' +
        ' Write the narration fresh from these turns:\n' +
        req.turns!.map(t => `[${t.role.toUpperCase()}] ${t.text}`).join('\n')
      : '',
    language: req.language ? `\nLanguage: ${req.language}.` : '',
    transcript: hasTurns
      ? ''
      : sourceFragment('Current narration to refine:', req.transcript),
    slide: JSON.stringify(req.slide),
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
      // Quota/credit exhaustion (429) and transient overload (503) become a
      // user-facing "generation unavailable" error instead of a raw 500. The
      // full body is still logged: the quota metric name (e.g. "...PerDay...")
      // and RetryInfo sit at the end, so a daily cap can be told from a blip.
      if (res.status === 429 || res.status === 503) {
        console.warn(`Gemini ${res.status}: ${detail.slice(0, 2000)}`)
        throw new GenerationUnavailableError(
          res.status === 429
            ? 'Slide generation is unavailable — the AI provider is out of quota or credits.'
            : 'Slide generation is temporarily busy — please try again in a moment.',
          res.status === 503,
        )
      }
      throw new Error(
        `Gemini request failed (${res.status}): ${detail.slice(0, 2000)}`,
      )
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      usageMetadata?: GeminiUsageMetadata
    }
    await meterGeminiUsage(data.usageMetadata)
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
    // Remap a drifted action label ("create", "add", "edit", "new slide")
    // to a supported action before validating; an unmappable value becomes
    // "none". Either way a mislabeled phrase never throws and 500s the live
    // session (GEN "closest sane default, don't crash" philosophy).
    if (raw && typeof raw === 'object') {
      const obj = raw as { action?: unknown }
      obj.action = normalizeAction(obj.action)
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

    // Any remaining drift (a malformed slot, a stray field type) degrades
    // to a dropped phrase rather than crashing the session.
    const result = resultSchema.safeParse(raw)
    if (!result.success) {
      console.warn(
        'Generation output failed validation, dropping phrase:',
        result.error.issues,
      )
      return { action: 'none', layoutType: 'content', slots: {} }
    }
    const parsed = result.data

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

  async reformatSlide(req: SlideReformatRequest): Promise<SlideReformatResult> {
    if (!env.GEMINI_API_KEY)
      throw new Error('GENERATION_PROVIDER=gemini requires GEMINI_API_KEY')
    /** Falls back to the slide as-is, so a bad model reply never corrupts it. */
    const unchanged: SlideReformatResult = {
      layoutType: req.current.layoutType,
      slots: {
        title: req.current.title,
        body: req.current.body,
        bullets: req.current.bullets,
        caption: req.current.caption,
      },
    }

    const prompt = reformatPrompt(req)
    if (env.GENERATION_LOG_PROMPTS)
      console.log(`\n===== REFORMAT PROMPT =====\n${prompt}\n===== END =====`)

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
            maxOutputTokens: 2048,
          },
        }),
        signal: AbortSignal.timeout(env.GEMINI_TIMEOUT_MS),
      },
    )
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      if (res.status === 429 || res.status === 503) {
        console.warn(`Gemini reformat ${res.status}: ${detail.slice(0, 500)}`)
        throw new GenerationUnavailableError(
          'Slide reformat is unavailable — the AI provider is out of quota or busy.',
          res.status === 503,
        )
      }
      throw new Error(
        `Gemini reformat failed (${res.status}): ${detail.slice(0, 500)}`,
      )
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      usageMetadata?: GeminiUsageMetadata
    }
    await meterGeminiUsage(data.usageMetadata)
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) return unchanged
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      return unchanged
    }
    const parsed = reformatResultSchema.safeParse(raw)
    if (!parsed.success) {
      console.warn(
        'Reformat output failed validation, keeping slide:',
        parsed.error.issues,
      )
      return unchanged
    }

    const allowed = new Set(req.layoutDescriptors.map(d => d.type))
    const layoutType = (
      parsed.data.layoutType &&
      allowed.has(parsed.data.layoutType as LayoutType)
        ? parsed.data.layoutType
        : req.current.layoutType
    ) as LayoutType
    return {
      layoutType,
      slots: parsed.data.slots,
      imageGuidance: parsed.data.imageGuidance
        ? {
            keywords: parsed.data.imageGuidance.keywords.slice(0, 6),
            none: parsed.data.imageGuidance.none,
          }
        : undefined,
    }
  }

  async refineSlide(req: SlideRefineRequest): Promise<SlideRefineResult> {
    const unchanged: SlideRefineResult = {
      layoutType: req.current.layoutType,
      slots: {
        title: req.current.title,
        body: req.current.body,
        bullets: req.current.bullets,
        caption: req.current.caption,
      },
    }
    let raw: unknown
    try {
      raw = JSON.parse(await callGemini(refinePrompt(req), 'Slide refine'))
    } catch (error) {
      // Quota/overload aborts the job; a bad JSON reply just keeps the slide.
      if (error instanceof GenerationUnavailableError) throw error
      return unchanged
    }
    // The refine output shape matches the reformat one (slots + layout + image).
    const parsed = reformatResultSchema.safeParse(raw)
    if (!parsed.success) return unchanged
    const allowed = new Set(req.layoutDescriptors.map(d => d.type))
    const layoutType = (
      parsed.data.layoutType &&
      allowed.has(parsed.data.layoutType as LayoutType)
        ? parsed.data.layoutType
        : req.current.layoutType
    ) as LayoutType
    return {
      layoutType,
      slots: parsed.data.slots,
      imageGuidance: parsed.data.imageGuidance
        ? {
            keywords: parsed.data.imageGuidance.keywords.slice(0, 6),
            none: parsed.data.imageGuidance.none,
          }
        : undefined,
    }
  }

  async refitSlideLayout(req: SlideRefitRequest): Promise<SlideRefitResult> {
    // Nothing filled is always a valid answer: the boxes stay empty and the
    // user types into them. Never a reason to fail the layout switch.
    const empty: SlideRefitResult = { slots: {} }
    let raw: unknown
    try {
      raw = JSON.parse(await callGemini(refitPrompt(req), 'Layout refit'))
    } catch (error) {
      if (error instanceof GenerationUnavailableError) throw error
      return empty
    }
    const parsed = refitResultSchema.safeParse(raw)
    if (!parsed.success) {
      console.warn('Refit output failed validation:', parsed.error.issues)
      return empty
    }
    // Only the boxes that were asked for, shaped as those boxes hold things.
    // A model that answers for a box it was not asked about would overwrite
    // content that was carried across intact, which is the one thing this
    // pass must never do.
    const wanted = new Map(
      req.to.slots.filter(s => req.fill.includes(s.name)).map(s => [s.name, s]),
    )
    const slots: Record<string, string | string[]> = {}
    for (const [name, value] of Object.entries(parsed.data.slots)) {
      const spec = wanted.get(name)
      if (!spec) continue
      if (spec.kind === 'bullets') {
        const items = (Array.isArray(value) ? value : [value])
          .map(v => String(v).trim())
          .filter(Boolean)
        if (items.length)
          slots[name] = spec.maxItems ? items.slice(0, spec.maxItems) : items
        continue
      }
      if (spec.kind !== 'text') continue
      const text = (
        Array.isArray(value) ? value.join(' ') : String(value)
      ).trim()
      if (text) slots[name] = text
    }
    return { slots }
  }

  async narrateSlide(req: SlideNarrateRequest): Promise<SlideNarrateResult> {
    const fallback: SlideNarrateResult = {
      transcript: plainNarration(req.slide),
    }
    let raw: unknown
    try {
      raw = JSON.parse(await callGemini(narratePrompt(req), 'Narration'))
    } catch (error) {
      if (error instanceof GenerationUnavailableError) throw error
      return fallback
    }
    const parsed = narrateResultSchema.safeParse(raw)
    return parsed.success && parsed.data.transcript.trim()
      ? { transcript: parsed.data.transcript.trim() }
      : fallback
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    if (!texts.length) return []
    if (!env.GEMINI_API_KEY)
      throw new Error('GENERATION_PROVIDER=gemini requires GEMINI_API_KEY')
    const model = `models/${env.GEMINI_EMBED_MODEL}`
    const res = await fetch(`${API_BASE}/${model}:batchEmbedContents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        requests: texts.map(text => ({
          model,
          content: { parts: [{ text }] },
        })),
      }),
      signal: AbortSignal.timeout(env.GEMINI_TIMEOUT_MS),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(
        `Gemini embed failed (${res.status}): ${detail.slice(0, 500)}`,
      )
    }
    const data = (await res.json()) as {
      embeddings?: Array<{ values?: number[] }>
    }
    const vectors = data.embeddings?.map(e => e.values ?? [])
    if (!vectors || vectors.length !== texts.length)
      throw new Error('Gemini embed returned an unexpected number of vectors')
    return vectors
  }
}

registry.register('generation', 'gemini', () => new GeminiGenerationProvider())

/**
 * Health probe for the Gemini API (used by GET /api/health). Lists models —
 * a free, zero-token call that verifies both reachability and the API key.
 * Missing key ⇒ disabled; 401/403 ⇒ auth failed; anything non-2xx ⇒ down.
 */
export const pingGemini = async (): Promise<HealthComponent> => {
  if (!env.GEMINI_API_KEY)
    return { status: 'disabled', detail: 'not configured' }
  try {
    const res = await fetch(`${API_BASE}/models`, {
      headers: { 'x-goog-api-key': env.GEMINI_API_KEY },
      signal: AbortSignal.timeout(2000),
    })
    if (res.ok) return { status: 'ok', detail: 'connected' }
    if (res.status === 401 || res.status === 403)
      return { status: 'down', detail: 'auth failed' }
    return { status: 'down', detail: `HTTP ${res.status}` }
  } catch (error) {
    return {
      status: 'down',
      detail: error instanceof Error ? error.name : 'unreachable',
    }
  }
}
