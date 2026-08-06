/**
 * Slide-style template and layout data models (SPEC §7, §15).
 * Layout descriptors double as the AI-facing option set for layout
 * selection (TMPL-6 / GEN-6).
 */

/** The conventional layout types (TMPL-2): a preferred vocabulary every
 * template covers, NOT a closed set — a template may name a layout of its own
 * where none of these describes the design (TMPL-9). Shared names are what
 * let layouts be compared and merged on import (TMPL-8). The `whiteboard`
 * layout is a required blank slate — no slots, never auto-selected by
 * generation — that the user draws on with the whiteboard tools (WB-1). */
export const LAYOUT_TYPES = [
  'title',
  'section',
  'content',
  'list',
  'image-heavy',
  'two-column',
  'quote',
  'whiteboard',
] as const

/** The blank-slate layout every template must provide (a drawing canvas
 * with no content slots); excluded from the AI's layout option set. */
export const WHITEBOARD_LAYOUT_TYPE = 'whiteboard'

export type LayoutType = (typeof LAYOUT_TYPES)[number]

/** Content slots a layout can expose. */
export type LayoutSlot =
  'title' | 'body' | 'bullets' | 'image' | 'caption' | 'columns'

/**
 * Media kind of a content slot. The client keeps a registry of one
 * editor component per kind, so this union is the extension point for
 * new editable media types (video, embeds, ...).
 */
export type SlotKind = 'text' | 'bullets' | 'image'

/** How a content slot is displayed and edited. */
export interface SlotDescriptor {
  kind: SlotKind
  /** Accessible label for the slot's editor ("Slide title", ...). */
  label: string
  /** Text slots only: edit as a multi-line block. */
  multiline?: boolean
}

/**
 * The descriptor for every slot a layout can name. Adding an editable
 * media type means: extend SlotKind, describe the slots that use it
 * here, and register a client editor for the kind.
 *
 * These labels are the English defaults the server normalizes bare-name
 * slots to, so a template file and the wire format always carry one. The
 * client shows a translated label instead for these conventional slots
 * (`slot.<name>` in the locale bundles); a label a template author wrote
 * for a slot of their own is data and is shown as written (docs/I18N.md).
 */
export const SLOT_DESCRIPTORS: Record<LayoutSlot, SlotDescriptor> = {
  title: { kind: 'text', label: 'Slide title' },
  body: { kind: 'text', label: 'Slide body', multiline: true },
  bullets: { kind: 'bullets', label: 'Slide bullets' },
  caption: { kind: 'text', label: 'Slide caption' },
  image: { kind: 'image', label: 'Slide image' },
  columns: { kind: 'text', label: 'Slide columns', multiline: true },
}

/** Constraints the AI must respect when filling a layout (TMPL-6).
 * Character counts are approximate ceilings; the server also enforces
 * them (overflowing updates become new slides) so slides stay readable.
 * Characters, not words, so the caps hold in unspaced languages
 * (e.g. Mandarin) where "word" is undefined. */
export interface LayoutConstraints {
  maxBullets?: number
  maxTitleChars?: number
  maxBodyChars?: number
  maxBulletChars?: number
  maxCaptionChars?: number
  imageRequired?: boolean
}

/**
 * One content slot in a layout — the WYSIWYG-ready form (TMPL-4): a
 * template author (eventually through a visual editor) names the slot,
 * picks its media kind, and attaches labels, validation, styling, and
 * arbitrary metadata. Template files may write conventional slots as
 * bare-name shorthand; loaders normalize to this shape.
 */
export interface SlotSpec {
  name: string
  kind: SlotKind
  label: string
  /** Text slots only: edit as a multi-line block. */
  multiline?: boolean
  /** Per-slot validation: approximate character ceiling. Overrides both the
   * layout-level constraint and the text style's default for this box. */
  maxChars?: number
  /** Bullet lists only: how many points this box holds. Overrides the
   * layout's `maxBullets` and the text style's default. */
  maxItems?: number
  /** Reserved: per-slot styling authored in the template editor. */
  style?: Record<string, unknown>
  /** Reserved: arbitrary author metadata. */
  metadata?: Record<string, unknown>
}

