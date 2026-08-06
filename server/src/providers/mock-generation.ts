/**
 * Deterministic mock GenerationProvider (GEN-1/GEN-2, mock-first). Lets
 * the whole pipeline — session actions, event shape, renderer — run and
 * be tested before AI credentials exist. Swapping in the real Gemini
 * adapter is a config change (GENERATION_PROVIDER=gemini), not a rewrite.
 *
 * Heuristics (documented so tests can rely on them):
 * - voice commands offered + "please <command phrase>" → that command
 *   ("please next slide", "please go back", "please pause",
 *   "please new slide")
 * - continuation openers ("also", "and", …) with prior context → update
 *   the current slide with a new bullet; when the continuation itself
 *   carries 2+ comma-separated items AND layout re-fit is allowed, a
 *   full "refit" to a list slide instead (existing body becomes the
 *   first bullet)
 * - 3+ comma/semicolon-separated segments → a list slide
 * - ends with "?" → a quote slide
 * - ≤4 words with no prior context → a title slide
 * - anything else → a content slide (first words become the title)
 */
import type {
  GenerationProvider,
  LayoutDescriptor,
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
  VoiceCommand,
} from '@slide-machine/shared'
import { registry } from './registry'

const CONTINUATION = /^(also|and|plus|additionally|furthermore)\b/i

/** Mock stand-in for a phrase that opens a new major topic (a section cue),
 * used with GENERATION_DECK_STRUCTURE signals to emit a "section" heading. */
