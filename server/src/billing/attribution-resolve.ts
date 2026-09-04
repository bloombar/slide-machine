/**
 * Working out which lecture and project a piece of metered work belongs to
 * (SPEC BILL-7).
 *
 * The ledger records both references **at the time the event happens**,
 * because neither can be reconstructed afterwards: a lecture's owner is not
 * always its project's owner, and either entity may be gone by the time anyone
 * reads the report. But the code that spends the money is usually a provider
 * adapter several layers down with no idea what it is generating slides *for*,
 * so something nearer the request has to say.
 *
 * That something is here. Most actions already name what they operate on — a
 * `deckId`, a `slideId`, a `projectId` — so rather than adding an attribution
 * hook to sixty action definitions and relying on nobody forgetting one, the
 * dispatcher reads the input it already validated and resolves whatever it
 * finds. An action that names nothing simply attributes to the user, which is
 * what it did before.
 *
 * Everything is best-effort. Attribution that fails costs a report some
 * detail; it must never cost the user their request, so every lookup swallows
 * its own errors and falls back to "not known".
 */
import { isValidObjectId } from 'mongoose'
import { DeckModel } from '../models/deck'
import { ProjectModel } from '../models/project'
import { SlideModel } from '../models/slide'
import type { Locale } from '@slide-machine/shared'
import type { UsageAttribution } from './usage-attribution'

/** The entity half of an attribution — what the work was for. */
export interface EntityAttribution {
  projectId?: string
  projectName?: string
  deckId?: string
  deckName?: string
}

/** Inputs we know how to find a lecture or project in. Deliberately just the
 * three names the action layer already uses; a new one is a line here. */
interface AttributableInput {
  deckId?: unknown
  slideId?: unknown
  projectId?: unknown
}

const idOf = (value: unknown): string | undefined =>
  typeof value === 'string' && isValidObjectId(value) ? value : undefined

/** The project half, from a project id. */
const projectPart = async (projectId: string): Promise<EntityAttribution> => {
  const project = await ProjectModel.findById(projectId)
    .select('title')
    .setOptions({ includeDeleted: true })
    .catch(() => null)
  return project ? { projectId, projectName: project.title } : { projectId }
}

/** Both halves, from a lecture id — a lecture always belongs to a project, and
 * a per-project total is its lectures plus its own project-scoped spend. */
const deckPart = async (deckId: string): Promise<EntityAttribution> => {
  const deck = await DeckModel.findById(deckId)
    .select('title projectId')
    .setOptions({ includeDeleted: true })
    .catch(() => null)
  if (!deck) return { deckId }
  return {
    deckId,
    deckName: deck.title,
    ...(await projectPart(deck.projectId.toString())),
  }
}

/**
 * What a validated action input says the work is for.
 *
 * Resolution order is narrowest-first: a slide identifies a lecture, a lecture
 * identifies a project, and a bare project identifies only itself. An input
 * naming several is read at its most specific, since that is the one the
 * action is actually operating on.
 */
export const entityFromInput = async (
  input: unknown,
): Promise<EntityAttribution> => {
  if (!input || typeof input !== 'object') return {}
  const { deckId, slideId, projectId } = input as AttributableInput

  try {
    const slide = idOf(slideId)
    if (slide) {
      const doc = await SlideModel.findById(slide)
        .select('deckId')
        .setOptions({ includeDeleted: true })
        .catch(() => null)
      if (doc) return await deckPart(doc.deckId.toString())
    }
    const deck = idOf(deckId)
    if (deck) return await deckPart(deck)
    const project = idOf(projectId)
    if (project) return await projectPart(project)
  } catch {
    // A malformed id or an unreachable database. The event still records the
    // payer and the money; only the entity columns go blank.
  }
  return {}
}

/** Both halves of an attribution for work on a known lecture, for the paths
 * that have the deck in hand already and need no lookup at all.
 *
 * `locale` is the language the work is for, and only the language-bearing
 * paths pass one: reading a lecture in translation, and hearing it narrated.
 * Left off, the rows say nothing about language rather than claiming English.
 *
 * The options are named one by one rather than spread. Spreading carried
 * whatever a caller happened to pass straight onto a ledger row, so a field
 * this function had never heard of would still be written — and a field it
 * *had* heard of was indistinguishable from one it had not, which is why the
 * test for `locale` passed against a version that did not declare it.
 */
export const attributionForDeck = (
  payerId: string,
  deck: { _id: unknown; title?: string; projectId?: unknown },
  {
    actorId,
    audience,
    locale,
  }: { actorId?: string; audience?: boolean; locale?: Locale } = {},
): UsageAttribution => ({
  userId: payerId,
  ...(actorId === undefined ? {} : { actorId }),
  ...(audience === undefined ? {} : { audience }),
  ...(locale === undefined ? {} : { locale }),
  deckId: String(deck._id),
  deckName: deck.title,
  ...(deck.projectId ? { projectId: String(deck.projectId) } : {}),
})
