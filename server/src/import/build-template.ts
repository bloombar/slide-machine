/**
 * The template a consolidated deck becomes (TMPL-8, stage 3).
 *
 * Everything before this speaks the importer's own vocabulary — candidates,
 * clusters, derived layouts. This is where it becomes the thing the rest of
 * the system already knows how to draw, edit, export and generate into: a
 * `Template` no different from one written by hand in the editor.
 *
 * ## No tree
 *
 * An imported design arrives as absolute geometry, so its layouts carry
 * `elementPositions` and no `tree` — which the template model already allows
 * for exactly this case. `renderMode: 'positioned'` is what tells the renderer
 * to draw the boxes where the presentation had them rather than flow them.
 *
 * ## Nothing here trusts the earlier stages
 *
 * Boxes are clamped, names are made unique and slug-shaped, descriptions are
 * capped. The template schema would reject a bad value anyway; catching it
 * here means the author gets a template rather than an error.
 */
import {
  MAX_SLOT_DESCRIPTION,
  WHITEBOARD_LAYOUT_TYPE,
  type ElementPositions,
  type ImportReport,
  type LayoutDecoration,
  type Layout,
  type SlotSpec,
} from '@slide-machine/shared'
import type { DerivedLayout } from './consolidate'
import type { CandidateSlot } from './candidate'
import type { SourcePresentation } from './source-presentation'
import { ruleBasedType } from './semantics'

/** What an import did, in the terms the report is written in. Declared in
 * `shared` because the screen that shows it is the point of it, and two copies
 * of the shape would be two things to keep in step. */
export type { ImportReport }

/**
 * Which of the app's own font stacks a presentation's typeface becomes.
 *
 * A presentation names whatever font its author had. Reproducing that exactly
 * would mean fetching a font from a third party every time a slide is shown —
 * a privacy leak on every view, and an unreadable deck offline (docs/
 * TEMPLATES.md §5). So a name is mapped onto one of the stacks already on the
 * reader's machine, keyed exactly as the template editor's picker keys them
 * (`client/src/components/slide/fonts.ts`).
 *
 * Approximate by design: the trade is a typeface that resembles the original
 * rather than a request to a font host.
 */
const FONT_FAMILIES: { key: string; pattern: RegExp }[] = [
  // Monospace first: "Courier New" reads as serif by name and is monospaced
  // in fact, and being fixed-width is the property that matters.
  {
    key: 'mono',
    pattern:
      /(mono|courier|consol|menlo|code|typewriter|inconsolata|jetbrains|anonymous pro)/i,
  },
  // Then the hand-drawn ones, before anything that could claim them by a
  // shared word: "Brush Script" is a hand, not a serif.
  {
    key: 'handwritten',
    pattern:
      /(caveat|indie flower|pacifico|dancing script|comic sans|shadows into light|patrick hand|kalam|architects daughter|permanent marker|satisfy|courgette|gloria hallelujah|handlee|bradley hand|segoe script|brush script|chalkboard|marker felt|script|handwrit)/i,
  },
  // Narrow display faces, which a title in Oswald or Bebas depends on: set in
  // an ordinary sans they lose the line breaks the author wrote around them.
  {
    key: 'condensed',
    pattern:
      /(oswald|bebas|anton|archivo black|impact|narrow|condensed|teko|fjalla|haettenschweiler|league gothic)/i,
  },
  {
    key: 'geometric',
    pattern:
      /(futura|century gothic|avenir|nunito|poppins|montserrat|jost|raleway|josefin|quicksand|comfortaa|questrial|urbanist|outfit|didact)/i,
  },
  {
    key: 'humanist',
    pattern:
      /(optima|candara|gill sans|trebuchet|tahoma|verdana|lato|calibri|corbel|myriad|frutiger|segoe ui|ubuntu|pt sans|cabin|karla)/i,
  },
  {
    key: 'serif',
    pattern:
      /(times|georgia|garamond|cambria|palatino|baskerville|merriweather|playfair|didot|lora|cardo|spectral|crimson|bookman|book antiqua|constantia|caslon|cormorant|slab|arvo|rockwell|bitter|museo|vollkorn|tinos|droid serif|pt serif|noto serif|source serif|libre|serif)/i,
  },
]

/** The stack closest to a font nobody can be asked to download. Anything
 * unrecognized is sans, which is what most presentation type is. */
export const mapFont = (family: string | undefined): string | undefined => {
  if (!family?.trim()) return undefined
  return FONT_FAMILIES.find(f => f.pattern.test(family))?.key ?? 'sans'
}

