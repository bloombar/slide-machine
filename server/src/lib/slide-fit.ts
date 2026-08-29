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
  SlotSpec,
  SlotValue,
} from '@slide-machine/shared'

export const charCount = (text: string | undefined): number =>
  text ? text.trim().length : 0

/**
 * Inline Markdown a cut left unterminated, tidied away.
 *
 * A text or bullet box is drawn as Markdown, and the generation prompt now
 * asks for it — emphasis, an identifier in backticks, a link. A budget cut
 * lands wherever the budget says, which is as easily inside a `**bold**` run
 * or halfway through a `[label](url)` as between two plain words. What an
 * audience then reads is not emphasis; it is the asterisks themselves.
 *
 * Nothing here re-flows or re-wraps: an unfinished link goes back to where it
 * opened, and a delimiter left in an odd number is dropped. Both leave
 * readable prose, which is what the clamp was for.
 *
 * Only ever applied to text the clamp actually shortened. Balanced markup has
 * even counts and would survive this untouched, but a literal asterisk in
 * prose nobody cut ("5 * 3") is not a delimiter, and must not be treated as
 * one.
 */
export const closeMarkdown = (text: string): string => {
  /*
   * A link is the only construct spanning more than one delimiter, and only
   * an unfinished one is a problem: the text goes back to where it opened
   * rather than showing a label in brackets with no destination.
   *
   * Brackets in prose are left alone. "[sic]" and "[1]" are not links, they
   * are how people write, and Markdown draws them as themselves — cutting a
   * caption back to before one would delete words to repair nothing.
   */
  const opened = text.lastIndexOf('[')
  const tail = opened === -1 ? '' : text.slice(opened)
  const unfinished =
    opened !== -1 &&
    // A destination that opened and never closed, or a label with no "]".
    (/^\[[^\]]*\]\([^)]*$/.test(tail) || !/^\[[^\]]*\]/.test(tail))
  let out = unfinished ? text.slice(0, opened).trimEnd() : text

  // Bold is two of the character italic uses, so it is taken out of the way
  // first and put back at the end; otherwise "**" reads as two italics.
  const BOLD = '\u0000'
  out = out.split('**').join(BOLD)
  for (const mark of [BOLD, '~~', '*', '`']) {
    const parts = out.split(mark)
    // An even part count means an odd number of the delimiter: the cut fell
    // inside a run, and the one that opened it is dropped.
    if (parts.length % 2 === 0)
      out = parts.slice(0, -1).join(mark) + parts[parts.length - 1]
  }
  out = out.split(BOLD).join('**').trimEnd()
  // The clamp's own "…" says the text was cut; dropping a link must not also
  // drop the only sign that anything is missing.
  return text.endsWith('…') && !out.endsWith('…') ? `${out}…` : out
}

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
  // A box the author named overflows too, and what happens then is the same:
  // the content goes on a NEW slide rather than being cut down to fit
  // (GEN-11/GEN-8). This is what "moved or omitted whole" means for a
  // listing or a formula — moved first, and only omitted if it cannot fit
  // anywhere.
  return declaredOverflows(
    result.declared,
    descriptors.find(d => d.type === result.layoutType)?.slots ?? [],
  )
}

/** Whether any authored box's content runs past what its slot allows. */
const declaredOverflows = (
  declared: Record<string, SlotValue> | undefined,
  specs: SlotSpec[],
): boolean => {
  if (!declared) return false
  for (const [name, value] of Object.entries(declared)) {
    const spec = specs.find(s => s.name === name)
    if (!spec) continue
    const { maxChars, maxItems } = spec
    switch (value.kind) {
      case 'code':
        if (maxChars && value.source.trim().length > maxChars) return true
        break
      case 'math':
        if (maxChars && value.tex.trim().length > maxChars) return true
        break
      case 'table':
        if (maxItems && value.rows.length > maxItems) return true
        break
      case 'bullets':
        if (maxItems && value.items.length > maxItems) return true
        break
      case 'text':
      case 'preformatted':
        if (maxChars && value.value.trim().length > maxChars) return true
        break
    }
  }
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
/**
 * A box the author named, held to its own limits (GEN-11).
 *
 * Fitting respects the kind. Prose may be trimmed at a word boundary, because
 * a sentence with its tail cut is still a sentence. **A program listing or a
 * formula is never truncated** — a half expression does not parse and a
 * listing cut mid-line no longer runs — so one that will not fit is omitted
 * whole. A half-formula is worse than none.
 *
 * A table is bounded by rows, not characters: cutting a row keeps a grid a
 * grid, where cutting a cell's text mid-word would leave a column of
 * fragments.
 */
const fitDeclared = (
  declared: Record<string, SlotValue> | undefined,
  specs: SlotSpec[],
): Record<string, SlotValue> | undefined => {
  if (!declared) return undefined
  const out: Record<string, SlotValue> = {}
  for (const [name, value] of Object.entries(declared)) {
    const spec = specs.find(s => s.name === name)
    // The layout can change after the content was checked against the old
    // one — image reconciliation moves a slide to a layout that can hold its
    // picture (GEN-7). A box the layout it landed on does not declare is
    // dropped here, so a slide is never left holding something its template
    // has no box for (GEN-11).
    if (!spec) continue
    const { maxChars, maxWords, maxItems } = spec
    switch (value.kind) {
      case 'code': {
        // Whole or not at all.
        if (maxChars && value.source.trim().length > maxChars) continue
        out[name] = value
        break
      }
      case 'math': {
        if (maxChars && value.tex.trim().length > maxChars) continue
        out[name] = value
        break
      }
      case 'table': {
        const rows = maxItems ? value.rows.slice(0, maxItems) : value.rows
        if (!rows.length) continue
        out[name] = { ...value, rows }
        break
      }
      case 'bullets': {
        const items = (maxItems ? value.items.slice(0, maxItems) : value.items)
          .map(item => {
            const clamped = clampChars(clampWords(item, maxWords), maxChars)
            return clamped === item || clamped === undefined
              ? clamped
              : closeMarkdown(clamped)
          })
          .filter((item): item is string => Boolean(item))
        if (!items.length) continue
        out[name] = { kind: 'bullets', items }
        break
      }
      case 'text':
      case 'preformatted': {
        const clamped = clampChars(clampWords(value.value, maxWords), maxChars)
        // A preformatted box is shown exactly as written and is never read as
        // Markdown, so an asterisk in it is an asterisk — tidying one would
        // delete a character the author meant.
        const text =
          value.kind === 'text' &&
          clamped !== undefined &&
          clamped !== value.value
            ? closeMarkdown(clamped)
            : clamped
        if (!text?.trim()) continue
        out[name] = { ...value, value: text }
        break
      }
      default:
        out[name] = value
    }
  }
  return Object.keys(out).length ? out : undefined
}

export const clampToBudget = (
  result: SlideGenerationResult,
  descriptors: LayoutDescriptor[],
): SlideGenerationResult => {
  const limits = budgetsFor(result, descriptors)
  const words = wordBudgetsFor(result, descriptors)
  // Both bind where both are given: words first, so a whole-word cut is what
  // a character ceiling then measures. A cut that shortened the text is then
  // tidied, so no half of a Markdown delimiter reaches the slide.
  const fit = (
    text: string | undefined,
    chars: number | undefined,
    max: number | undefined,
  ) => {
    const clamped = clampChars(clampWords(text, max), chars)
    return clamped === text || clamped === undefined
      ? clamped
      : closeMarkdown(clamped)
  }
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
    declared: fitDeclared(
      result.declared,
      descriptors.find(d => d.type === result.layoutType)?.slots ?? [],
    ),
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
