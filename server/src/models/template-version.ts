/**
 * Immutable template snapshots (SPEC §15 / TMPL-11).
 *
 * A deck is drawn with the version it pins, not with whatever its template
 * says today. That is what keeps a template edit — or a deploy that ships a
 * changed built-in — from restructuring lectures already built on it.
 *
 * Rows are shared rather than copied per deck: `templateId + contentHash` is
 * unique, so every deck on the same unchanged template pins the same document
 * and a template that is never edited costs exactly one row however many
 * lectures use it.
 *
 * Nothing here is ever updated. Applying an update repoints a deck at a newer
 * row; it never rewrites an old one, which is what lets a deck sit on the
 * structure it was authored against for as long as it likes.
 *
 * `theme` and `layouts` are stored loosely for the same reason they are on
 * `TemplateModel`: their shape is owned by the shared types and validated by
 * one zod schema, rather than restated here where it could drift.
 */
import { Schema, model, Types, type HydratedDocument } from 'mongoose'
import type {
  Layout,
  TemplateRenderMode,
  TemplateVersion,
} from '@slide-machine/shared'

export interface TemplateVersionDb {
  /** A built-in's slug or a stored template's document id, as a string —
   * `templateId` holds both on a deck, so it holds both here too. */
  templateId: string
  source: 'builtin' | 'user'
  contentHash: string
  name: string
  renderMode?: TemplateRenderMode
  theme: Record<string, unknown>
  layouts: Layout[]
  /** What the design asks the AI for, snapshotted with it (GEN-11). */
  aiInstructions?: string
  createdAt: Date
  updatedAt: Date
}

const templateVersionSchema = new Schema<TemplateVersionDb>(
  {
    templateId: { type: String, required: true },
    source: { type: String, enum: ['builtin', 'user'], required: true },
    contentHash: { type: String, required: true },
    name: { type: String, required: true },
    renderMode: { type: String, enum: ['components', 'positioned'] },
    theme: { type: Schema.Types.Mixed, required: true },
    layouts: { type: Schema.Types.Mixed, required: true },
    aiInstructions: { type: String },
  },
  { timestamps: true },
)

// One row per distinct structure. The uniqueness is load-bearing rather than
// merely tidy: `ensureVersion` races whenever two decks are created against
// the same template at once, and this is what makes the loser's upsert find
// the winner's row instead of writing a duplicate.
templateVersionSchema.index({ templateId: 1, contentHash: 1 }, { unique: true })

// No soft-delete plugin, deliberately. A version is referenced by decks that
// may outlive the template AND its author — tombstoning it with either would
// take working lectures down with it. Versions no longer pinned by any deck
// are the retention sweep's business (P-11), not a cascade's.

export const TemplateVersionModel = model<TemplateVersionDb>(
  'TemplateVersion',
  templateVersionSchema,
)

export const toTemplateVersionDto = (
  doc: HydratedDocument<TemplateVersionDb>,
): TemplateVersion => ({
  id: doc._id.toString(),
  templateId: doc.templateId,
  source: doc.source,
  contentHash: doc.contentHash,
  name: doc.name,
  renderMode: doc.renderMode,
  theme: doc.theme,
  layouts: doc.layouts,
  ...(doc.aiInstructions ? { aiInstructions: doc.aiInstructions } : {}),
  createdAt: doc.createdAt.toISOString(),
})

/** True when the id could address a version document at all. */
export const couldBeVersionId = (id: string | undefined): id is string =>
  Boolean(id) && Types.ObjectId.isValid(id!)
