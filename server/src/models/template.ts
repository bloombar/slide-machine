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
  Visibility,
} from '@slide-machine/shared'
import type { ResolvedAcl } from '../lib/access'
import { softDeletePlugin } from './plugins/soft-delete'
import { adoptDefaultTree, normalizePositions } from '../templates/builtin'
import { shareInviteSchema, type ShareInviteDb } from './share-invite'

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
  /**
   * General access, the same vocabulary a lecture uses (TMPL-26): restricted
   * by default, public once the author lists it. Stored values may still be
   * the earlier three-way `private`/`unlisted`/`public` on a document nobody
   * has saved since the migration ran — `legacyVisibility` maps both dead
   * values to `restricted` wherever this is read.
   */
  visibility: Visibility | 'private' | 'unlisted'
  /** Effective user ids with view access (TMPL-26), the same shape a
   * project's people list has. */
  viewers: string[]
  /** Effective user ids with edit access (TMPL-26). */
  editors: string[]
  /** Shares offered to addresses with no account yet (SHARE-3); they confer
   * no access until claimed. Server-only, not in the Template DTO. */
  invites?: ShareInviteDb[]
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
    // Not a strict enum: a document written before the TMPL-26 migration ran
    // may still hold `private`/`unlisted` for the moment between startup and
    // the backfill completing (jobs/migrate-template-visibility.ts), and a
    // strict enum would refuse to load it rather than let `toTemplateDto`'s
    // safety net map it.
    visibility: { type: String, default: 'restricted' },
    viewers: { type: [String], default: [] },
    editors: { type: [String], default: [] },
    invites: { type: [shareInviteSchema], default: [] },
    voteScore: { type: Number, default: 0 },
  },
  { timestamps: true },
)

templateSchema.plugin(softDeletePlugin)

export const TemplateModel = model<TemplateDb>('Template', templateSchema)

/** Maps a document's stored visibility onto the current two-value
 * vocabulary (TMPL-26): both retired states read as `restricted`, the
 * closer of the two to what they meant (visible to nobody but the author,
 * or to whoever had the link — neither is "public"). Applied on every read,
 * so no stored document has to be rewritten to be read correctly. */
const legacyVisibility = (v: TemplateDb['visibility']): Visibility =>
  v === 'public' ? 'public' : 'restricted'

/** A stored template's ACL is always its own — a design belongs to no
 * project to inherit from, unlike a lecture's (TMPL-26). */
export const templateAcl = (
  doc: Pick<
    TemplateDb,
    'ownerId' | 'visibility' | 'viewers' | 'editors' | 'invites'
  >,
): ResolvedAcl => ({
  ownerId: doc.ownerId.toString(),
  visibility: legacyVisibility(doc.visibility),
  viewers: doc.viewers,
  editors: doc.editors,
  inherited: false,
  invites: doc.invites ?? [],
})

/** The caller's relationship to a stored template (TMPL-26): `owner` for its
 * author, `editor`/`viewer` for someone on its people list, `null` for
 * everyone else (including a signed-out caller) — never computed for a
 * built-in, which has no owner or people list of its own. */
export const templateRoleFor = (
  doc: Pick<TemplateDb, 'ownerId' | 'viewers' | 'editors'>,
  userId?: string,
): Template['myRole'] => {
  if (!userId) return null
  if (doc.ownerId.toString() === userId) return 'owner'
  if (doc.editors.includes(userId)) return 'editor'
  if (doc.viewers.includes(userId)) return 'viewer'
  return null
}

/**
 * The wire shape. A stored template's id is its document id, which is what a
 * deck or project stores in `templateId` — the same field that holds a
 * built-in's slug, so the two are interchangeable to every reader.
 *
 * `userId` is the signed-in caller, when known, and decides `myRole`
 * (TMPL-26); omit it where the DTO is read by something other than the
 * caller it belongs to (generation, export, another user's stored template
 * resolved only to read its structure) — it then reads `null`, same as a
 * built-in.
 */
export const toTemplateDto = (
  doc: HydratedDocument<TemplateDb>,
  userId?: string,
): Template => ({
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
  visibility: legacyVisibility(doc.visibility),
  myRole: templateRoleFor(doc, userId),
  voteScore: doc.voteScore,
  createdAt: doc.createdAt.toISOString(),
})
