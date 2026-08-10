/**
 * GenerationProvider — finalized speech + context in, slide content out
 * (SPEC GEN-1/GEN-6/GEN-7/GEN-8 / TECH-8). Gemini is the pilot adapter.
 * Interface is minimal and expected to evolve with the first adapter.
 */
import type { SlotKind, LayoutDescriptor } from '../types/template'
import type { SlotValue } from '../types/deck'
import type {
  VoiceCommand,
  VoiceCommandDescriptor,
} from '../types/voice-commands'
import type { SpeakerRole } from './diarization'

/** A seeded image the model may select for a slide (SEED-2 / GEN-7). */
export interface SeededImageDescriptor {
  id: string
  caption?: string
  keywords: string[]
}

export interface SlideGenerationRequest {
  /** The finalized spoken phrase driving this generation step. */
  phrase: string
  /** Short rolling context of recent phrases/slides for topic coherence. */
  rollingContext: string[]
  /** Deck-level structure so the windowed model can make heading (title/section)
   * decisions it otherwise couldn't: the running outline of heading slides plus
   * a few positional signals. Absent for an empty deck or when the
   * GENERATION_DECK_STRUCTURE flag is off. */
  deckStructure?: {
    /** Slides created so far. */
    totalSlides: number
    /** Slides since the last title/section heading. */
    slidesSinceHeader: number
    /** A title slide already opened the deck. */
    hasTitleSlide: boolean
    /** The heading (title/section) slides so far, in order. */
    outline: { position: number; layoutType: string; title: string }[]
  }
  /** Seed context layers (typed notes, imported docs, honed concepts).
   * Deck-level notes are more specific and outrank project-level ones. */
  seedContext?: {
    project?: string
    deck?: string
  }
  /** The active template's layouts — the option set the model must pick from (GEN-6). */
  layoutDescriptors: LayoutDescriptor[]
  seededImages?: SeededImageDescriptor[]
  /** Content freedom 1-5: 1 = only what was said, 5 = free
   * elaboration. Servers resolve it from lecture → project → config. */
  freedom?: number
  /** Language for generated slide text: the resolved lecture ??
   * project ?? speaker-profile setting, else the speaker's browser
   * language tag. Absent = let the model mirror the speech. */
  language?: string
  /** The lecture is still untitled: also propose a short deck title.
   * The server stops asking once a title is saved. */
  suggestDeckTitle?: boolean
  /** Snapshot of the current (last) slide so the model can judge
   * whether an update still fits or a new slide is due (GEN-8). */
  currentSlide?: {
    layoutType: string
    bulletCount: number
    bodyChars: number
    /** The slide's exact slot content — present when layout re-fit is
     * allowed, so the model can re-map it rather than guess it from
     * the rolling context. */
    content?: {
      title?: string
      body?: string
      bullets?: string[]
      caption?: string
    }
    /** Everything the speaker has said while on this slide (its raw
     * `sourceTranscript`), so the model can judge what it already covers —
     * distinct from the polished slot content above. */
    sourceTranscript?: string
  }
  /** GENERATION_LAYOUT_REFIT feature flag: the model may switch an
   * updated slide's layout — including a full re-map of existing
   * content via updateMode 'refit' (GEN-8 "re-fit the layout"). */
  allowLayoutRefit?: boolean
  /** GENERATION_LIVE_REPHRASE feature flag: a "refit" may also KEEP the
   * layout and re-state existing content when clearer phrasing improves
   * it (not only when the layout should change). Only meaningful when
   * `allowLayoutRefit` is also true. */
  allowRephrase?: boolean
  /** The user is hand-annotating the current slide right now (WB-3): the model
   * must NOT change its layout, so it isn't rearranged out from under the
   * drawing. The server also enforces this regardless of the model's answer. */
  lockLayout?: boolean
  /** The current slide is a heading (title/section) slide — typically the
   * deck's opening title card. Its layout is pinned for the whole lecture: the
   * model may sharpen its title/caption in place, but must never re-fit it to
   * a different layout; content that needs body text or bullets belongs on a
   * NEW slide. The server enforces this regardless of the model's answer. */
  pinLayout?: boolean
  /** The fixed CAP-4 command set the model may recognize as the intent
   * of a phrase. Present only when the server's GENERATION_VOICE_COMMANDS
   * feature flag is on; absent = command detection disabled. */
  voiceCommands?: VoiceCommandDescriptor[]
}

