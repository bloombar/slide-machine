/**
 * A slide, read as the boxes a design would have (TMPL-8, stage 2).
 *
 * Before any slides can be compared, each one has to be described in the
 * vocabulary a layout uses: named boxes of a kind, each somewhere on the page.
 * That description is a **candidate** — what this slide would be if it were a
 * layout on its own.
 *
 * ## Where a box's name comes from
 *
 * In order of how much it is worth:
 *
 *   1. **What the slide says it is.** A presentation this system exported
 *      carries each box's own name in its alt text (EXP-8). Nothing here can
 *      beat being told.
 *   2. **Its placeholder type.** `TITLE` is a title wherever it appears, and
 *      Google's own layouts set these even on decks nobody templated.
 *   3. **What it holds and where it sits.** A picture is `image`; a list is
 *      `bullets`; the largest type near the top is a title and the rest is
 *      body. Crude, and the only thing left for a deck built by hand.
 *
 * Every derived slot is `text` unless it is plainly something else, because
 * mistaking prose for something specialized is worse than not recognizing it
 * (TMPL-8) — the author corrects a kind in the editor far more easily than
 * they recover content the import reinterpreted.
 */
import type { SlotKind, SlotSpec } from '@slide-machine/shared'
import { isMixed, hasLinks, isNested } from './markdown'
import type {
  SourceBox,
  SourceElement,
  SourcePage,
} from './source-presentation'

/** One box of a candidate layout. */
export interface CandidateSlot {
  name: string
  kind: SlotKind
  box: SourceBox
  /** Type size in `cqi`, where the source stated one. */
  fontSize?: number
  bold?: boolean
  color?: string
  /** The box's own fill, where the shape has one. Part of the design: a deck
   * may put its colour on the boxes rather than on the page. */
  background?: string
  /** The family the presentation named, mapped to a bundled stack later —
   * never fetched at display time (docs/TEMPLATES.md §5). */
  fontFamily?: string
  /** How the text sits in its box, from the slide it came from. */
  align?: 'start' | 'center' | 'end'
  vAlign?: 'start' | 'center' | 'end'
  /** A sentence saying what belongs in this box, for the author and for the
   * AI that fills it (GEN-11). Proposed by the model in pass 5. */
  description?: string
  /**
   * The box's own declaration, when the presentation was exported by this
   * system and carries it (EXP-8). Restored verbatim rather than inferred, so
   * a round trip through Google Slides keeps a box's kind, instruction and
   * limits exactly — which inference could never recover.
   */
  restored?: SlotSpec
  /** What this box held on the slide it came from, for the lecture importer
   * to place (EXP-5). Ignored when only a design is wanted. */
  content?: SourceElement
  /**
   * The most any slide of this design actually put in the box — how many
   * lines, and how long the longest was.
   *
   * A measurement rather than the content, because a design carries no
   * content (`consolidate`). It exists so a box can be given room for what it
   * has to hold: a source box measured as the source drew it can be shorter
   * than this app needs for the same words, and an imported layout hides
   * whatever runs past its edge.
   */
  held?: { lines: number; longest: number }
}

/** One slide, described as a layout. */
export interface Candidate {
  /** The slide it came from, so content can be mapped back later (EXP-5). */
  slideId: string
  slots: CandidateSlot[]
  /** Rules and bands: part of the design, and never content. */
  decoration: {
    box: SourceBox
    fill?: string
    imageUrl?: string
    /** What the shape is, as the presentation named it. */
    shapeType?: string
  }[]
  background?: string
  /** A picture filling the page behind everything (TMPL-8). */
  backgroundImage?: string
}

/** Google's placeholder types, in the vocabulary a layout uses. */
const FROM_PLACEHOLDER: Record<string, string> = {
  TITLE: 'title',
  CENTERED_TITLE: 'title',
  SUBTITLE: 'caption',
  BODY: 'body',
  PICTURE: 'image',
  OBJECT: 'body',
}

/** What a shape holds, as a slot kind. */
const kindOf = (element: SourceElement): SlotKind => {
  if (element.kind === 'image') return 'image'
  if (element.kind === 'table') return 'table'
  // A box that is prose AND points, or whose words point somewhere, is text
  // holding Markdown — the shape it actually had (`markdown.ts`). Called a
  // list it would be edited one line per point, which is not what it is.
  const runs = element.runs ?? []
  if (isMixed(runs) || (element.bulleted && (hasLinks(runs) || isNested(runs))))
    return 'text'
  if (element.bulleted) return 'bullets'
  // Everything else is prose. A listing or a formula on a hand-built slide is
  // indistinguishable from text at this level, and guessing wrong buries the
  // content in a box that renders it as something it is not.
  return 'text'
}

/** The type size of a box: the largest run in it, since that is what the eye
 * reads it as. */
const sizeOf = (element: SourceElement): number | undefined => {
  const sizes = (element.runs ?? [])
    .map(r => r.fontSize)
    .filter((n): n is number => typeof n === 'number')
  return sizes.length ? Math.max(...sizes) : undefined
}

