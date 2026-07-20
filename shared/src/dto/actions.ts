/**
 * Input DTOs for TECH-13 actions dispatched via POST /api/actions/:name.
 * Results reuse the shared data-model types (e.g. Project).
 */
import type { Locale } from '../types/locale'
import type { ImageAttribution, Visibility } from '../types/deck'
import type { ProfileVisibility } from '../types/user'
import type { WordTiming } from '../providers/transcription'

export interface ProjectCreateInput {
  /** Optional: a blank title stores a titleless "default" project, which
   * the client shows under a configurable placeholder name. */
  title?: string
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
  /** 1-10; null clears the setting back to the server default. */
  generationFreedom?: number | null
  /** Explicit project language; null clears back to inherited. */
  language?: Locale | null
  /** Narration voice id (TTS_VOICES); null clears back to the server default. */
  ttsVoice?: string | null
}

export interface DeckCreateInput {
  projectId: string
  title?: string
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

/** Lecture AI-freedom (1-5); null re-inherits the project's setting. */
export interface DeckSetGenerationFreedomInput {
  deckId: string
  freedom: number | null
}

/** Lecture-level seed notes (owner and editors). */
export interface DeckSetSeedNotesInput {
  deckId: string
  seedContext: string
}

/** Lecture general-access change; creates the lecture's override (SHARE-1). */
export interface DeckSetAccessInput {
  deckId: string
  visibility: Visibility
}

/** Project default template: applied to lectures at creation (TMPL-2). */
export interface ProjectSwitchTemplateInput {
  projectId: string
  templateId: string
}

/** Drops a lecture's privacy override so it follows its project again. */
export interface DeckResetAccessInput {
  deckId: string
}

/** Project general-access change; cascades to inheriting lectures. */
export interface ProjectSetAccessInput {
  projectId: string
  visibility: Visibility
}

export interface ProjectShareInput {
  projectId: string
  email: string
  role: ShareRole
}

export interface ProjectUnshareInput {
  projectId: string
  userId: string
  role: ShareRole
}

export interface ProjectSharesInput {
  projectId: string
}

/** Owner-only: hand the project to another user; the old owner stays an editor. */
export interface ProjectTransferOwnershipInput {
  projectId: string
  userId: string
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

/** Owner-only: delete the lecture and everything in it. */
export interface DeckDeleteInput {
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

/** Explicit lecturing/generation language; null clears back to the
 * browser default. */
export interface UserSetLanguageInput {
  language: Locale | null
}

/** Lecture-level language; null re-inherits project/profile/browser. */
export interface DeckSetLanguageInput {
  deckId: string
  language: Locale | null
}

/** Lecture-level narration voice; null re-inherits the project's. */
export interface DeckSetTtsVoiceInput {
  deckId: string
  voice: string | null
}

/** One finalized spoken (or typed, until STT lands) phrase for a live session. */
export interface SessionPhraseInput {
  deckId: string
  phrase: string
  /** The speaker's browser language tag (e.g. "fr-CA") — the last
   * fallback when no lecture/project/profile language is set. */
  browserLanguage?: string
  /** Per-recording id the client mints at each capture start (GEN-4
   * diarization groundwork). Groups a deck's phrases by recording session
   * for the later time-join; absent for typed input (no audio). */
  sessionId?: string
  /** Phrase-level transcription confidence; absent for the browser engine. */
  confidence?: number
  /** Per-word timings, session-relative, from word-offset-capable engines
   * (Google Cloud). `startMs`/`endMs` on the stored segment are derived from
   * these server-side. Absent for the browser engine / typed input. */
  words?: WordTiming[]
}

/** Partial slide-content update (EDIT-1); only provided fields change. */
export interface SlideEditInput {
  slideId: string
  title?: string
  body?: string
  bullets?: string[]
  caption?: string
  /** Set to a URL to change the image, or '' to remove it (EDIT-1). */
  imageRef?: string
  /** Image credit/licensing edited from the attribution dialog (IMG-5). */
  attribution?: ImageAttribution
}

export interface SlideDeleteInput {
  slideId: string
}

/** Switches one slide's layout to another of its template's layouts (EDIT-3). */
export interface SlideSetLayoutInput {
  slideId: string
  layoutType: string
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
