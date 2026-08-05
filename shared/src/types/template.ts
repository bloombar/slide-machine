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
  /** Per-slot validation: approximate character ceiling (overrides
   * the layout-level constraint for this slot). */
  maxChars?: number
  /** Reserved: per-slot styling authored in the template editor. */
  style?: Record<string, unknown>
  /** Reserved: arbitrary author metadata. */
  metadata?: Record<string, unknown>
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
export interface SlotBox {
  /** Distance from the left edge, 0–1. */
  x: number
  /** Distance from the top edge, 0–1. */
  y: number
  /** Width, 0–1. */
  w: number
  /** Height, 0–1. */
  h: number
  /** Horizontal alignment of the content within the box. */
  align?: 'start' | 'center' | 'end'
  /** Vertical alignment of the content within the box. */
  vAlign?: 'start' | 'center' | 'end'
  /** Font size in `cqi` (percent of slide width), matching how the hand-tuned
   * components size type so the two look alike at any scale. */
  fontSize?: number
  fontWeight?: number
  /** A hex value, or a theme key (`accent`, `muted`, …) so a template's
   * palette stays the single source of truth. */
  color?: string
}

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
  /** Where each slot sits, keyed by slot name. Empty means "arrange this
   * layout with its hand-tuned component" (TMPL-4). */
  elementPositions: ElementPositions
}

/** The AI-facing subset of a Layout sent with generation requests (GEN-6). */
export type LayoutDescriptor = Pick<
  Layout,
  'type' | 'label' | 'purpose' | 'slots' | 'constraints'
>

/**
 * Which renderer draws a template's layouts (TMPL-4).
 *
 * Explicit rather than inferred from "does this layout have geometry".
 * Geometry has two consumers — the positioned renderer and the exporters —
 * so giving a built-in boxes purely to improve its PDF must not silently
 * change how it looks on screen. One field keeps the two apart.
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