const boldOf = (element: SourceElement): boolean | undefined =>
  element.runs?.some(r => r.bold) ? true : undefined

const colorOf = (element: SourceElement): string | undefined =>
  element.runs?.find(r => r.color)?.color

const fontOf = (element: SourceElement): string | undefined =>
  element.runs?.find(r => r.fontFamily)?.fontFamily

/**
 * Names the text boxes of a slide that told us nothing.
 *
 * The largest type in the upper half is the title — that is what a title IS
 * on a slide nobody labelled. After that, the first is the body and anything
 * more is numbered, because a name that lies ("caption" for a third
 * paragraph) is worse than one that merely counts.
 */
const nameUnlabelled = (
  slots: { element: SourceElement; kind: SlotKind }[],
): string[] => {
  const names: string[] = []
  const textish = slots
    .map((s, i) => ({ ...s, i, size: sizeOf(s.element) ?? 0 }))
    .filter(s => s.kind === 'text' || s.kind === 'bullets')
  const titleIndex = textish
    .filter(s => s.element.box.y < 0.5)
    .sort((a, b) => b.size - a.size)[0]?.i

  let bodies = 0
  let images = 0
  let tables = 0
  slots.forEach((slot, i) => {
    if (slot.kind === 'image') {
      names[i] = images++ === 0 ? 'image' : `image-${images}`
      return
    }
    if (slot.kind === 'table') {
      names[i] = tables++ === 0 ? 'table' : `table-${tables}`
      return
    }
    if (i === titleIndex) {
      names[i] = 'title'
      return
    }
    names[i] = bodies++ === 0 ? 'body' : `body-${bodies}`
  })
  return names
}

/** Keeps a name unique within one candidate, since two boxes cannot share
 * one: a slot name is how content is addressed. */
const unique = (name: string, taken: Set<string>): string => {
  if (!taken.has(name)) {
    taken.add(name)
    return name
  }
  let n = 2
  while (taken.has(`${name}-${n}`)) n++
  const next = `${name}-${n}`
  taken.add(next)
  return next
}

/**
 * Describes one slide as the layout it would be.
 *
 * Boxes are kept in the order they are drawn, which is the order the design
 * stacks them in — and the order a reader's eye follows on a slide that was
 * built rather than generated.
 */
export const candidateOf = (
  page: SourcePage,
  /** The slot declarations this presentation carries for this page, if it is
   * one this system exported (EXP-8). */
  declared?: SlotSpec[],
): Candidate => {
  const byName = new Map((declared ?? []).map(spec => [spec.name, spec]))
  const content = page.elements.filter(e => e.kind !== 'decoration')
  const withKinds = content.map(element => ({
    element,
    kind: kindOf(element),
  }))
  const fallbackNames = nameUnlabelled(withKinds)

  const taken = new Set<string>()
  const slots = withKinds.map(({ element, kind }, i) => {
    // Told, then placed, then guessed.
    const named =
      element.slotName ??
      (element.placeholder
        ? FROM_PLACEHOLDER[element.placeholder]
        : undefined) ??
      fallbackNames[i]!
    // Being told a box's kind beats reading it off the shape: a maths box
    // holding a rendered formula looks like a picture, and a code box like
    // prose.
    const spec = element.slotName ? byName.get(element.slotName) : undefined
    return {
      name: unique(named, taken),
      kind: spec?.kind ?? kind,
      box: element.box,
      ...(spec ? { restored: spec } : {}),
      ...(sizeOf(element) !== undefined ? { fontSize: sizeOf(element) } : {}),
      ...(boldOf(element) ? { bold: true } : {}),
      ...(colorOf(element) ? { color: colorOf(element) } : {}),
      ...(element.fill ? { background: element.fill } : {}),
      ...(fontOf(element) ? { fontFamily: fontOf(element) } : {}),
      ...(element.align ? { align: element.align } : {}),
      ...(element.vAlign ? { vAlign: element.vAlign } : {}),
      content: element,
    }
  })

  return {
    slideId: page.id,
    slots,
    decoration: page.elements
      .filter(e => e.kind === 'decoration')
      .map(e => ({
        box: e.box,
        ...(e.fill ? { fill: e.fill } : {}),
        ...(e.shapeType ? { shapeType: e.shapeType } : {}),
      })),
    ...(page.background ? { background: page.background } : {}),
    ...(page.backgroundImage ? { backgroundImage: page.backgroundImage } : {}),
  }
}

/**
 * The coarse key two slides must share before their geometry is even compared
 * (pass 1).
 *
 * Which boxes a slide has, not where they are. Slides with different
 * compositions never merge however similar they look, which is exact, free,
 * and prevents the worst mistakes — a title-and-picture slide never becomes a
 * title-and-bullets one.
 */
export const compositionKey = (candidate: Candidate): string =>
  candidate.slots
    .map(s => `${s.name}:${s.kind}`)
    .sort()
    .join('|')