/**
 * How one box paints itself and sets type inside it.
 *
 * Sizes are in `cqi` — a percent of the slide's WIDTH — so type and spacing
 * scale with the slide rather than the window, which is the same unit the
 * renderer and the exporters already speak (docs/TEMPLATES.md §4). Never `px`
 * or `rem`: those stop scaling and land wrong in a PDF.
 *
 * Colors are a hex value or a theme key (`accent`, `muted`, …), so a
 * template's palette stays the single source of truth.
 */
export interface BoxStyle {
  /** Horizontal alignment of the content within the box. */
  align?: 'start' | 'center' | 'end'
  /** Vertical alignment of the content within the box. */
  vAlign?: 'start' | 'center' | 'end'
  /** A named role from the theme's text styles. Any field below overrides
   * what the role supplies, so a box can follow the template and still
   * differ in one respect. */
  textStyle?: string
  /** Font size in `cqi` (percent of slide width). */
  fontSize?: number
  fontWeight?: number
  italic?: boolean
  /** Line height as a multiple of the font size. Unitless, so it scales with
   * the type rather than fighting it. */
  lineHeight?: number
  /** One of the bundled font stacks (client/src/components/slide/fonts.ts).
   * Never a family fetched at display time. */
  fontFamily?: string
  color?: string
  background?: string
  /** Inner padding, `cqi`. `paddingX`/`paddingY` override it per axis — a
   * slide's side margins are usually not its top and bottom ones. */
  padding?: number
  paddingX?: number
  paddingY?: number
  /** Corner radius, `cqi`. */
  radius?: number
  borderColor?: string
  /** Border width, `cqi`. */
  borderWidth?: number
}

/**
 * Where one slot sits on a layout, and how its content sits inside the box
 * (TMPL-4).
 *
 * Coordinates are **normalized 0–1 from the top-left** — the same vocabulary
 * the export layout model already uses (server/src/lib/deck-layout.ts), so
 * geometry means one thing across the app, the PDF and the Slides output. A
 * fraction is resolution-independent: the thumbnail in the library and the
 * full-bleed viewer are the same layout scaled.
 */
export interface SlotBox extends BoxStyle {
  /** Distance from the left edge, 0–1. */
  x: number
  /** Distance from the top edge, 0–1. */
  y: number
  /** Width, 0–1. */
  w: number
  /** Height, 0–1. */
  h: number
}

/** How a container arranges its children: in a row or column, or in a grid.
 * A box that should sit somewhere of its own does not need a container for
 * it — it sets `free` on itself instead. */
export type ContainerMode = 'flex' | 'grid'

/**
 * The basics of one CSS layout system, named as CSS names them.
 *
 * `direction` is separate from `mode` rather than folded into it (a "stack"
 * mode and a "row" mode), so turning a column into a row keeps every other
 * setting the container carries.
 */
export interface ContainerSpec {
  mode: ContainerMode
  /** Flex only. */
  direction?: 'row' | 'column'
  /** Flex only. */
  wrap?: boolean
  /** Grid only. Columns alone is the common case; `rows` is optional. */
  columns?: number
  rows?: number
  /** Space between children, `cqi`. `gapX`/`gapY` override it per axis. */
  gap?: number
  gapX?: number
  gapY?: number
  /** Along the main axis (flex), or `justify-items` (grid). */
  justify?: 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly'
  /** Across the cross axis (flex), or `align-items` (grid). */
  alignItems?: 'start' | 'center' | 'end' | 'stretch'
}

/**
 * One node in a layout's tree: a slot, a container of other nodes, or a piece
 * of decoration.
 *
 * A node's *placement* is decided by its parent's container, not by itself —
 * children of a flex or grid container carry flow sizing (`grow`, `basis`,
 * `colSpan`, …), children of a `free` container carry an absolute `box`. One
 * rule, so the two models live in one tree without a tagged union at every
 * level.
 *
 * A node with neither `slot` nor `children` is decoration — a rule, band, or
 * panel drawn from its style and size. That is what an accent bar under a
 * section heading is.
 */
