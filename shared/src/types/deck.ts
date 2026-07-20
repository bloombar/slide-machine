/**
 * Deck, slide, and slide-translation data models (SPEC §15).
 * Field sets are indicative — they will evolve as features land.
 */
import type { Locale } from './locale'
import type { LayoutType } from './template'
import type { WordTiming } from '../providers/transcription'

/**
 * General access (Google-Docs style): 'restricted' means only the owner
 * and people with access can open the deck; 'public' means anyone on
 * the internet with the link can view.
 */
export type Visibility = 'restricted' | 'public'

/**
 * AI content freedom, 1-5 (GEN-1): 1 = slides contain only what the
 * speaker explicitly said; 5 = the AI may elaborate freely around it.
 * Each step selects one of five content-freedom policy bands. Stored
 * per project/lecture only when explicitly set — lectures inherit their
 * project, projects inherit the server default.
 */
export const GENERATION_FREEDOM_MIN = 1
export const GENERATION_FREEDOM_MAX = 5

export interface Deck {
  id: string
  projectId: string
  ownerId: string
  title: string
  /** Always stored on the lecture; initialized from the project's
   * default template at creation (TMPL-2). */
  templateId: string
  /** EFFECTIVE general access: the lecture's own override when one
   * exists, otherwise inherited from its project. */
  visibility: Visibility
  /** True when this lecture has no privacy override and follows its
   * project's settings (the default). */
  accessInherited: boolean
  /** Effective user ids with view access. Owner-only surfaces. */
  viewers?: string[]
  /** Effective user ids with edit access. Owner-only surfaces. */
  editors?: string[]
  permalinkSlug: string
  slideOrder: string[]
  /** Lecture-level seed notes; stack on top of the project's (PROJ-1/SEED-1). */
  seedContext?: string
  /** Own AI-freedom setting (1-5); absent = inherit the project's. */
  generationFreedom?: number
  /** Lecturing/generation language, only when explicitly chosen; absent
   * = inherit (project, then owner profile, then browser default). */
  language?: Locale
  /** Own narration voice id (TTS_VOICES); absent = inherit the project's. */
  ttsVoice?: string
  /** Finalized full lecture transcript, retained for post-lecture reformat (GEN-4). */
  transcript?: string
  voteScore: number
  createdAt: string
  /** Bumped whenever the deck or its slides change; drives recency ordering. */
  updatedAt: string
}

/** Where a slide's image came from, including AI-generated provenance (IMG-4). */
export type ImageSource = 'seeded' | 'stock' | 'generated'

/**
 * A single, source-agnostic image credit (IMG-5). Every enrichment
 * service (Wikimedia, Openverse, Flickr) and seeded uploads map their
 * own metadata onto this common shape, following the Creative Commons
 * TASL convention — Title, Author, Source, License — plus the image's
 * own caption and a human label for the originating service. Every field
 * is optional: a source supplies what it has, and attribution is only a
 * legal requirement under some licenses. A missing field is simply absent
 * rather than guessed.
 */
export interface ImageAttribution {
  /** The image's own caption/description from the source, when supplied. */
  caption?: string
  /** Title of the work (TASL "T"). */
  title?: string
  /** Author/creator name (TASL "A"). */
  creator?: string
  /** Link to the creator's page, when the source supplies one. */
  creatorUrl?: string
  /** Link to the work at its source, e.g. the file or photo page (TASL "S"). */
  sourceUrl?: string
  /** Human label for the originating service, e.g. "Wikimedia Commons". */
  sourceName?: string
  /** Human-readable license name, e.g. "CC BY-SA 4.0" (TASL "L"). */
  license?: string
  /** Link to the license deed/text (TASL "L"). */
  licenseUrl?: string
}

export interface Slide {
  id: string
  deckId: string
  index: number
  /** Chosen by the AI from the template's layout descriptors (GEN-6). */
  layoutType: LayoutType
  title?: string
  body?: string
  bullets?: string[]
  imageRef?: string
  imageSource?: ImageSource
  /** AI-recommended image search terms (GEN-7). */
  imageKeywords?: string[]
  caption?: string
  sourceTranscript?: string
  /** Source-agnostic image credit captured at enrichment (IMG-5). */
  attribution?: ImageAttribution
  /** True once a user hand-edits the slide's content (EDIT-1). Lets the
   * post-lecture reformat (GEN-4) protect manual edits from being
   * overwritten. Absent = never manually edited. */
  manuallyEdited?: boolean
}

/**
 * How a finalized phrase related to slides when it was transcribed, captured
 * on its TranscriptSegment for later reconciliation (GEN-4): 'new' created a
 * slide, 'update'/'refit' changed the current slide, 'none' was filler.
 */
export type TranscriptSegmentAction = 'none' | 'update' | 'refit' | 'new'

/**
 * One finalized phrase of a lecture, with timing and its phrase→slide linkage
 * (GEN-4 diarization groundwork). Stored append-only in its own collection —
 * NOT embedded on the deck — and not surfaced in any DTO yet. The flat
 * `deck.transcript` / `slide.sourceTranscript` strings remain the live record;
 * segments add the structured, timestamped view a later diarization pass joins
 * speaker tags onto. `startMs`/`endMs` are relative to the segment's recording
 * `sessionId`; there is no global audio clock because recording can stop/start.
 */
export interface TranscriptSegment {
  id: string
  deckId: string
  /** Per-recording id (one WS/stream); absent for typed input (no audio). */
  sessionId?: string
  /** Session-relative ms of the first word; absent when no word timings. */
  startMs?: number
  /** Session-relative ms of the last word; absent when no word timings. */
  endMs?: number
  /** The finalized phrase — identical to what joins the flat strings. */
  text: string
  /** Phrase-level confidence; absent for the keyless browser engine. */
  confidence?: number
  /** Per-word timings; absent for the browser engine / typed input. */
  words?: WordTiming[]
  action: TranscriptSegmentAction
  /** The slide this phrase created or changed; absent for filler with none. */
  slideId?: string
  createdAt: string
}

/** Cached on-demand translation of a deck's slide content (SHARE-2). */
export interface SlideTranslation {
  id: string
  deckId: string
  locale: Locale
  perSlide: Record<
    string,
    {
      title?: string
      body?: string
      bullets?: string[]
      caption?: string
    }
  >
  createdAt: string
}