/**
 * The model's per-slide image recommendation (GEN-7). Image *generation*
 * (IMG-4) is not supported yet: there is deliberately no `generate` field,
 * so the model cannot instruct the app to generate an image. Reintroduce it
 * together with the consumer that acts on it when generation lands.
 */
export interface ImageGuidance {
  keywords: string[]
  /** Set when the model selects a specific seeded image. */
  seededImageId?: string
  /** True when the slide warrants no image. */
  none?: boolean
}

export interface SlideGenerationResult {
  /** Whether the phrase starts a new slide, updates the current one,
   * changes nothing (GEN-8) — or, when voice commands were offered, is
   * an operational command addressed to the slide system. */
  action: 'new' | 'update' | 'none' | 'command'
  layoutType: string
  /**
   * Content for the conventional boxes, which the slide derives fields from.
   *
   * These four have a place of their own because the DTO and much of the app
   * read them directly; every other box the layout declares arrives in
   * `declared`. The model does not see the split — it returns one object
   * keyed by slot name (GEN-11) — and the two are put back together on the
   * slide.
   */
  slots: {
    title?: string
    body?: string
    bullets?: string[]
    caption?: string
  }
  /**
   * Content for the boxes a template's author named beyond the conventional
   * four, keyed by their names and already in the shape their declared kind
   * calls for (GEN-11/TMPL-9).
   *
   * Validated against the layout before it gets here: a name the layout does
   * not declare is discarded, and a value of the wrong shape is coerced only
   * where that is unambiguous.
   */
  declared?: Record<string, SlotValue>
  imageGuidance?: ImageGuidance
  /** Update semantics (allowLayoutRefit only): 'delta' (the default)
   * means slots hold ONLY the added material; 'refit' means slots hold
   * the COMPLETE slide re-mapped to the chosen layout. */
  updateMode?: 'delta' | 'refit'
  /** Set when action is 'command': the recognized command id. */
  command?: VoiceCommand
  /** Proposed lecture title (suggestDeckTitle requests only). */
  deckTitle?: string
}

/** One role-annotated turn feeding a post-lecture reformat (GEN-4 Phase 4). */
export interface ReformatTurn {
  role: SpeakerRole
  text: string
}

/**
 * Reformat one slide with speaker roles known (GEN-4 Phase 4). The lecturer's
 * turns are authoritative; students' turns are questions/feedback and must be
 * rendered as such, not as fact. Only slides that mix in student speech are
 * reformatted — lecturer-only, hand-edited, and manually-added slides are left
 * alone by the caller.
 */
export interface SlideReformatRequest {
  /** The slide's current content, to revise in place. */
  current: {
    layoutType: string
    title?: string
    body?: string
    bullets?: string[]
    caption?: string
  }
  /** The role-annotated transcript turns that produced this slide, in order. */
  turns: ReformatTurn[]
  /** The active template's layouts — the option set to pick from (GEN-6). */
  layoutDescriptors: LayoutDescriptor[]
  language?: string
  seedContext?: {
    project?: string
    deck?: string
  }
}

/** Revised slide content from a reformat. */
export interface SlideReformatResult {
  layoutType: string
  slots: {
    title?: string
    body?: string
    bullets?: string[]
    caption?: string
  }
  imageGuidance?: ImageGuidance
}

/** The slide content the refine/narrate passes operate on. */
export interface SlideContent {
  layoutType: string
  title?: string
  body?: string
  bullets?: string[]
  caption?: string
  /**
   * The prose in boxes a template's author named, beyond the conventional
   * four (TMPL-9) — so a slide whose substance sits in a box called
   * "takeaway" is not narrated as if it were blank.
   *
   * Only what can be said: a formula's LaTeX and a program listing are not
   * language and never appear here (EDIT-7, `lib/narratable.ts`).
   */
  spoken?: string[]
}

/**
 * Improve one slide's content/layout/image in place (GEN-4 "Refine all
 * slides"). `level` 1 (light polish) – 5 (substantial rework) sets how much to
 * change. Add/delete of slides is out of scope here — this refines existing
 * slides only.
 */
export interface SlideRefineRequest {
  current: SlideContent
  level: number
  layoutDescriptors: LayoutDescriptor[]
  language?: string
  seedContext?: {
    project?: string
    deck?: string
  }
  /** The slide's current spoken transcript, used as source material so the
   * refinement stays faithful to what was actually said. On the first refine
   * this is the original spoken words; on later refines it is the previously
   * refined narration, so refinement compounds. Absent = none available. */
  transcript?: string
}

export interface SlideRefineResult {
  layoutType: string
  slots: {
    title?: string
    body?: string
    bullets?: string[]
    caption?: string
  }
  imageGuidance?: ImageGuidance
}

