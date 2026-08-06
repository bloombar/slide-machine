/**
 * Pinning a deck to a template snapshot (TMPL-11).
 *
 * A template is a living thing: its author edits it, and a deployment ships
 * new versions of the built-ins. A lecture already built on one is not. This
 * module is the seam between the two — it turns "the template as it stands"
 * into an immutable version a deck can hold on to, and reads that version
 * back when the deck is drawn.
 *
 * The rule everywhere downstream: `templateId` says which template a lecture
 * belongs to, `templateVersionId` says what it is actually drawn with. Edits
 * move the first; only the owner applying an update moves the second.
 */
import { createHash } from 'node:crypto'
import type { Template, TemplateVersion } from '@slide-machine/shared'
import {
  TemplateVersionModel,
  toTemplateVersionDto,
  couldBeVersionId,
} from '../models/template-version'
import {
  isBuiltinTemplate,
  resolveTemplate,
  resolveTemplateForRead,
} from './resolve'

/**
 * What a deck's own paths need off a template: how its slides are laid out
 * and painted.
 *
 * Deliberately narrower than `Template`. Identity, ownership, sharing and
 * vote score belong to the living template, not to the structure a lecture
 * pinned — and a snapshot that pretended to carry them would be inventing
 * answers (whose is it? is it public?) that no caller should trust.
 */
export type DeckTemplate = Pick<
  Template,
  'id' | 'name' | 'renderMode' | 'theme' | 'layouts'
>

/**
 * JSON with object keys in a fixed order.
 *
 * Layouts come back from Mongo as loosely-typed documents, where key order is
 * not guaranteed to survive a round trip. Hashing `JSON.stringify` directly
 * would let a template "change" because a driver reordered two fields, which
 * would show the owner an update notice for an edit nobody made.
 */
const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
  return `{${entries.join(',')}}`
}

/**
 * Fingerprint of the structure a deck is drawn with.
 *
 * Covers everything that reaches the renderer — name, render mode, theme and
 * layouts — rather than trying to judge which edits "really" matter. A purely
 * cosmetic change does make a new version, and the update notice then
 * correctly reports that no content needs adjusting; guessing instead would
 * mean sometimes missing a change that did.
 */
export const contentHashOf = (
  template: Pick<Template, 'name' | 'renderMode' | 'theme' | 'layouts'>,
): string =>
  createHash('sha256')
    .update(
      stableStringify({
        name: template.name,
        renderMode: template.renderMode,
        theme: template.theme,
        layouts: template.layouts,
      }),
    )
    .digest('hex')

/** Whether a template id names a built-in file or a stored document. */
const sourceOf = (templateId: string): 'builtin' | 'user' =>
  isBuiltinTemplate(templateId) ? 'builtin' : 'user'

/**
 * The version row for a template exactly as it stands, making it if this
 * structure has not been seen before.
 *
 * Upserted rather than found-then-inserted: two lectures created against the
 * same template at the same moment would otherwise both miss and both write.
 * The unique index turns that race into one row and one winner.
 */
export const ensureVersion = async (
  template: Template,
): Promise<TemplateVersion> => {
  const contentHash = contentHashOf(template)
  const doc = await TemplateVersionModel.findOneAndUpdate(
    { templateId: template.id, contentHash },
    {
      $setOnInsert: {
        templateId: template.id,
        contentHash,
        source: sourceOf(template.id),
        name: template.name,
        renderMode: template.renderMode,
        theme: template.theme,
        layouts: template.layouts,
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  )
  return toTemplateVersionDto(doc)
}

/** A pinned version by id, or undefined when the deck predates versions. */
export const getVersion = async (
  versionId: string | undefined,
): Promise<TemplateVersion | undefined> => {
  if (!couldBeVersionId(versionId)) return undefined
  const doc = await TemplateVersionModel.findById(versionId).catch(() => null)
  return doc ? toTemplateVersionDto(doc) : undefined
}

/** The structure a version describes, in the shape deck paths expect. */
export const templateFromVersion = (
  version: TemplateVersion,
): DeckTemplate => ({
  id: version.templateId,
  name: version.name,
  renderMode: version.renderMode,
  theme: version.theme,
  layouts: version.layouts,
})

/** A lecture, as the pinning code needs to see one. */
export interface PinnableDeck {
  templateId: string
  templateVersionId?: string | null
}

/**
 * The structure a lecture is drawn with — the whole point of the module.
 *
 * Pinned version first. A lecture written before versions existed has none
 * and resolves live, exactly as it did before; the startup backfill pins
 * those, and any path that saves the deck pins it on the way through. Reads
 * never write, so opening a lecture cannot surprise anyone with a migration.
 *
 * A pinned version also outlives its template: deleting a template no longer
 * drops a lecture back to the default look, because the structure it was
 * built with is still right here.
 */
export const resolveDeckTemplate = async (
  deck: PinnableDeck,
): Promise<DeckTemplate | undefined> => {
  const version = await getVersion(deck.templateVersionId ?? undefined)
  if (version) return templateFromVersion(version)
  return resolveTemplate(deck.templateId)
}

/**
 * The template a lecture is drawn with, as a whole `Template` for the viewer.
 *
 * The viewer renders from what this returns, so it has to carry the pinned
 * structure — otherwise editing a template would visibly restructure lectures
 * already built on it, which is the very thing versions exist to prevent.
 *
 * Identity is taken from the living template (id, owner, permalink, sharing)
 * and structure from the version, which is the same split as everywhere else:
 * `templateId` says which template, `templateVersionId` says which shape. When
 * the template is gone the read fallback supplies a default to carry identity,
 * and the pinned structure still wins — a deleted template leaves its lectures
 * looking exactly as they did.
 */
export const resolveDeckTemplateForRead = async (
  deck: PinnableDeck,
): Promise<Template | undefined> => {
  const live = await resolveTemplateForRead(deck.templateId)
  const version = await getVersion(deck.templateVersionId ?? undefined)
  if (!version) return live
  if (!live) return undefined
  return { ...live, ...templateFromVersion(version), id: deck.templateId }
}

/**
 * The version id a lecture should pin for a template, as it stands now.
 *
 * For creation paths, which build the document in one call and have no deck
 * object to assign to yet.
 */
export const currentVersionIdFor = async (
  templateId: string,
): Promise<string | undefined> => {
  const template = await resolveTemplate(templateId)
  if (!template) return undefined
  return (await ensureVersion(template)).id
}

/**
 * Points a lecture at the current structure of the template it names, and
 * returns the version it now holds.
 *
 * Called wherever a deck's template is chosen or re-chosen — creation, a
 * template switch, applying an update. Assigns rather than saves: the caller
 * is already inside a save, and pinning is part of that change rather than a
 * write of its own.
 */
export const pinDeckToCurrent = async (
  deck: PinnableDeck,
): Promise<TemplateVersion | undefined> => {
  const template = await resolveTemplate(deck.templateId)
  if (!template) return undefined
  const version = await ensureVersion(template)
  deck.templateVersionId = version.id
  return version
}