/** The blank slate every template must offer (TMPL-7). No presentation has
 * one to import, so it is synthesized. */
const WHITEBOARD_LAYOUT: Layout = {
  type: WHITEBOARD_LAYOUT_TYPE,
  label: 'Whiteboard',
  purpose: 'A blank slate for freehand drawing',
  slots: [],
  elementPositions: {},
}

/** A layout type as a slug, since it keys a slide's `layoutType` and the AI's
 * option set. */
const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'layout'

/** Title Case, for the name an author reads in the layout menu. */
const titleCase = (value: string): string =>
  value
    .split('-')
    .filter(Boolean)
    .map(word => word[0]!.toUpperCase() + word.slice(1))
    .join(' ')

/** Keeps a name unique within a set, since a duplicate layout type would make
 * one of the two unreachable. */
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

/** A box the template schema will accept: inside the slide, and never zero. */
const safeBox = (box: { x: number; y: number; w: number; h: number }) => {
  const x = Math.min(Math.max(box.x, 0), 0.99)
  const y = Math.min(Math.max(box.y, 0), 0.99)
  return {
    x,
    y,
    w: Math.min(Math.max(box.w, 0.01), 1 - x),
    h: Math.min(Math.max(box.h, 0.01), 1 - y),
  }
}

/** The label an author reads beside a box. A described box says what it is;
 * an undescribed one is named after itself. */
const slotLabel = (name: string): string => titleCase(slug(name))

/**
 * The parts of a design that hold no content: a full-bleed background picture
 * first, then the bands and rules drawn over it.
 *
 * Every picture is the template's **own stored copy**. A presentation's image
 * URLs are short-lived, so a template that merely remembered them would look
 * right for an hour and then be full of holes — which is why the import
 * fetches them, and why one that would not come is left out rather than
 * pointed at.
 */
const decorationOf = (
  derived: DerivedLayout,
  assets: Map<string, string>,
): LayoutDecoration[] => {
  const pieces: LayoutDecoration[] = []

  // The colour this design is painted in, before anything drawn on top of it.
  //
  // A template has ONE theme background, and a deck whose slides are each a
  // different colour has as many as it has designs. Consolidation already
  // keeps those apart — two slides of different colours are never one layout —
  // but the colour was then dropped on the way into the layout, so every
  // design came out wearing the first slide's. A red deck, a blue slide and an
  // orange slide arrived as three red layouts.
  if (derived.background) {
    pieces.push({ x: 0, y: 0, w: 1, h: 1, fill: derived.background })
  }

  const background = derived.backgroundImage
    ? assets.get(derived.backgroundImage)
    : undefined
  if (background) {
    pieces.push({ x: 0, y: 0, w: 1, h: 1, imageUrl: background })
  }

  // A logo reaches a design by two routes — inherited from the layout, and
  // recognized as the picture every slide of the cluster repeats — and a deck
  // that does both would paint it twice, at the same size, in the same corner.
  const drawn = new Set<string>()
  for (const piece of derived.decoration) {
    const stored = piece.imageUrl ? assets.get(piece.imageUrl) : undefined
    // A band with neither a fill nor a picture would paint nothing.
    if (!piece.fill && !stored) continue
    const box = safeBox(piece.box)
    const key = [
      box.x,
      box.y,
      box.w,
      box.h,
      piece.fill ?? '',
      stored ?? '',
      piece.shapeType ?? '',
    ].join('|')
    if (drawn.has(key)) continue
    drawn.add(key)
    pieces.push({
      ...box,
      ...(piece.fill ? { fill: piece.fill } : {}),
      ...(stored ? { imageUrl: stored } : {}),
      ...(piece.shapeType ? { shape: piece.shapeType } : {}),
    })
  }
  // Bounded to what the schema accepts, so an unusually busy deck cannot
  // produce a layout that will not save.
  return pieces.slice(0, 32)
}

/* --- Enough room for what a box actually holds ------------------------- *
 *
 * A source box is measured as the source drew it, and the two renderers do
 * not agree to the pixel: a box that fitted four points in Slides can fit two
 * here, and an imported layout draws its boxes at a fixed height with
 * anything over the edge hidden. The lecture was whole and looked cut in
 * half — the points were there, below the fold of a box too short to show
 * them.
 *
 * So a box is allowed to grow to fit its own content. Only to grow, and only
 * downward into space nothing else is using, because the geometry is the
 * design and this is the one thing it must not be allowed to do: hide the
 * lecture.
 */

