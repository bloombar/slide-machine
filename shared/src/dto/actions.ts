/**
 * Input DTOs for TECH-13 actions dispatched via POST /api/actions/:name.
 * Results reuse the shared data-model types (e.g. Project).
 */
import type { Visibility } from '../types/deck'
import type { ProfileVisibility } from '../types/user'

export interface ProjectCreateInput {
  title: string
  course?: string
  description?: string
  seedContext?: string
}

export interface ProjectDeleteInput {
  projectId: string
}

/** Owner-only project edit; only provided fields change. */
export interface ProjectUpdateInput {
  projectId: string
  title?: string
  course?: string
  description?: string
  seedContext?: string
}

export interface DeckCreateInput {
  projectId: string
  title: string
  templateId: string
}

/** Omit projectId to list every deck the caller owns (recency-ordered). */
export interface DeckListInput {
  projectId?: string
}

export interface DeckGetInput {
  deckId: string
}

export interface DeckRenameInput {
  deckId: string
  title: string
}

/** Deck-level template switch (EDIT-2). */
export interface DeckSwitchTemplateInput {
  deckId: string
  templateId: string
}

/** Lists seed assets at one level: a project's own, or a lecture's. */
export interface SeedAssetListInput {
  projectId?: string
  deckId?: string
}

/** Caption/enabled edits on a seed asset; only provided fields change. */
export interface SeedAssetUpdateInput {
  assetId: string
  caption?: string
  enabled?: boolean
}

export interface SeedAssetDeleteInput {
  assetId: string
}

/** Lecture-level seed notes (owner and editors). */
export interface DeckSetSeedNotesInput {
  deckId: string
  seedContext: string
}

/** Owner-only general-access change (SHARE-1). */
export interface DeckSetAccessInput {
  deckId: string
  visibility: Visibility
}

/** The role a shared user holds on a deck. */
export type ShareRole = 'viewer' | 'editor'

/** Grants a user (found by account email) view or edit access. */
export interface DeckShareInput {
  deckId: string
  email: string
  role: ShareRole
}

/** Revokes a previously granted share. */
export interface DeckUnshareInput {
  deckId: string
  userId: string
  role: ShareRole
}

/** One granted share, as listed to the deck owner. */
export interface DeckShare {
  userId: string
  displayName: string
  email: string
  role: ShareRole
}

export interface DeckSharesInput {
  deckId: string
}

/** Owner-only: hand the deck to another user; the old owner stays an editor. */
export interface DeckTransferOwnershipInput {
  deckId: string
  userId: string
}

/** Profile settings update (AUTH-5). */
export interface UserSetProfileVisibilityInput {
  profileVisibility: ProfileVisibility
}

/** One finalized spoken (or typed, until STT lands) phrase for a live session. */
export interface SessionPhraseInput {
  deckId: string
  phrase: string
}

/** Partial slide-content update (EDIT-1); only provided fields change. */
export interface SlideEditInput {
  slideId: string
  title?: string
  body?: string
  bullets?: string[]
  caption?: string
}

export interface SlideDeleteInput {
  slideId: string
}

/** Appends a blank starter slide at the end of the deck. */
export interface SlideAddInput {
  deckId: string
}

/** Full new ordering; must contain exactly the deck's current slide ids. */
export interface DeckReorderInput {
  deckId: string
  slideOrder: string[]
}
