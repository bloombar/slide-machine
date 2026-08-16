/**
 * Mapping a source slide's content onto the layout it was assigned (EXP-5).
 *
 * Deriving the template already decided which design each slide belongs to
 * (TMPL-8), so nothing is re-guessed here: the layout is known, and what
 * remains is filling its boxes from the boxes the slide actually had.
 *
 * ## Why this is deterministic rather than a model call
 *
 * The slide already says what its content is. A title box holds a title; a
 * box of bulleted paragraphs holds bullets. Asking a model to decide would be
 * slower, cost money, and be wrong sometimes — for a question the presentation
 * has already answered. The model's job in an import is naming layouts
 * (TMPL-8 pass 5), not reading text off slides.
 *
 * ## Two sources, again
 *
 * A presentation this system exported carries each box's declaration (EXP-8),
 * so its kind is restored rather than inferred and the round trip gives back
 * what it wrote. A deck from anywhere else has only its shapes, and is mapped
 * by what they hold.
 */
import type { SlotValue } from '@slide-machine/shared'
import type { Candidate, CandidateSlot } from './candidate'
import type { SourceElement } from './source-presentation'

/** One imported slide, ready to be stored. */
export interface ImportedSlide {
  /** The source slide it came from, so a report can name it. */
  slideId: string
  /** The layout the design analysis put it on — never re-guessed. */
  layoutType: string
  /** Content by slot name, the way a slide stores it (TMPL-9). */
  slots: Record<string, SlotValue>
  /** What the presenter said over it, when that is known to be narration. */
  sourceTranscript?: string
  /** Boxes whose material was dropped, named rather than silently lost. */
  dropped: string[]
}

/**
 * Whether a box holds anything at all.
 *
 * `candidateOf` gives every slot its element, so the element being present
 * says nothing: a placeholder inherited from the layout and never typed into
 * is a real element with no words. Asking whether the property exists
 * reported every untouched box on every slide as material that did not fit,
 * which is the opposite of true — nothing was there to lose.
 */
const holdsSomething = (element: SourceElement): boolean =>
  (element.runs ?? []).some(run => run.text.trim()) ||
  Boolean(element.imageUrl) ||
  Boolean(element.table?.rows.length)

/** The words in a box, as one string. Runs carry styling the slide's content
 * does not keep — the design took that already. */
const textOf = (slot: CandidateSlot): string =>
  (slot.content?.runs ?? [])
    .map(run => run.text)
    .join('')
    .trim()

/**
 * The words in a box, as a list.
 *
 * A run is not a line and never was: Google splits one wherever styling
 * changes, so a point with a bold word in it is several runs, and a line
 * broken inside a paragraph puts several lines in one run. Counting runs
 * therefore both split points that were whole and joined points that were
 * separate.
 *
 * The words are put back together and cut on the line ends the reader
 * established, which is the only place a list's points actually are.
 */
const itemsOf = (slot: CandidateSlot): string[] =>
  (slot.content?.runs ?? [])
    .map(run => run.text)
    .join('')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

/**
 * What a box's content is, in the slot vocabulary.
 *
 * The declaration wins wherever there is one (EXP-8): a box exported as `code`
 * holds a listing even though nothing about the shape says so, which is
 * exactly what inference could never recover. Otherwise the shape decides.
 */
const valueOf = (
  slot: CandidateSlot,
  imageRef: (url: string) => string | undefined,
): SlotValue | undefined => {
  const element = slot.content
  if (!element) return undefined

  const kind = slot.restored?.kind

  if (element.kind === 'image' || kind === 'image') {
    // A picture the app owns, so the lecture does not depend on the Google
    // file continuing to exist (EXP-5).
    const ref = element.imageUrl ? imageRef(element.imageUrl) : undefined
    if (!ref) return undefined
    // Its provenance too, where the export wrote it into the alt text
    // (IMG-5/EXP-8) — a licence that requires attribution is not satisfied by
    // a picture that came home anonymous.
    return {
      kind: 'image',
      ref,
      source: 'seeded',
      ...(element.attribution ? { attribution: element.attribution } : {}),
    }
  }

  if (element.kind === 'table' || kind === 'table') {
    const rows = element.table?.rows ?? []
    return rows.length ? { kind: 'table', rows } : undefined
  }

  // Declared kinds that geometry cannot recover. Each takes the box's words
  // as they are: a listing's indentation and a formula's tokens are content,
  // so neither is trimmed per line the way prose is.
  if (kind === 'code') {
    const source = (element.runs ?? []).map(run => run.text).join('')
    return source.trim() ? { kind: 'code', source } : undefined
  }
  if (kind === 'math') {
    const tex = textOf(slot)
    return tex ? { kind: 'math', tex } : undefined
  }
  if (kind === 'preformatted') {
    const value = (element.runs ?? []).map(run => run.text).join('')
    return value.trim() ? { kind: 'preformatted', value } : undefined
  }

  if (kind === 'bullets' || (!kind && element.bulleted)) {
    const items = itemsOf(slot)
    return items.length ? { kind: 'bullets', items } : undefined
  }

  const value = textOf(slot)
  return value ? { kind: 'text', value } : undefined
}

/**
 * Fills one slide's slots from the boxes it had.
 *
 * `imageRef` turns a source picture URL into the stored asset the app owns;
 * a picture that did not come back has no ref, and the box is reported as
 * dropped rather than written as a broken reference.
 */
export const importedSlide = (
  candidate: Candidate,
  layoutType: string,
  imageRef: (url: string) => string | undefined,
  notes?: string,
): ImportedSlide => {
  const slots: Record<string, SlotValue> = {}
  const dropped: string[] = []

  for (const slot of candidate.slots) {
    // A box with nothing in it is not a loss: the design has the box, and an
    // empty one is what an author left there. Only material that existed and
    // could not be carried is reported (EXP-5).
    if (!slot.content || !holdsSomething(slot.content)) continue
    const value = valueOf(slot, imageRef)
    if (value) slots[slot.name] = value
    else dropped.push(slot.name)
  }

  return {
    slideId: candidate.slideId,
    layoutType,
    slots,
    ...(notes?.trim() ? { sourceTranscript: notes.trim() } : {}),
    dropped,
  }
}
