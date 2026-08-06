/**
 * One-time backfill: pin every lecture written before template versions
 * existed (TMPL-11).
 *
 * Until a lecture holds a version it follows its template live, which is the
 * behavior versions exist to end — an author editing a template still reaches
 * into those lectures. This pass gives each of them the template exactly as it
 * stands now, which is the structure they are already being drawn with, so
 * pinning changes nothing visible and stops the next edit from changing
 * something.
 *
 * Idempotent and self-limiting: it only ever looks at lectures with no
 * version, so a second run finds nothing. Runs at startup rather than as a
 * migration because the project has no migration runner, and the work is
 * bounded by the number of unpinned lectures, which only ever falls.
 */
import { DeckModel } from '../models/deck'
import { currentVersionIdFor } from '../templates/versions'

/**
 * Pins every unpinned lecture, returning how many were pinned.
 *
 * Version ids are resolved per template rather than per lecture: a deployment
 * where every lecture uses the same starter template should cost one lookup,
 * not one per lecture.
 */
export const backfillTemplateVersions = async (): Promise<number> => {
  const decks = await DeckModel.find({
    $or: [
      { templateVersionId: { $exists: false } },
      { templateVersionId: null },
    ],
  })
    .select('_id templateId')
    .lean()
  if (!decks.length) return 0

  const versionByTemplate = new Map<string, string | undefined>()
  let pinned = 0
  for (const deck of decks) {
    if (!versionByTemplate.has(deck.templateId)) {
      versionByTemplate.set(
        deck.templateId,
        await currentVersionIdFor(deck.templateId),
      )
    }
    const versionId = versionByTemplate.get(deck.templateId)
    // A lecture naming a template that no longer exists has nothing to pin.
    // It keeps falling back the way it does today, and will be pinned if the
    // template is ever restored (P-10).
    if (!versionId) continue
    await DeckModel.updateOne(
      { _id: deck._id },
      { $set: { templateVersionId: versionId } },
    )
    pinned++
  }
  return pinned
}

/** Fire-and-forget wrapper for startup: a failure here must not stop the
 * server, since every unpinned lecture still renders the way it did before. */
export const startTemplateVersionBackfill = (): void => {
  backfillTemplateVersions()
    .then(count => {
      if (count) console.log(`Pinned ${count} lecture(s) to a template version`)
    })
    .catch(error => {
      console.error('Template version backfill failed (continuing):', error)
    })
}
