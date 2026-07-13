/**
 * Slide capacity enforcement (GEN-8 / TMPL-6): the model is guided by
 * character budgets in the prompt, but never trusted with them. An
 * "update" that would push the current slide past its layout's budget
 * becomes a NEW slide instead, and new-slide content is clamped to the
 * budget — slides stay readable no matter what the model returns.
 * Budgets are characters, not words, so they hold in unspaced
 * languages (e.g. Mandarin) where "word" is undefined.
 */
import type {
  LayoutConstraints,
  LayoutDescriptor,
  SlideGenerationResult,
} from '@slide-machine/shared'

export const charCount = (text: string | undefined): number =>
  text ? text.trim().length : 0

/** Truncates to a character budget; no-op when within it. Cuts at the
 * last word boundary inside the budget when one exists (spaced
 * languages), otherwise hard-cuts at the budget (CJK). */
const clampChars = (
  text: string | undefined,
  max: number | undefined,
): string | undefined => {
  if (!text || !max) return text
  const trimmed = text.trim()
  if (trimmed.length <= max) return text
  const cut = trimmed.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/** Effective budgets: per-slot maxChars (the WYSIWYG-ready form)
 * override the layout-level constraint for that slot. */
const budgetsFor = (
  result: SlideGenerationResult,
  descriptors: LayoutDescriptor[],
): LayoutConstraints => {
  const layout = descriptors.find(d => d.type === result.layoutType)
  const constraints = layout?.constraints ?? {}
  const slotChars = (name: string): number | undefined =>
    layout?.slots.find(s => s.name === name)?.maxChars
  return {
    ...constraints,
    maxTitleChars: slotChars('title') ?? constraints.maxTitleChars,
    maxBodyChars: slotChars('body') ?? constraints.maxBodyChars,
    maxBulletChars: slotChars('bullets') ?? constraints.maxBulletChars,
    maxCaptionChars: slotChars('caption') ?? constraints.maxCaptionChars,
  }
}

/** The content the current slide already holds, for capacity checks. */
export interface CurrentSlideLoad {
  bulletCount: number
  bodyChars: number
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
  const limits = budgetsFor(result, descriptors)
  const bullets = current.bulletCount + (result.slots.bullets?.length ?? 0)
  if (limits.maxBullets && bullets > limits.maxBullets) return true
  const bodyChars = current.bodyChars + charCount(result.slots.body)
  if (limits.maxBodyChars && bodyChars > limits.maxBodyChars) return true
  return false
}

/**
 * True when a refit's COMPLETE slots exceed the target layout's hard
 * budgets (bullet count / body characters). Refits are absolute, not
 * additive, so this is the refit counterpart of updateOverflows.
 */
export const refitOverflows = (
  result: SlideGenerationResult,
  descriptors: LayoutDescriptor[],
): boolean => {
  const limits = budgetsFor(result, descriptors)
  const bullets = result.slots.bullets?.length ?? 0
  if (limits.maxBullets && bullets > limits.maxBullets) return true
  const bodyChars = charCount(result.slots.body)
  if (limits.maxBodyChars && bodyChars > limits.maxBodyChars) return true
  return false
}

/** Clamps a result's slots to its layout's character budgets (new slides). */
export const clampToBudget = (
  result: SlideGenerationResult,
  descriptors: LayoutDescriptor[],
): SlideGenerationResult => {
  const limits = budgetsFor(result, descriptors)
  return {
    ...result,
    slots: {
      title: clampChars(result.slots.title, limits.maxTitleChars),
      body: clampChars(result.slots.body, limits.maxBodyChars),
      bullets: result.slots.bullets
        ?.slice(0, limits.maxBullets ?? result.slots.bullets.length)
        .map(b => clampChars(b, limits.maxBulletChars)!),
      caption: clampChars(result.slots.caption, limits.maxCaptionChars),
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
