/**
 * Deck, slide, and slide-translation data models (SPEC §15).
 * Field sets are indicative — they will evolve as features land.
 */
import type { Locale } from './locale'
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
  /**
   * The template snapshot this lecture is actually drawn with (TMPL-11).
   *
   * `templateId` says which template the lecture belongs to — it is what the
   * settings pane shows and what an update is offered from. This says which
   * *version* of it the slides were built against, and it is what every
   * render, export and layout switch resolves. Editing the template moves the
   * template forward and leaves this where it is, until the owner applies the
   * update.
   *
   * Absent only on lectures written before versions existed, which resolve
   * live and are pinned on first write.
   */
  templateVersionId?: string
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
  /** Per-lecture Refine toggle: let a refine break a slide into several when
   * one slide genuinely cannot hold what it carries (GEN-4). Absent =
   * default off — splitting changes the shape of the lecture, so it is opted
   * into rather than out of. */
  refineSplitEnabled?: boolean
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
  /** Free-text research-study tag (EVAL-3), e.g. "B1-SWE-treatment", used to
   * group lectures for later analysis. Set and seen only by allowlisted
   * admins; absent for unlabeled lectures and in non-admin shared views. */
  studyLabel?: string
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

/**
 * What one slot holds, discriminated by the kind its layout declares
 * (docs/plans/extensible-templates-plan.md). A slide's content is a map of
 * these keyed by slot name, so a layout with three code samples and two
 * images is representable — which fixed fields never could be.
 *
 * Image credit lives on the image slot rather than beside the slide, so
 * several pictures on one slide each carry their own (IMG-5).
 */
export type SlotValue =
  | { kind: 'text' | 'preformatted'; value: string }
  | { kind: 'bullets'; items: string[] }
  | {
      kind: 'image'
      ref?: string
      source?: ImageSource
      keywords?: string[]
      attribution?: ImageAttribution
    }
  | { kind: 'code'; source: string; language?: string }
  | { kind: 'math'; tex: string; display?: boolean }
  | {
      kind: 'table'
      header?: string[]
      rows: string[][]
      /**
       * How the table divides its box, as fractions of its own width and
       * height (EDIT-7). Absent means equal tracks, which is what every table
       * did before they could be resized. Read through `tableTracks`, which
       * fills in and normalises, so a stale or partial list is not a problem.
       */
      colWidths?: number[]
      rowHeights?: number[]
    }

/**
 * Which slot kinds translated viewing covers (SHARE-2).
 *
 * Prose travels. Code and mathematics do not: a program listing stops running
 * and a formula stops parsing once its tokens are translated, and both are
 * read as notation rather than language. An image has no words of its own —
 * its caption is a slot in its own right and travels as one.
 *
 * Written as a total map over the kinds rather than a list of exceptions, so
 * adding a kind to `SlotValue` fails to compile here until somebody decides
 * which side of the line it falls on. A new kind cannot quietly default into
 * being sent to a translator.
 */
export const TRANSLATABLE_SLOT_KINDS: Record<SlotValue['kind'], boolean> = {
  text: true,
  preformatted: true,
  bullets: true,
  table: true,
  image: false,
  code: false,
  math: false,
}

/** True when a slot's content is the sort of thing that gets translated. */
export const isTranslatableSlot = (value: SlotValue): boolean =>
  TRANSLATABLE_SLOT_KINDS[value.kind]

/** The conventional slot names, which keep derived fields on the DTO. */
export const CONVENTIONAL_SLOTS = [
  'title',
  'body',
  'bullets',
  'caption',
  'image',
] as const

