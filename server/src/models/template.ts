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
  /** Where the template is reachable: `/t/:permalinkSlug`. Optional in the
   * schema because templates authored before the editor had a page of its
   * own have none; those read as their document id (see `toTemplateDto`) and
   * are given a real slug the next time they are saved. */
  permalinkSlug?: string
  /** How its layouts are drawn; absent means the hand-tuned components. */
  renderMode?: TemplateRenderMode
  theme: Record<string, unknown>
  layouts: Layout[]
  /** What the design asks the AI to keep in mind for every lecture drawn
   * with it (GEN-6/GEN-11). */
  aiInstructions?: string
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
    // Sparse: the templates that predate permalinks have no slug, and a
    // unique index would otherwise treat them all as one collision.
    permalinkSlug: { type: String, unique: true, sparse: true },
    renderMode: { type: String, enum: ['components', 'positioned'] },
    theme: { type: Schema.Types.Mixed, required: true },
    layouts: { type: Schema.Types.Mixed, required: true },
    aiInstructions: { type: String },
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
  // A template made before permalinks existed is addressed by its id, so
  // every template has a working `/t/:slug` whether or not it has a slug.
  permalinkSlug: doc.permalinkSlug ?? doc._id.toString(),
  name: doc.name,
  renderMode: doc.renderMode,
  theme: doc.theme,
  // Two rescues, both for templates saved before the model changed under
  // them: boxes that still hold percentages would be drawn far off the slide,
  // and a layout with neither tree nor geometry relied on a component that no
  // longer exists. Applied on read, so no stored document is rewritten.
  layouts: adoptDefaultTree(normalizePositions(doc.layouts)),
  ...(doc.aiInstructions ? { aiInstructions: doc.aiInstructions } : {}),
  visibility: doc.visibility,
  voteScore: doc.voteScore,
  createdAt: doc.createdAt.toISOString(),
})
