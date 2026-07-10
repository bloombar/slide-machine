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

/** Constraints the AI must respect when filling a layout (TMPL-6). */
export interface LayoutConstraints {
  maxBullets?: number
  maxBodyLength?: number
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
