/**
 * Input DTOs for TECH-13 actions dispatched via POST /api/actions/:name.
 * Results reuse the shared data-model types (e.g. Project).
 */
export interface ProjectCreateInput {
  title: string
  course?: string
  description?: string
  seedContext?: string
}

export interface ProjectDeleteInput {
  projectId: string
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

/** Full new ordering; must contain exactly the deck's current slide ids. */
export interface DeckReorderInput {
  deckId: string
  slideOrder: string[]
}
