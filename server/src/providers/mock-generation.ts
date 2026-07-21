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
  LayoutType,
  SlideGenerationRequest,
  SlideGenerationResult,
  SlideReformatRequest,
  SlideReformatResult,
  SlideRefineRequest,
  SlideRefineResult,
  SlideNarrateRequest,
  SlideNarrateResult,
  VoiceCommand,
} from '@slide-machine/shared'
import { registry } from './registry'

const CONTINUATION = /^(also|and|plus|additionally|furthermore)\b/i

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
  'new slide': 'newSlide',
  'blank slide': 'newSlide',
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
const fitLayout = (
  wanted: LayoutType,
  available: LayoutDescriptor[],
): LayoutType => {
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
    const prefix = req.studentContext ? 'A student asked: ' : ''
    const prior = req.transcript?.trim()
    if (prior) {
      const base = prior.startsWith(prefix) ? prior : `${prefix}${prior}`
      return { transcript: `${base} (refined)` }
    }
    const content = [req.slide.title, req.slide.body, ...(req.slide.bullets ?? [])]
      .filter(Boolean)
      .join('. ')
    return { transcript: `${prefix}${content}`.trim() }
  }
}

registry.register('generation', 'mock', () => new MockGenerationProvider())