export interface Slide {
  id: string
  deckId: string
  index: number
  /** Chosen by the AI from the template's layout descriptors (GEN-6). A
   * conventional type, or one the template's author named (TMPL-9). */
  layoutType: string
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
  /**
   * The slide's content, keyed by the slot names its layout declares — the
   * authoritative store (TMPL-9/GEN-11). The fields above are DERIVED from
   * this by conventional name, so the many readers written against them keep
   * working while storage lives here.
   */
  slots: Record<string, SlotValue>
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
 * transcript refinement and replays against TTS audio (WB-2). The durable field
 * is `charAnchor`, a character offset into `slide.sourceTranscript`. Playback
 * turns `charAnchor` into a real audio time via TTS `<mark>` timepoints
 * (`charTimeFromMarks`), falling back to the linear `charAnchor / length`
 * proxy when no marks are available.
 * `source` records how precisely it was placed:
 *  - 'word'     nearest live word timing (google-cloud STT) — inside a phrase
 *  - 'appended' end of the transcript at draw time — every engine, no timings
 *  - 'elapsed'  playback-side fallback when TTS audio has no duration
 *  - 'unsynced' drawn with the mic off — not tied to narration at all, so it
 *               is ALWAYS shown on its slide (in or out of playback), never
 *               gated by the audio position (WB-2)
 *
 * `phraseText`/`phraseOffset` are the durable *phrase* binding: a snapshot of
 * the spoken phrase the mark was drawn over plus a 0..1 position within it. On
 * transcript refinement the phrase is re-matched semantically to the closest
 * phrase in the new narration and `charAnchor` re-derived, so the mark tracks
 * its idea rather than a proportional point. When no acceptable match survives,
 * `orphaned` is set and the mark is hidden — in the editing view as well as at
 * playback — but kept, so a later remap that finds its phrase restores it.
 */
export interface StrokeAnchor {
  charAnchor: number
  source: 'word' | 'appended' | 'elapsed' | 'unsynced'
  /** Recording session the event happened in; google-cloud STT only. */
  sessionId?: string
  /** Session-relative ms of the event; google-cloud STT only. */
  sessionMs?: number
  /** Snapshot of the spoken phrase this mark was drawn over — the durable
   * fingerprint re-matched on refinement. Set for 'word' anchors only. */
  phraseText?: string
  /** 0..1 position of the draw within `phraseText`, for intra-phrase precision. */
  phraseOffset?: number
  /** Set by the refine remap when the bound phrase no longer exists in the
   * rewritten transcript; hides the mark everywhere it renders, without
   * deleting it (WB-2 orphan policy). Cleared by a later matching remap. */
  orphaned?: boolean
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

/**
 * One slot's translated content.
 *
 * Mirrors the shape of the `SlotValue` it translates, so a list comes back a
 * list and a table keeps its grid — the viewer lays it over the slide without
 * needing to know which kind it is looking at. Only the kinds that hold prose
 * appear: see `TRANSLATABLE_SLOT_KINDS`.
 */
export type TranslatedSlot =
  | { kind: 'text' | 'preformatted'; value: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'table'; header?: string[]; rows: string[][] }

/**
 * One slide's translated slots and narration, each with the fingerprint of what
 * it was translated from.
 *
 * The two fingerprints are kept apart deliberately: what a slide *says* and
 * what a lecturer *said about it* are edited independently, so correcting a
 * spoken transcript (EDIT-6) must not re-pay for translating slide text nobody
 * touched, and editing a slide must not re-pay for narration nobody rewrote.
 */
export interface SlideTranslationEntry {
  /**
   * Keyed by slot name, like the slide itself (TMPL-9), so a layout with two
   * code samples and three paragraphs translates the paragraphs and leaves
   * the code alone — which five fixed fields could never express.
   */
  slots: Record<string, TranslatedSlot>
  /**
   * Hash of the slots this entry was translated from — their names, kinds and
   * text. Slides stay editable (EDIT-1), so an entry whose hash no longer
   * matches its slide is stale and is re-translated on the next view: one
   * edited slide costs one slide's translation, not the whole deck's.
   *
   * Names are in the hash on purpose. Content can move between boxes (a
   * layout switch, a template update), and a hash over text alone would still
   * match while the entry was keyed to boxes the slide no longer uses — a
   * cache that looks fresh and reads wrong. Any move either carries the entry
   * across explicitly or invalidates it.
   */
  sourceHash?: string
  /**
   * The slide's `sourceTranscript` in this locale, spoken by narration playback
   * (PLAY-3). It rides here rather than in a collection of its own because it
   * is the same deck, the same locale and the same cascade delete — and it is
   * simply absent until someone listens.
   */
  narration?: string
  /**
   * Hash of the transcript `narration` was translated from, so an edited
   * narration re-translates on its next play while the slide's own text — and
   * the rest of the deck — does not.
   */
  narrationHash?: string
}

/** Cached on-demand translation of a deck's slide content (SHARE-2). */
export interface SlideTranslation {
  id: string
  deckId: string
  locale: Locale
  perSlide: Record<string, SlideTranslationEntry>
  createdAt: string
}
