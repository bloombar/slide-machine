/**
 * Slide capacity enforcement (GEN-8 / TMPL-6): the model is guided by
 * word budgets in the prompt, but never trusted with them. An "update"
 * that would push the current slide past its layout's budget becomes a
 * NEW slide instead, and new-slide content is clamped to the budget —
 * slides stay readable no matter what the model returns.
 */
import type {
  LayoutConstraints,
  LayoutDescriptor,
  SlideGenerationResult,
} from '@slide-machine/shared'

export const wordCount = (text: string | undefined): number =>
  text ? text.trim().split(/\s+/).filter(Boolean).length : 0

/** Truncates to a word budget; no-op when within it. */
const clampWords = (
  text: string | undefined,
  max: number | undefined,
): string | undefined => {
  if (!text || !max) return text
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length <= max) return text
  return `${words.slice(0, max).join(' ')}…`
}

const constraintsFor = (
  result: SlideGenerationResult,
  descriptors: LayoutDescriptor[],
): LayoutConstraints =>
  descriptors.find(d => d.type === result.layoutType)?.constraints ?? {}

/** The content the current slide already holds, for capacity checks. */
export interface CurrentSlideLoad {
  bulletCount: number
  bodyWords: number
}

/**
 * True when applying `result` as an update would overflow the target
 * layout's budget — the caller should create a new slide instead.
 */
export const updateOverflows = (
  result: SlideGenerationResult,
  current: CurrentSlideLoad,
  descriptors: LayoutDescriptor[],
): boolean => {
  if (result.action !== 'update') return false
  const limits = constraintsFor(result, descriptors)
  const bullets = current.bulletCount + (result.slots.bullets?.length ?? 0)
  if (limits.maxBullets && bullets > limits.maxBullets) return true
  const bodyWords = current.bodyWords + wordCount(result.slots.body)
  if (limits.maxBodyWords && bodyWords > limits.maxBodyWords) return true
  return false
}

/** Clamps a result's slots to its layout's word budgets (new slides). */
export const clampToBudget = (
  result: SlideGenerationResult,
  descriptors: LayoutDescriptor[],
): SlideGenerationResult => {
  const limits = constraintsFor(result, descriptors)
  return {
    ...result,
    slots: {
      title: clampWords(result.slots.title, limits.maxTitleWords),
      body: clampWords(result.slots.body, limits.maxBodyWords),
      bullets: result.slots.bullets
        ?.slice(0, limits.maxBullets ?? result.slots.bullets.length)
        .map(b => clampWords(b, limits.maxBulletWords)!),
      caption: clampWords(result.slots.caption, limits.maxCaptionWords),
    },
  }
}

/** A short title for updates promoted to new slides without one. */
export const titleFromPhrase = (phrase: string, maxWords = 6): string =>
  phrase
    .trim()
    .split(/\s+/)
    .slice(0, maxWords)
    .map(w => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ')
