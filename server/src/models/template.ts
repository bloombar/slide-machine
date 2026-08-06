/**
 * User-authored style templates (SPEC §15 / TMPL-4). The document holds the
 * same shape as a built-in template file (docs/TEMPLATES.md) — theme, layouts,
 * slots, constraints — so a template behaves identically whether it was
 * shipped as JSON or written in the editor, and every consumer downstream is
 * indifferent to where it came from.
 *
 * `theme` and `layouts` are stored loosely on purpose. Their shape is owned by
 * the shared types and enforced by the same zod schema the file loader uses,
 * so validation lives in one place rather than being restated as a Mongoose
 * schema that could drift from it.
 */
import { Schema, model, Types, type HydratedDocument } from 'mongoose'
import type {
  Layout,
  Template,
  TemplateRenderMode,
} from '@slide-machine/shared'
import { softDeletePlugin } from './plugins/soft-delete'
import { adoptDefaultTree, normalizePositions } from '../templates/builtin'

export interface TemplateDb {
  ownerId: Types.ObjectId
  name: string
  /** How its layouts are drawn; absent means the hand-tuned components. */
  renderMode?: TemplateRenderMode
  theme: Record<string, unknown>
  layouts: Layout[]
  /** Private by default; unlisted or public once the author shares it. */
  visibility: 'private' | 'unlisted' | 'public'
  /** Net vote score, denormalized like a deck's so lists can sort on it. */
  voteScore: number
  createdAt: Date
  updatedAt: Date
  /** Soft-delete tombstone (P-10); null/absent = live. */
  deletedAt?: Date | null
}

const templateSchema = new Schema<TemplateDb>(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    renderMode: { type: String, enum: ['components', 'positioned'] },
    theme: { type: Schema.Types.Mixed, required: true },
    layouts: { type: Schema.Types.Mixed, required: true },
    visibility: {
      type: String,
      enum: ['private', 'unlisted', 'public'],
      default: 'private',
    },
    voteScore: { type: Number, default: 0 },
  },
  { timestamps: true },
)

templateSchema.plugin(softDeletePlugin)

export const TemplateModel = model<TemplateDb>('Template', templateSchema)

/**
 * The wire shape. A stored template's id is its document id, which is what a
 * deck or project stores in `templateId` — the same field that holds a
 * built-in's slug, so the two are interchangeable to every reader.
 */
export const toTemplateDto = (doc: HydratedDocument<TemplateDb>): Template => ({
  id: doc._id.toString(),
  ownerId: doc.ownerId.toString(),
  name: doc.name,
  renderMode: doc.renderMode,
  theme: doc.theme,
  // Two rescues, both for templates saved before the model changed under
  // them: boxes that still hold percentages would be drawn far off the slide,
  // and a layout with neither tree nor geometry relied on a component that no
  // longer exists. Applied on read, so no stored document is rewritten.
  layouts: adoptDefaultTree(normalizePositions(doc.layouts)),
  visibility: doc.visibility,
  voteScore: doc.voteScore,
  createdAt: doc.createdAt.toISOString(),
})
