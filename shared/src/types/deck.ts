/**
 * Deck, slide, and slide-translation data models (SPEC §15).
 * Field sets are indicative — they will evolve as features land.
 */
import type { Locale } from './locale'
import type { LayoutType } from './template'
import type { WordTiming } from '../providers/transcription'
import type { SpeakerRole } from '../providers/diarization'

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
  /** Per-lecture Refine toggle: identify speakers + reframe student turns.
   * Absent = default (on only when the lecture has retained audio). */
  refineIdentifySpeakers?: boolean
  /** Per-lecture Refine toggle: refine slide content/layout/image.
   * Absent = default on. */
  refineSlidesEnabled?: boolean
  /** Per-lecture "Refine all slides" strength (1-5); absent = inherit the
   * server default (REFINE_SLIDES_DEFAULT_LEVEL). Stored only once moved. */
  refineSlidesLevel?: number
  /** Per-lecture Refine toggle: rewrite the spoken narration.
   * Absent = default on. */
  refineTranscriptEnabled?: boolean
  /** Per-lecture "Refine the spoken transcript" strength (1-5); absent =
   * inherit the server default. Stored only once moved. */
  refineTranscriptLevel?: number
  /** Lecturing/generation language, only when explicitly chosen; absent
   * = inherit (project, then owner profile, then browser default). */
  language?: Locale
  /** Own narration voice id (TTS_VOICES); absent = inherit the project's. */
  ttsVoice?: string
  /** Finalized full lecture transcript, retained for post-lecture reformat (GEN-4). */
  transcript?: string
  /** True when the lecture has retained audio to run speaker diarization on
   * (GEN-4 Phase 4). Derived flag — the raw recordings stay server-side. */
  hasRecordings?: boolean
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
  /** Freehand whiteboard annotations drawn on the slide (WB-1), each
   * timing-anchored to the narration for synced playback. Absent = none. */
  drawings?: Stroke[]
}

/** A single point of a stroke, normalized 0..1 to the slide's rendered box
 * so annotations survive layout/aspect changes. */
export interface StrokePoint {
  x: number
  y: number
}

/** Drawing tools that persist a stroke. The eraser is not a tool kind — it
 * stamps an existing stroke's `erasedAnchor` (whole-stroke, timestamped). */
export type StrokeTool = 'pen' | 'highlighter'

/**
 * A stroke event's timing, anchored to the slide's narration so it survives
 * transcript refinement and replays proportionally against TTS audio (WB-2).
 * The durable field is `charAnchor`, a character offset into
 * `slide.sourceTranscript`; playback uses `charAnchor / sourceTranscript.length`.
 * `source` records how precisely it was placed:
 *  - 'word'     nearest live word timing (google-cloud STT) — inside a phrase
 *  - 'appended' end of the transcript at draw time — every engine, no timings
 *  - 'elapsed'  playback-side fallback when TTS audio has no duration
 *  - 'unsynced' drawn with the mic off — not tied to narration at all, so it
 *               is ALWAYS shown on its slide (in or out of playback), never
 *               gated by the audio position (WB-2)
 */
export interface StrokeAnchor {
  charAnchor: number
  source: 'word' | 'appended' | 'elapsed' | 'unsynced'
  /** Recording session the event happened in; google-cloud STT only. */
  sessionId?: string
  /** Session-relative ms of the event; google-cloud STT only. */
  sessionMs?: number
}

/**
 * One freehand stroke on a slide (WB-1). Pen renders opaque; highlighter
 * renders semi-transparent. Whole-stroke erase is a timestamped EVENT, not a
 * deletion: once erased the stroke keeps its data and gains `erasedAnchor`, so
 * synced playback shows it appear at `anchor` and disappear at `erasedAnchor`;
 * the static/edit view hides an erased stroke.
 */
export interface Stroke {
  /** Client-minted (crypto.randomUUID); stable for erase + replay keying. */
  id: string
  tool: StrokeTool
  /** Hex color. Opacity comes from `tool`, not this value. */
  color: string
  /** Line width, normalized to slide width so it scales with the box. */
  thickness: number
  points: StrokePoint[]
  /** ISO wall-clock the draw gesture began / ended. */
  startedAt: string
  endedAt: string
  /** When the stroke was drawn, in transcript space. */
  anchor: StrokeAnchor
  /** Present once erased during a session; when it disappears in playback. */
  erasedAnchor?: StrokeAnchor
  /** ISO wall-clock of the erase gesture. */
  erasedAt?: string
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
  /** Diarized speaker tag (session-scoped), written by the reconciliation pass
   * (GEN-4 Phase 3); absent until diarization runs / when no timing to join. */
  speaker?: number
  /** The speaker's resolved role (lecturer = authoritative, student =
   * question/feedback), from talk-time mapping. Absent until diarized. */
  role?: SpeakerRole
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