/** Roughly a character's width, as a fraction of the type size. */
const CHAR_W = 0.5
/** A line's full height, as a fraction of the type size. */
const LINE_H = 1.5
/** A 16:9 slide is this many `cqi` tall — `cqi` being a percent of its WIDTH. */
const SLIDE_H_CQI = 56.25

/**
 * The height a box's own content needs, as a fraction of the slide's height.
 * Zero when nothing is known about what it holds.
 *
 * An estimate — there is no browser here — and deliberately a generous one.
 * Being a little taller than needed costs nothing on a box with space beneath
 * it; being too short costs the reader the end of every list.
 */
const heightForText = (slot: CandidateSlot): number => {
  const { held, fontSize, box } = slot
  if (!held || !fontSize) return 0
  const perLine = Math.max(1, Math.floor((box.w * 100) / (fontSize * CHAR_W)))
  // Every line is assumed as long as the longest, since only the longest was
  // measured. It is the generous reading, which is the right way to be wrong
  // about a box that would otherwise hide the end of a list.
  const rows = held.lines * Math.max(1, Math.ceil(held.longest / perLine))
  return (rows * fontSize * LINE_H) / SLIDE_H_CQI
}

/**
 * How far a box may grow before it would reach something else.
 *
 * Only boxes it actually sits above count — a caption beside a picture is not
 * in the way of the text column, and treating it as if it were would keep a
 * list short for no reason.
 */
const roomBelow = (
  box: { x: number; y: number; w: number; h: number },
  others: CandidateSlot[],
): number => {
  const overlapsAcross = (other: { x: number; w: number }) =>
    other.x < box.x + box.w && box.x < other.x + other.w
  const tops = others
    .filter(o => overlapsAcross(o.box) && o.box.y >= box.y + box.h)
    .map(o => o.box.y)
  // A margin off the slide's own bottom edge, so a grown box never runs off.
  const floor = Math.min(1 - 0.02, ...tops)
  return Math.max(box.h, floor - box.y)
}

/** One derived design, as a layout of a template. */
const toLayout = (
  derived: DerivedLayout,
  taken: Set<string>,
  assets: Map<string, string>,
): Layout => {
  const type = unique(slug(derived.type ?? ruleBasedType(derived)), taken)

  // A design with no boxes of its own — a slide that is a colour and a shape,
  // and nothing an author ever typed into. It is still worth keeping as a
  // layout, and a layout must declare at least one box, so it is given one:
  // a body across the middle of the slide, clear of the bands and rules that
  // are usually along an edge. Better than losing the page.
  if (!derived.slots.length) {
    return {
      type,
      label: titleCase(type),
      purpose:
        derived.description ??
        `Imported from ${derived.members.length} slide${derived.members.length === 1 ? '' : 's'} of the source presentation, which carried a design but no text.`,
      slots: [{ name: 'body', kind: 'text', label: 'Body', multiline: true }],
      elementPositions: {
        body: { x: 0.08, y: 0.28, w: 0.84, h: 0.5 },
      },
      ...(decorationOf(derived, assets).length
        ? { decoration: decorationOf(derived, assets) }
        : {}),
    }
  }

  const slots: SlotSpec[] = derived.slots.map(slot =>
    // A box the presentation declared is restored exactly — kind, instruction
    // and limits — because a round trip through our own export must lose
    // nothing (EXP-8). Everything else is inferred, and says so by being
    // inferable.
    slot.restored
      ? { ...slot.restored, name: slot.name }
      : {
          name: slot.name,
          kind: slot.kind,
          label: slotLabel(slot.name),
          ...(slot.description
            ? { description: slot.description.slice(0, MAX_SLOT_DESCRIPTION) }
            : {}),
          // Multi-line when the box is deep enough to hold more than a
          // line, and always when what it holds is Markdown: a list only
          // draws as a list in a block slot, and an inline one would show
          // the hyphens.
          ...(slot.kind === 'text' &&
          (slot.box.h > 0.25 ||
            (slot.content?.runs ?? []).some(r => r.bulleted))
            ? { multiline: true }
            : {}),
        },
  )

  const elementPositions: ElementPositions = {}
  for (const slot of derived.slots) {
    // A picture is not text and is drawn to fit its box; only words can be
    // hidden by one that is too short.
    const grown =
      slot.kind === 'image' || slot.kind === 'table'
        ? slot.box
        : {
            ...slot.box,
            h: Math.min(
              Math.max(slot.box.h, heightForText(slot)),
              roomBelow(slot.box, derived.slots),
            ),
          }
    elementPositions[slot.name] = {
      ...safeBox(grown),
      // Type size and colour came off the slide; keeping them is the whole
      // point of importing a design rather than describing one.
      ...(slot.fontSize ? { fontSize: slot.fontSize } : {}),
      ...(slot.bold ? { fontWeight: 700 } : {}),
      ...(slot.color ? { color: slot.color } : {}),
      // The box's own fill: a deck may put its colour on the boxes rather
      // than on the page, and dropping it imported the design white.
      ...(slot.background ? { background: slot.background } : {}),
      ...(mapFont(slot.fontFamily)
        ? { fontFamily: mapFont(slot.fontFamily) }
        : {}),
      // How the text sits in the box. A centred title read as left-aligned is
      // the most visible way an import stops looking like its source.
      ...(slot.align ? { align: slot.align } : {}),
      ...(slot.vAlign ? { vAlign: slot.vAlign } : {}),
    }
  }

  return {
    type,
    label: titleCase(type),
    purpose:
      derived.description ??
      `Imported from ${derived.members.length} slide${derived.members.length === 1 ? '' : 's'} of the source presentation.`,
    slots,
    // What the source deck was actually built to, so the AI writes slides
    // that sit in the design instead of overflowing it (TMPL-6).
    ...(derived.constraints ? { constraints: derived.constraints } : {}),
    elementPositions,
    ...(decorationOf(derived, assets).length
      ? { decoration: decorationOf(derived, assets) }
      : {}),
  }
}

