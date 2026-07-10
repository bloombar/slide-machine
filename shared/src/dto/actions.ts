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

export interface DeckListInput {
  projectId: string
}

export interface DeckGetInput {
  deckId: string
}

/** One finalized spoken (or typed, until STT lands) phrase for a live session. */
export interface SessionPhraseInput {
  deckId: string
  phrase: string
}
