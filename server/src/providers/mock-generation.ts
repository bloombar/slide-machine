/**
 * Deterministic mock GenerationProvider (GEN-1/GEN-2, mock-first). Lets
 * the whole pipeline — session actions, event shape, renderer — run and
 * be tested before AI credentials exist. Swapping in the real Gemini
 * adapter is a config change (GENERATION_PROVIDER=gemini), not a rewrite.
 *
 * Heuristics (documented so tests can rely on them):
 * - continuation openers ("also", "and", …) with prior context → update
 *   the current slide with a new bullet
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
} from '@slide-machine/shared'
import { registry } from './registry'

const CONTINUATION = /^(also|and|plus|additionally|furthermore)\b/i

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
    const phrase = req.phrase.trim()
    const words = phrase.split(/\s+/).filter(Boolean)
    const segments = phrase
      .split(/[,;]/)
      .map(s => s.trim())
      .filter(Boolean)

    if (!words.length)
      return { action: 'none', layoutType: 'content', slots: {} }

    if (CONTINUATION.test(phrase) && req.rollingContext.length > 0) {
      return {
        action: 'update',
        layoutType: fitLayout('list', req.layoutDescriptors),
        slots: {
          bullets: [phrase.replace(CONTINUATION, '').replace(/^[,\s]+/, '')],
        },
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
      return {
        action: 'new',
        layoutType: fitLayout('title', req.layoutDescriptors),
        slots: { title: titleCase(words) },
        imageGuidance: { keywords: keywords(words) },
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

    return {
      action: 'new',
      layoutType: fitLayout('content', req.layoutDescriptors),
      slots: { title: titleCase(words.slice(0, 5)), body: phrase },
      imageGuidance: { keywords: keywords(words) },
    }
  }
}

registry.register('generation', 'mock', () => new MockGenerationProvider())