/** The template a presentation becomes, ready to store. */
export interface BuiltTemplate {
  name: string
  theme: Record<string, unknown>
  layouts: Layout[]
  renderMode: 'positioned'
  /** Which layout each source slide ended on, keyed by slide id — what a
   * lecture import needs to place content (EXP-5). */
  layoutOfSlide: Record<string, string>
}

/**
 * Assembles the template.
 *
 * A presentation with no usable slides still yields a template — an empty one
 * an author can build on — rather than an error. Failing an import because a
 * deck was unusual helps nobody.
 */
export const buildTemplate = (
  source: SourcePresentation,
  layouts: DerivedLayout[],
  assignment: Map<string, number>,
  /** Pictures already fetched into the template's own storage, by the URL the
   * presentation gave. A picture that would not come is simply absent, and the
   * design is drawn without it. */
  assets: Map<string, string> = new Map(),
): BuiltTemplate => {
  // Claimed before any derived layout can take it, so a presentation with a
  // slide the rules happen to call "whiteboard" cannot collide with the blank
  // slate below — it becomes `whiteboard-2` instead.
  const taken = new Set<string>([WHITEBOARD_LAYOUT_TYPE])
  const built = layouts.map(layout => toLayout(layout, taken, assets))

  const layoutOfSlide: Record<string, string> = {}
  for (const [slideId, index] of assignment) {
    const layout = built[index]
    if (layout) layoutOfSlide[slideId] = layout.type
  }

  return {
    name: source.title.slice(0, 120) || 'Imported design',
    theme: {
      background: source.theme.background,
      surface: source.theme.background,
      text: source.theme.text,
      muted: source.theme.muted,
      accent: source.theme.accent,
      penColor: source.theme.text,
      highlighterColor: source.theme.accent,
      // What this deck draws a link in, where it says (TMPL-8). A box is
      // stored with one colour and every run inside it is drawn in that one,
      // and the run an author coloured differently is nearly always a link —
      // so a deck whose links are red got them in the body's black. Only
      // present when the deck states one worth carrying.
      ...(source.theme.link ? { link: source.theme.link } : {}),
    },
    // Every template must offer a blank slate to draw on (TMPL-7), and no
    // presentation has one to import — so it is synthesized rather than
    // derived. Last, because it is the least likely layout to want.
    layouts: [...built, WHITEBOARD_LAYOUT],
    renderMode: 'positioned',
    layoutOfSlide,
  }
}

/**
 * What to tell the instructor.
 *
 * Consolidation is lossy, and this is the only visibility into it — so it is
 * a deliverable, not a nicety. Structured rather than a sentence, because the
 * app speaks five languages and the sentence is the client's to write.
 */
export const importReport = (
  source: SourcePresentation,
  layouts: DerivedLayout[],
  approximated: number,
  assetsFailed: number,
): ImportReport => {
  const biggest = [...layouts].sort(
    (a, b) => b.members.length - a.members.length,
  )[0]
  return {
    slidesRead: source.slides.length,
    layoutsCreated: layouts.length,
    ...(biggest && biggest.members.length > 1
      ? {
          largestMerge: {
            type: biggest.type ?? ruleBasedType(biggest),
            slides: biggest.members.length,
          },
        }
      : {}),
    approximated,
    assetsFailed,
  }
}
