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

/**
 * Truncates to a word budget, keeping whole words (TMPL-10).
 *
 * Counted, not converted. An earlier version turned a word ceiling into a
 * character one at an average word length, which broke exactly where authors
 * are most precise: "max 1 word" became six characters, so "Photosynthesis"
 * — one word — came back as "Photos…". A word limit means whole words, and
 * however long they are is how long they are.
 *
 * No ellipsis, unlike the character clamp. A word ceiling is a design rule
 * the author set — "titles in this design are three words" — so the result
 * should read as the title it was meant to be, not as something cut off.
 */
const clampWords = (
  text: string | undefined,
  max: number | undefined,
): string | undefined => {
  if (!text || !max) return text
  const words = text.trim().split(/\s+/)
  if (words.length <= max) return text
  return words.slice(0, max).join(' ')
}

/** Effective budgets: a box's own limits (the WYSIWYG-ready form)
 * override the layout-level constraint for that box. */
const budgetsFor = (
  result: SlideGenerationResult,
  descriptors: LayoutDescriptor[],
): LayoutConstraints => {
  const layout = descriptors.find(d => d.type === result.layoutType)
  const constraints = layout?.constraints ?? {}
  const slotChars = (name: string): number | undefined =>
    layout?.slots.find(s => s.name === name)?.maxChars
  // A bullet box may say how many points it holds; that is more specific than
  // the layout's own count, so it wins.
  const slotBullets = layout?.slots.find(s => s.kind === 'bullets')?.maxItems
  return {
    ...constraints,
    maxBullets: slotBullets ?? constraints.maxBullets,
    maxTitleChars: slotChars('title') ?? constraints.maxTitleChars,
    maxBodyChars: slotChars('body') ?? constraints.maxBodyChars,
    maxBulletChars: slotChars('bullets') ?? constraints.maxBulletChars,
    maxCaptionChars: slotChars('caption') ?? constraints.maxCaptionChars,
  }
}

/** A box's word ceiling, by conventional slot name. Kept apart from the
 * character budgets because it is counted rather than measured, and only a
 * box states one — no style or layout constraint speaks in words (TMPL-10). */
const wordBudgetsFor = (
  result: SlideGenerationResult,
  descriptors: LayoutDescriptor[],
): Record<string, number | undefined> => {
  const layout = descriptors.find(d => d.type === result.layoutType)
  const words = (name: string) =>
    layout?.slots.find(s => s.name === name)?.maxWords
  return {
    title: words('title'),
    body: words('body'),
    bullets: words('bullets'),
    caption: words('caption'),
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
  const words = wordBudgetsFor(result, descriptors)
  // Both bind where both are given: words first, so a whole-word cut is what
  // a character ceiling then measures.
  const fit = (
    text: string | undefined,
    chars: number | undefined,
    max: number | undefined,
  ) => clampChars(clampWords(text, max), chars)
  return {
    ...result,
    slots: {
      title: fit(result.slots.title, limits.maxTitleChars, words.title),
      body: fit(result.slots.body, limits.maxBodyChars, words.body),
      bullets: result.slots.bullets
        ?.slice(0, limits.maxBullets ?? result.slots.bullets.length)
        .map(b => fit(b, limits.maxBulletChars, words.bullets)!),
      caption: fit(result.slots.caption, limits.maxCaptionChars, words.caption),
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