const SECTION_CUE = /^(next|moving on|let's turn to|turning to|now on to)\b/i

/** Mock stand-in for the model judging a phrase to be filler (an aside or
 * hesitation that changes no slide): a leading interjection → action "none". */
const FILLER = /^(um+|uh+|er+m?|hmm+|erm+)\b/i

/** Mock stand-in for AI command-intent recognition: "please <phrase>"
 * maps to a command id, honored only when the request offers commands. */
const COMMAND_INTENTS: Record<string, VoiceCommand> = {
  'next slide': 'next',
  'move on': 'next',
  'previous slide': 'previous',
  'go back': 'previous',
  pause: 'pause',
  'stop listening': 'pause',
  resume: 'resume',
  'resume generation': 'resume',
  continue: 'resume',
  'keep going': 'resume',
  'new slide': 'newSlide',
  'blank slide': 'newSlide',
  'new whiteboard': 'newWhiteboardSlide',
  'new whiteboard slide': 'newWhiteboardSlide',
  'new chalkboard': 'newWhiteboardSlide',
}

/** The offered command matching "please …", if any. */
const commandIntent = (
  phrase: string,
  req: SlideGenerationRequest,
): VoiceCommand | undefined => {
  const match = /^please[,\s]+(.+?)[.!?]*$/i.exec(phrase.trim())
  if (!match) return undefined
  const intent = COMMAND_INTENTS[match[1]!.toLowerCase().trim()]
  return req.voiceCommands?.some(c => c.id === intent) ? intent : undefined
}

/** Falls back to `content`, then the first available layout (GEN-6). */
const fitLayout = (wanted: string, available: LayoutDescriptor[]): string => {
  const types = available.map(d => d.type)
  if (types.includes(wanted)) return wanted
  if (types.includes('content')) return 'content'
  return types[0] ?? 'content'
}

const titleCase = (words: string[]): string =>
  words.map(w => (w ? w[0]!.toUpperCase() + w.slice(1) : w)).join(' ')

/** The two longest words make serviceable mock image keywords (GEN-7). */
const keywords = (words: string[]): string[] =>
  [...words].sort((a, b) => b.length - a.length).slice(0, 2)

export class MockGenerationProvider implements GenerationProvider {
  readonly name = 'mock'

  async generateSlideContent(
    req: SlideGenerationRequest,
  ): Promise<SlideGenerationResult> {
    const result = this.decide(req)
    // Mock stand-in for "return a title once the topic is clear": with
    // prior context the topic counts as known, and the title is the
    // first words of the current phrase (deterministic for tests)
    const words = req.phrase.trim().split(/\s+/).filter(Boolean)
    if (
      req.suggestDeckTitle &&
      req.rollingContext.length > 0 &&
      result.action !== 'command' &&
      words.length
    ) {
      return { ...result, deckTitle: titleCase(words.slice(0, 5)) }
    }
    return result
  }

  private decide(req: SlideGenerationRequest): SlideGenerationResult {
    const phrase = req.phrase.trim()
    const words = phrase.split(/\s+/).filter(Boolean)
    const segments = phrase
      .split(/[,;]/)
      .map(s => s.trim())
      .filter(Boolean)

    if (!words.length || FILLER.test(phrase))
      return { action: 'none', layoutType: 'content', slots: {} }

    const command = commandIntent(phrase, req)
    if (command)
      return { action: 'command', command, layoutType: 'content', slots: {} }

    // A section-cue phrase, once a few slides have accrued since the last
    // heading, opens a new section heading — the deterministic mirror of the
    // real heading guidance driven by GENERATION_DECK_STRUCTURE.
    if (
      SECTION_CUE.test(phrase) &&
      (req.deckStructure?.slidesSinceHeader ?? 0) >= 2
    ) {
      return {
        action: 'new',
        layoutType: fitLayout('section', req.layoutDescriptors),
        slots: { title: titleCase(words.slice(0, 5)) },
      }
    }

    if (CONTINUATION.test(phrase) && req.rollingContext.length > 0) {
      const added = phrase.replace(CONTINUATION, '').replace(/^[,\s]+/, '')
      const items = added
        .split(/[,;]/)
        .map(s => s.trim())
        .filter(Boolean)
      const current = req.currentSlide?.content
      if (req.allowLayoutRefit && current && items.length >= 2) {
        // Full refit: the slide's combined material re-mapped to a list
        return {
          action: 'update',
          updateMode: 'refit',
          layoutType: fitLayout('list', req.layoutDescriptors),
          slots: {
            title: current.title ?? titleCase(words.slice(0, 4)),
            bullets: [
              ...(current.bullets ?? []),
              ...(current.body ? [current.body] : []),
              ...items,
            ],
          },
          imageGuidance: { keywords: keywords(words) },
        }
      }
      return {
        action: 'update',
        updateMode: 'delta',
        layoutType: fitLayout('list', req.layoutDescriptors),
        slots: { bullets: [added] },
        imageGuidance: { keywords: keywords(words) },
      }
    }

    if (segments.length >= 3) {
      return {
        action: 'new',
        layoutType: fitLayout('list', req.layoutDescriptors),
        slots: { title: titleCase(words.slice(0, 4)), bullets: segments },
        imageGuidance: { keywords: keywords(words) },
      }
    }

    if (phrase.endsWith('?')) {
      return {
        action: 'new',
        layoutType: fitLayout('quote', req.layoutDescriptors),
        slots: { body: phrase },
        imageGuidance: { none: true, keywords: [] },
      }
    }

    if (words.length <= 4 && req.rollingContext.length === 0) {
      // A title card is text-only: it has no image slot, so — like a coherent
      // model — the mock asks for no image, and image/layout reconciliation
      // (GEN-7) leaves the layout as a title.
      return {
        action: 'new',
        layoutType: fitLayout('title', req.layoutDescriptors),
        slots: { title: titleCase(words) },
      }
    }

    // Longer descriptive sentences get an image beside the text
    if (words.length >= 10) {
      return {
        action: 'new',
        layoutType: fitLayout('two-column', req.layoutDescriptors),
        slots: { title: titleCase(words.slice(0, 5)), body: phrase },
        imageGuidance: { keywords: keywords(words) },
      }
    }

    // A plain content slide (title + body) is text-only too — an image would
    // have nowhere to render on this layout, so the mock requests none and the
    // slide stays `content` (a phrase that wants an image takes two-column).
    return {
      action: 'new',
      layoutType: fitLayout('content', req.layoutDescriptors),
      slots: { title: titleCase(words.slice(0, 5)), body: phrase },
    }
  }

  /**
   * Deterministic reformat (GEN-4 Phase 4): keeps the lecturer's content as-is
   * and appends each student turn as an explicit "Q:" bullet, so a student's
   * question is clearly marked rather than left standing as authoritative fact.
   */
  async reformatSlide(req: SlideReformatRequest): Promise<SlideReformatResult> {
    const questions = req.turns
      .filter(t => t.role === 'student')
      .map(t => `Q: ${t.text}`)
    return {
      layoutType: req.current.layoutType,
      slots: {
        title: req.current.title,
        body: req.current.body,
        bullets: [...(req.current.bullets ?? []), ...questions],
        caption: req.current.caption,
      },
    }
  }

  /** Deterministic slide refine (GEN-4): preserves content and stamps the
   * caption with the refinement level, so tests can assert a slide was
   * refined at a chosen strength. */
  /**
   * Deterministic layout refit (GEN-9): writes the content the old layout had
   * nowhere to put into the first box that can hold it, so tests can assert
   * the wiring without a live model. A bullet box splits the source on
   * sentences; a text box takes it whole.
   *
   * One box, not every empty one. There is a single piece of source material
   * here, and copying it into each hole would put the same sentence in the
   * body AND the caption — which is what the prompt tells a real model not to
   * do ("an empty box is better than filler"). The mock stands in for that
   * model, so it has to follow the same rule.
   */
  async refitSlideLayout(req: SlideRefitRequest): Promise<SlideRefitResult> {
    const source = req.orphaned
      .map(s => (Array.isArray(s.value) ? s.value.join('. ') : (s.value ?? '')))
      .filter(Boolean)
      .join('. ')
    if (!source) return { slots: {} }
    for (const name of req.fill) {
      const spec = req.to.slots.find(s => s.name === name)
      if (!spec || spec.kind === 'image') continue
      if (spec.kind === 'bullets') {
        const items = source
          .split(/(?<=\.)\s+/)
          .map(s => s.replace(/\.$/, '').trim())
          .filter(Boolean)
        return {
          slots: {
            [name]: spec.maxItems ? items.slice(0, spec.maxItems) : items,
          },
        }
      }
      return {
        slots: {
          [name]: spec.maxChars ? source.slice(0, spec.maxChars) : source,
        },
      }
    }
    return { slots: {} }
  }

  async refineSlide(req: SlideRefineRequest): Promise<SlideRefineResult> {
    return {
      layoutType: req.current.layoutType,
      slots: {
        title: req.current.title,
        body: req.current.body,
        bullets: req.current.bullets,
        caption: `Refined (level ${req.level})`,
      },
    }
  }

  /** Deterministic narration (GEN-4): refines the slide's current narration
   * further when one is supplied (marking each pass, so repeated refines
   * compound), else builds one from the slide's content. Student speech is
   * prefixed so playback stays in-line with the (possibly reformatted) slide. */
  async narrateSlide(req: SlideNarrateRequest): Promise<SlideNarrateResult> {
    // Role-tagged turns → regenerate fresh, attributing student turns at the
    // point they occur (deterministic, so repeated refines are byte-identical).
    if (req.turns?.length) {
      const transcript = req.turns
        .map(t =>
          t.role === 'student' ? `A student asked: ${t.text}` : t.text,
        )
        .join('. ')
      return { transcript }
    }
    const prefix = req.studentContext ? 'A student asked: ' : ''
    const prior = req.transcript?.trim()
    if (prior) {
      const base = prior.startsWith(prefix) ? prior : `${prefix}${prior}`
      return { transcript: `${base} (refined)` }
    }
    const content = [
      req.slide.title,
      req.slide.body,
      ...(req.slide.bullets ?? []),
    ]
      .filter(Boolean)
      .join('. ')
    return { transcript: `${prefix}${content}`.trim() }
  }

  /** Deterministic bag-of-words embedding: each lowercase word increments a
   * hashed bucket, so texts sharing words score higher cosine similarity. No
   * network, byte-stable — lets the refine remap be tested end to end. */
  async embedTexts(texts: string[]): Promise<number[][]> {
    const DIMS = 64
    return texts.map(text => {
      const vec = new Array<number>(DIMS).fill(0)
      for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
        let hash = 0
        for (let i = 0; i < word.length; i++)
          hash = (hash * 31 + word.charCodeAt(i)) | 0
        const bucket = Math.abs(hash) % DIMS
        vec[bucket] = (vec[bucket] ?? 0) + 1
      }
      return vec
    })
  }
}

registry.register('generation', 'mock', () => new MockGenerationProvider())
