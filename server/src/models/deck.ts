/**
 * Deck model (SPEC §15 / SHARE-1). The transcript field retains the full
 * finalized lecture text for post-lecture reformatting (GEN-4).
 * updatedAt is bumped by deck saves and touched by slide edits, so
 * recency ordering reflects real modification.
 *
 * Access control (Google-Docs style): `visibility` is the general
 * access — 'public' (anyone with the link can view, the default) or
 * 'restricted' (only people with access). `viewers`/`editors` are the
 * "people with access" lists; editors can always view and edit,
 * whatever the general access. canViewDeck/canEditDeck are the single
 * source of truth.
 */
import { Schema, model, Types, type HydratedDocument } from 'mongoose'
import type { Deck } from '@slide-machine/shared'

export interface DeckDb extends Omit<
  Deck,
  | 'id'
  | 'projectId'
  | 'ownerId'
  | 'createdAt'
  | 'updatedAt'
  | 'viewers'
  | 'editors'
> {
  projectId: Types.ObjectId
  ownerId: Types.ObjectId
  viewers: string[]
  editors: string[]
  createdAt: Date
  updatedAt: Date
}

const deckSchema = new Schema<DeckDb>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    templateId: { type: String, required: true },
    visibility: {
      type: String,
      enum: ['restricted', 'public'],
      default: 'public',
    },
    viewers: { type: [String], default: [] },
    editors: { type: [String], default: [] },
    permalinkSlug: { type: String, required: true, unique: true },
    slideOrder: { type: [String], default: [] },
    seedContext: String,
    transcript: String,
    voteScore: { type: Number, default: 0 },
  },
  { timestamps: true },
)

export const DeckModel = model<DeckDb>('Deck', deckSchema)

/** True when `userId` may edit: the owner, or a listed editor. */
export const canEditDeck = (
  deck: Pick<DeckDb, 'ownerId' | 'editors'>,
  userId?: string,
): boolean => {
  if (!userId) return false
  return deck.ownerId.toString() === userId || deck.editors.includes(userId)
}

/** True when `userId` (or anonymous) may view: public general access,
 * or any person with access (viewer or editor), or the owner. */
export const canViewDeck = (
  deck: Pick<DeckDb, 'ownerId' | 'visibility' | 'viewers' | 'editors'>,
  userId?: string,
): boolean => {
  if (deck.visibility === 'public') return true
  if (canEditDeck(deck, userId)) return true
  return !!userId && deck.viewers.includes(userId)
}

/** Marks the deck as modified now (used when only its slides changed). */
export const touchDeck = async (
  deckId: Types.ObjectId | string,
): Promise<void> => {
  await DeckModel.updateOne(
    { _id: deckId },
    { $currentDate: { updatedAt: true } },
  )
}

export const toDeckDto = (doc: HydratedDocument<DeckDb>): Deck => ({
  id: doc._id.toString(),
  projectId: doc.projectId.toString(),
  ownerId: doc.ownerId.toString(),
  title: doc.title,
  templateId: doc.templateId,
  visibility: doc.visibility,
  viewers: doc.viewers,
  editors: doc.editors,
  permalinkSlug: doc.permalinkSlug,
  slideOrder: doc.slideOrder,
  seedContext: doc.seedContext,
  transcript: doc.transcript,
  voteScore: doc.voteScore,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: (doc.updatedAt ?? doc.createdAt).toISOString(),
})

/** The deck as shown to non-owners: share lists stay with the owner. */
export const toSharedDeckDto = (doc: HydratedDocument<DeckDb>): Deck => {
  const dto = toDeckDto(doc)
  delete dto.viewers
  delete dto.editors
  return dto
}