/**
 * Produce the spoken narration for a slide (GEN-4 "Refine the spoken
 * transcript", and to keep TTS playback in-line after content changes). The
 * result is stored as the slide's narration transcript. `level` 1 (plain,
 * faithful) – 5 (rich, eloquent).
 *
 * Two modes: with `turns` (the slide's role-tagged segments, in order) the
 * narration is **regenerated from them** and a brief spoken attribution is
 * woven in at each student turn while the lecturer stays authoritative —
 * `transcript` is ignored, so repeated refines can't compound. Without `turns`,
 * `studentContext` frames the whole slide as a student question/comment, and a
 * present `transcript` is refined incrementally (legacy path).
 */
export interface SlideNarrateRequest {
  slide: SlideContent
  level: number
  studentContext?: boolean
  language?: string
  /** The slide's current narration/transcript. When present (and `turns` is
   * not), the narration is refined further from it (incremental) rather than
   * written from scratch. Absent = write fresh from the slide. */
  transcript?: string
  /** The slide's role-tagged speech turns, in order (diarized slides). When
   * present, the narration is written fresh from these, attributing student
   * turns at the exact points the speaker switched; `transcript` is ignored. */
  turns?: ReformatTurn[]
}

export interface SlideNarrateResult {
  transcript: string
}

/**
 * One box in a layout-refit request: what it is, what it will hold, and what
 * it currently holds. Sent for both sides of the switch, so the model can see
 * that a paragraph is becoming a bullet list rather than guessing from names.
 */
export interface RefitSlotDescriptor {
  name: string
  /** What the box holds (TMPL-9). The model is told the kind so it writes
   * content of the right sort for it — a code box gets a listing, not prose. */
  kind: SlotKind
  /** The author's name for the box ("Key points"), which often says what it
   * is for better than the slot name does. */
  label: string
  /** The style role it follows, when it has one ('heading', 'caption', …). */
  textStyle?: string
  maxChars?: number
  maxItems?: number
  /** What the box holds right now. Text and lists only — a picture is moved
   * by the pairing, never re-written by the model. */
  value?: string | string[]
}

/**
 * Filling the boxes a layout switch left empty (GEN-9).
 *
 * Deliberately narrow: boxes that paired keep their content untouched, so
 * this asks only for the holes. That keeps hand-edited text safe, keeps the
 * call small, and means the answer can be applied without diffing.
 */
export interface SlideRefitRequest {
  /** The layout being left, with the content each of its boxes held. */
  from: {
    layoutType: string
    label: string
    slots: RefitSlotDescriptor[]
  }
  /** The layout being moved to: every box, so the model can see what the
   * holes sit among. */
  to: {
    layoutType: string
    label: string
    purpose: string
    slots: RefitSlotDescriptor[]
  }
  /** The boxes to write content for — names from `to.slots`. Everything
   * else is already filled and must not be rewritten. */
  fill: string[]
  /** Content from the old layout that no box in the new one took: the
   * source material the holes should be written from where it fits. */
  orphaned: RefitSlotDescriptor[]
  language?: string
  seedContext?: {
    project?: string
    deck?: string
  }
}

/** Content for the holes, keyed by slot name. Slots outside the request's
 * `fill` list are ignored by the caller. */
export interface SlideRefitResult {
  slots: Record<string, string | string[]>
}

export interface GenerationProvider {
  readonly name: string
  generateSlideContent(
    request: SlideGenerationRequest,
  ): Promise<SlideGenerationResult>
  /** Post-lecture reformat of one slide with speaker roles (GEN-4 Phase 4). */
  reformatSlide(request: SlideReformatRequest): Promise<SlideReformatResult>
  /** Write content for boxes a layout switch left empty (GEN-9). */
  refitSlideLayout(request: SlideRefitRequest): Promise<SlideRefitResult>
  /** Improve one slide's content/layout/image (GEN-4 Refine). */
  refineSlide(request: SlideRefineRequest): Promise<SlideRefineResult>
  /** Spoken narration for a slide, kept in-line with its content (GEN-4 Refine). */
  narrateSlide(request: SlideNarrateRequest): Promise<SlideNarrateResult>
  /** Embedding vectors for texts, used to semantically re-anchor whiteboard
   * marks to the closest phrase after a transcript rewrite (WB-2). One vector
   * per input, in order. Throwing is acceptable — callers fall back to a
   * proportional remap when embeddings are unavailable. */
  embedTexts(texts: string[]): Promise<number[][]>
}
