/**
 * A presentation as this system reads it, before anything is decided about it
 * (TMPL-8, docs/TEMPLATES.md §6 stage 1).
 *
 * Google's shape is verbose, deeply nested and specific to Google. Nothing
 * downstream should have to know that a box is a `size` and a `transform`
 * rather than a rectangle, or that a colour might be a theme reference. So the
 * reader flattens all of it into this, and derivation, consolidation and
 * mapping read only from here.
 *
 * That seam is the point: a PowerPoint reader would produce the same shape and
 * everything after it would work unchanged.
 *
 * ## Everything is normalized
 *
 * Boxes are fractions of the page, 0–1 from the top-left — the same vocabulary
 * `elementPositions` uses, so a derived layout needs no unit conversion.
 * Type sizes are `cqi`, a percent of the page WIDTH, which is what the
 * template model measures type in. Colours are `#rrggbb`, resolved against the
 * master's scheme, because a theme reference means nothing outside the
 * presentation it came from.
 */ import type { ImageAttribution } from '@slide-machine/shared'

/** A rectangle on the page, 0–1 from the top-left. */
export interface SourceBox {
  x: number
  y: number
  w: number
  h: number
}

/** One run of text, with the styling that survives the trip. */
export interface SourceRun {
  text: string
  /** Percent of the page width, matching the template model's `cqi`. */
  fontSize?: number
  bold?: boolean
  italic?: boolean
  /** `#rrggbb`, already resolved from any theme reference. */
  color?: string
  /** The family as the presentation names it. Mapped to a bundled stack
   * later; never fetched at display time (docs/TEMPLATES.md §5). */
  fontFamily?: string
  /** Where this run points, when the author made it a link. */
  link?: string
  /**
   * Whether the paragraph this run belongs to is a bullet.
   *
   * Per run, not per box, because a box is often both: a sentence of context,
   * then the points that follow, then a closing line. Read as one kind the
   * whole box became a list, and the prose around it came back as bullets
   * nobody wrote.
   */
  bulleted?: boolean
  /** How deeply the point is indented, 0 for a top-level one. Google keeps
   * sub-points as nesting levels rather than as separate boxes. */
  bulletLevel?: number
  /** A numbered point rather than a bulleted one: the list it belongs to is
   * drawn with digits or letters. */
  ordered?: boolean
}

/** What a shape on the page turned out to hold. */
export type SourceElementKind = 'text' | 'image' | 'table' | 'decoration'

export interface SourceElement {
  id: string
  kind: SourceElementKind
  box: SourceBox
  /**
   * Google's placeholder type where the shape has one — `TITLE`, `BODY`,
   * `SUBTITLE`, `PICTURE`. A strong hint about what a box is for, and the
   * only structural signal a hand-built deck usually offers.
   */
  placeholder?: string
  /**
   * The slot this shape IS, when the presentation was exported by this system
   * (EXP-8). Present only on our own exports, and worth more than every
   * inference below put together.
   */
  slotName?: string
  runs?: SourceRun[]
  /** Text laid out as a list rather than a paragraph. */
  bulleted?: boolean
  /** Where the picture lives. Short-lived, so it is fetched at import time. */
  imageUrl?: string
  /**
   * Where the picture came from, when this system exported the presentation
   * and wrote it into the alt text (IMG-5/EXP-8).
   *
   * Neither Slides nor PowerPoint has a field for provenance, so a deck
   * exported, edited there and imported back used to come home with anonymous
   * pictures — and a licence that requires attribution silently unsatisfied.
   */
  attribution?: ImageAttribution
  table?: {
    rows: string[][]
    /**
     * How the table divides itself, as fractions of its own width and height
     * (EDIT-7). Google states a width for every column and a height for every
     * row; discarding them and drawing equal columns is one of the plainest
     * ways an imported table stops looking like the slide it came from.
     */
    colWidths?: number[]
    rowHeights?: number[]
  }
  /** How the text sits in its box: across, then down. A centred title read as
   * left-aligned is the single most visible way an import stops looking like
   * the deck it came from. */
  align?: 'start' | 'center' | 'end'
  vAlign?: 'start' | 'center' | 'end'
  /** A shape with no content, drawn from its fill — a rule or a band. */
  fill?: string
  /**
   * What the shape IS, as the presentation names it: `RIGHT_ARROW`, `ELLIPSE`,
   * `CHEVRON`. Without it every shape is a rectangle, which is what an arrow
   * imported as — a grey box where the deck had an arrow.
   */
  shapeType?: string
}

/** A page: one of the presentation's own layouts, or one of its slides. */
export interface SourcePage {
  id: string
  /** A layout's display name, where it has one. */
  name?: string
  /** For a slide, the id of the layout it is built on. */
  layoutId?: string
  background?: string
  /** A picture filling the page behind everything, where the page has one.
   * Google serves it at a short-lived URL, so an import fetches it. */
  backgroundImage?: string
  elements: SourceElement[]
  /** The slot metadata this system wrote when it exported the presentation
   * (EXP-8): the boxes of this page, by name. Absent for anything else. */
  slotMetadata?: Record<string, unknown>[]
  /** What each text role means, where this page carries it — a template we
   * exported states it so a re-import restores the scale rather than deriving
   * a fresh one from resolved letterforms (EXP-8). */
  themeStyles?: Record<string, unknown>
  /** What the presenter said over this slide, from the speaker notes
   * (EXP-8/EDIT-6). Slides only. */
  notes?: string
}

/** The colours a presentation is drawn in, resolved to literals. */
export interface SourceTheme {
  background: string
  text: string
  accent: string
  muted: string
  /**
   * What this deck draws a hyperlink in, where it says.
   *
   * A box is stored with one colour, so every run inside it is drawn in that
   * one — and the run an author coloured differently is nearly always a link.
   * A deck whose links are red came back with them in the body's black,
   * because the box took the colour of its first run. The link colour is the
   * design's, so it is carried on the theme and the links are drawn in it.
   */
  link?: string
}

/** A whole presentation, ready to derive a design from. */
export interface SourcePresentation {
  id: string
  title: string
  theme: SourceTheme
  /** The presentation's own layouts, where it defines any worth using. */
  layouts: SourcePage[]
  slides: SourcePage[]
}
