/**
 * Slide-style template and layout data models (SPEC §7, §15).
 * Layout descriptors double as the AI-facing option set for layout
 * selection (TMPL-6 / GEN-6).
 */

/** Conventional layout types every template provides (TMPL-2). */
export const LAYOUT_TYPES = [
  'title',
  'section',
  'content',
  'list',
  'image-heavy',
  'two-column',
  'quote',
] as const

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
 * Word counts are approximate ceilings; the server also enforces them
 * (overflowing updates become new slides) so slides stay readable. */
export interface LayoutConstraints {
  maxBullets?: number
  /** Legacy character cap for body text. */
  maxBodyLength?: number
  maxTitleWords?: number
  maxBodyWords?: number
  maxBulletWords?: number
  maxCaptionWords?: number
  imageRequired?: boolean
}

/**
 * A single layout within a template. `purpose`, `slots`, and `constraints`
 * form the machine-readable descriptor serialized into generation requests.
 */
export interface Layout {
  type: LayoutType
  label: string
  purpose: string
  slots: LayoutSlot[]
  constraints?: LayoutConstraints
  /** Positioning of content elements; shape is renderer-defined for now. */
  elementPositions: Record<string, unknown>
}

/** The AI-facing subset of a Layout sent with generation requests (GEN-6). */
export type LayoutDescriptor = Pick<
  Layout,
  'type' | 'label' | 'purpose' | 'slots' | 'constraints'
>

export interface Template {
  id: string
  ownerId: string
  name: string
  /** Visual theme: colors, typography, spacing. Shape is renderer-defined for now. */
  theme: Record<string, unknown>
  layouts: Layout[]
  visibility: 'private' | 'unlisted' | 'public'
  voteScore: number
  createdAt: string
}