export interface LayoutNode {
  /** Stable within the layout; how the editor addresses a node. */
  id: string
  /** The slot this node shows. Absent on containers and decoration. */
  slot?: string
  /** Literal characters printed around the slot's content — the quotation
   * marks a quote layout wraps its body in. */
  before?: string
  after?: string
  container?: ContainerSpec
  children?: LayoutNode[]
  /** Flow sizing, read when the PARENT is flex or grid. */
  grow?: number
  shrink?: number
  /** Fraction of the container's main axis, 0–1. */
  basis?: number
  colSpan?: number
  rowSpan?: number
  /** Explicit size as a fraction of the container, either axis. */
  width?: number
  height?: number
  /**
   * Lifts this box out of the flow: it is placed at its own `box` instead of
   * by whatever contains it, and takes no room from its siblings.
   *
   * Per box rather than per container, so one thing can be put exactly where
   * an author wants it without wrapping it in something or giving up the
   * arrangement everything around it relies on.
   */
  free?: boolean
  /** Absolute placement, read when this box is `free`. */
  box?: { x: number; y: number; w: number; h: number }
  style?: BoxStyle
}

/** Authoring guidelines the editor snaps boxes to, as fractions 0–1. Never
 * drawn outside the editor, but kept with the layout so a template someone
 * else opens shows the lines its author worked to. */
export interface LayoutGuides {
  x: number[]
  y: number[]
}

/**
 * A named kind of text a template defines once and its layouts refer to, so
 * restyling "body" restyles every body box rather than sending the author
 * hunting through layouts. Boxes name a role and may override any field.
 */
export interface TextStyleSpec extends Pick<
  BoxStyle,
  'fontFamily' | 'fontSize' | 'fontWeight' | 'italic' | 'lineHeight' | 'color'
> {
  /**
   * About how much text fits a box set in this style, in characters.
   *
   * A budget, not a rule of typography: it is what the AI is told a box holds
   * and what the server trims to, so a heading set at 7cqi does not arrive
   * with a paragraph in it. A box may state its own instead.
   */
  maxChars?: number
  /** Bullet lists only: about how many points fit. */
  maxItems?: number
}

/** The text roles a template defines. Open-ended: these are the ones the
 * built-in layouts use, and a template may carry others. */
export const TEXT_STYLE_ROLES = [
  'title',
  'sectionTitle',
  'heading',
  'body',
  'bullet',
  'caption',
  'quote',
] as const

export type TextStyleRole = (typeof TEXT_STYLE_ROLES)[number]

/**
 * A layout's arrangement: a box per slot name. A layout with no entries is
 * drawn by its hand-tuned component instead, which is what every built-in
 * does today — the two coexist so layouts can move to data one at a time
 * (docs/TEMPLATES.md).
 */
export type ElementPositions = Record<string, SlotBox>

/**
 * A single layout within a template. `purpose`, `slots`, and `constraints`
 * form the machine-readable descriptor serialized into generation requests.
 */
export interface Layout {
  /** A conventional type (TMPL-2), or a name the author chose (TMPL-9). */
  type: string
  label: string
  purpose: string
  slots: SlotSpec[]
  constraints?: LayoutConstraints
  /**
   * How the layout is built: a tree of containers and boxes (TMPL-4). This is
   * what the author edits and what the renderer draws.
   */
  tree?: LayoutNode
  /**
   * Where each slot ends up, keyed by slot name — **derived from `tree` when
   * one exists**, by measuring the rendered layout.
   *
   * It stays because it has readers that cannot run CSS: the PDF, pptx and
   * Slides exporters (server/src/lib/deck-layout.ts), and designs imported
   * from Google Slides, which arrive as absolute geometry with no tree.
   */
  elementPositions: ElementPositions
  /** Authoring guidelines; editor-only (see LayoutGuides). */
  guides?: LayoutGuides
}

/** The AI-facing subset of a Layout sent with generation requests (GEN-6). */
export type LayoutDescriptor = Pick<
  Layout,
  'type' | 'label' | 'purpose' | 'slots' | 'constraints'
>

/**
 * Which renderer draws a template's layouts (TMPL-4).
 *
 * Largely historical now that every layout carries a tree: the renderer picks
 * `tree`, then `elementPositions`, then the generic fallback, and the
 * exporters key off geometry rather than this field. Kept because it is
 * persisted on existing templates and removing it would be a migration for no
 * gain (docs/TEMPLATES.md §4).
 */
export type TemplateRenderMode = 'components' | 'positioned'

export interface Template {
  id: string
  ownerId: string
  name: string
  /** Absent means `components`: the hand-tuned layout components. */
  renderMode?: TemplateRenderMode
  /** Visual theme: colors, typography, spacing. Shape is renderer-defined for now. */
  theme: Record<string, unknown>
  layouts: Layout[]
  visibility: 'private' | 'unlisted' | 'public'
  voteScore: number
  createdAt: string
}
