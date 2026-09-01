/**
 * Input DTOs for TECH-13 actions dispatched via POST /api/actions/:name.
 * Results reuse the shared data-model types (e.g. Project).
 */
import type { Locale } from '../types/locale'
import type {
  ImageAttribution,
  Slide,
  SlotValue,
  Stroke,
  Visibility,
} from '../types/deck'
import type { AccountType, ProfileVisibility } from '../types/user'
import type { WordTiming } from '../providers/transcription'
import type { SlideSplitPart } from '../providers/generation'

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

/** Whether the lecture's template has moved on since it was pinned (TMPL-11). */
export interface DeckTemplateUpdateStatusInput {
  deckId: string
}

/** Take the template's current structure onto every slide (TMPL-11). */
export interface DeckApplyTemplateUpdateInput {
  deckId: string
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

/** Lecture study label (EVAL-3, admins only); empty string clears it. */
export interface DeckSetStudyLabelInput {
  deckId: string
  studyLabel: string
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

/**
 * Owner-only: file the lecture under a different project (PROJ-3). The
 * caller must own both the lecture and the destination project.
 */
export interface DeckMoveInput {
  deckId: string
  projectId: string
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

/** The answer to the post-sign-in "what are you?" prompt (AUTH-6). The
 * first answer also settles the account's privacy defaults. */
export interface UserSetAccountTypeInput {
  accountType: AccountType
}

/** The signed-in user's own public profile fields (AUTH-5); only
 * provided fields change. An empty bio clears it. Admins edit these on
 * someone else's account through the audited admin endpoint instead. */
export interface UserUpdateProfileInput {
  displayName?: string
  bio?: string
}

/** Explicit lecturing/generation language; null clears back to the
 * browser default. */
export interface UserSetLanguageInput {
  language: Locale | null
}

/** Interface language (TECH-12). Like `language`, null clears the stored
 * preference so the interface follows the browser again. */
export interface UserSetLocaleInput {
  locale: Locale | null
}

/** The account's default design (TMPL-24): the template new projects start
 * from. Null clears the choice, so new projects fall back to the
 * deployment's default template again. */
export interface UserSetTemplateInput {
  templateId: string | null
}

/** Lecture-level language; null re-inherits project/profile/browser. */
export interface DeckSetLanguageInput {
  deckId: string
  language: Locale | null
}

/** Per-lecture Refine settings (GEN-4): which passes are on plus their slider
 * levels. For a boolean, true/false sets it and null re-inherits the default;
 * for a level a number sets it and null re-inherits the server default. Any
 * field left absent is unchanged. These settings drive both the whole-lecture
 * refine and the single-slide "Refine this slide" kebab action. */
export interface DeckSetRefineSettingsInput {
  deckId: string
  identifySpeakers?: boolean | null
  slidesEnabled?: boolean | null
  slidesLevel?: number | null
  /** Whether a refine may break a slide into several when one cannot hold it. */
  splitEnabled?: boolean | null
  transcriptEnabled?: boolean | null
  transcriptLevel?: number | null
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
  /** True while a whiteboard tool is active during recording (WB-3): the
   * server appends the phrase to the current slide instead of auto-creating a
   * new one, so drawing never spawns slides. The "+" button and the "new
   * slide" voice command bypass this path and still create slides. */
  suppressNewSlide?: boolean
  /** True while content generation is paused because the user is actively
   * marking up a slide (WB-3): the server records the phrase to the transcript
   * (deck + segment + the current slide's source transcript) but skips slide
   * generation entirely, so neither content nor layout changes while drawing.
   * Stronger than `suppressNewSlide`, which still applies content updates. */
  pauseGeneration?: boolean
}

/** Run post-lecture speaker diarization on a deck's retained recordings and
 * tag its transcript segments with speaker + role (GEN-4 Phase 3). */
export interface DeckDiarizeInput {
  deckId: string
}

/** Summary of a diarization run. */
export interface DeckDiarizeResult {
  /** Recording sessions that produced diarization output. */
  sessionsProcessed: number
  /** Transcript segments given a speaker + role. */
  segmentsTagged: number
}

/**
 * Which aspects of a slide the content pass may change. Refining a slide is one
 * generation call whose result has three separable parts, so a caller can ask
 * for any subset; both the per-slide Refine dialog and the lecture-wide Refine
 * tab expose all three.
 *
 * Absent fields mean "yes": omitting the object entirely refines everything.
 *
 * Breaking a slide into several is NOT one of these — it changes how many
 * slides the lecture has rather than what one slide says, so it is its own
 * permission (`allowSplit`) alongside this object.
 */
export interface SlideRefineParts {
  /** Rewrite the slide's words, within its current layout. */
  text?: boolean
  /** Let the pass move the slide onto a layout that presents it better. */
  layout?: boolean
  /** Source an image when the layout has an empty image slot. */
  imagery?: boolean
}

/**
 * Post-lecture refinement (GEN-4 "Refine"): any combination of the three
 * passes, run as one background job. Sliders are 1 (light) – 5 (substantial).
 */
export interface DeckRefineInput {
  deckId: string
  /** Identify lecturer vs students and reframe student turns as questions. */
  identifySpeakers?: boolean
  /** Improve each slide's content/layout/image in place. `parts` narrows what
   * may change; absent = all of them. `allowSplit` lets the pass break a slide
   * into several where one genuinely cannot hold it; absent/false never does. */
  refineSlides?: {
    level: number
    parts?: SlideRefineParts
    allowSplit?: boolean
  }
  /** Rewrite each slide's spoken narration to describe concepts more eloquently. */
  refineTranscript?: { level: number }
}

/** deck.refine kicks off a background job and returns its id to poll. */
export interface DeckRefineResult {
  jobId: string
}

export type RefineJobStatus = 'running' | 'done' | 'error'

/** What a refine job changed, once done. */
export interface RefineJobSummary {
  /** Slides reframed to mark student turns as questions/feedback. */
  reframed: number
  /** Slides whose content was refined. */
  slidesRefined: number
  /** Slides that were broken into several because one could not hold them
   * (only ever non-zero when the run allowed splitting). */
  slidesSplit: number
  /** Slides whose spoken narration was updated (refinement + keeping TTS in-line). */
  transcriptsUpdated: number
}

export interface DeckRefineStatusInput {
  jobId: string
}

/** Which pass of a refine job is running. Ordered as they run. */
export type RefineJobPhase = 'speakers' | 'slides' | 'narration'

/**
 * Where a running refine job has got to, so the client can name the slide
 * being worked on rather than saying only "working in the background".
 *
 * Written before each slide and read by polling, so it is a snapshot: by the
 * time it is displayed the job may already be on the next slide. That is fine
 * for a progress line and is why nothing is decided from it.
 */
export interface RefineJobProgress {
  phase: RefineJobPhase
  /** Slides this pass has finished. */
  done: number
  /** Slides this pass will visit in total. */
  total: number
  /** 1-based position in the lecture of the slide being worked on now. */
  index?: number
  /** That slide's title, or its opening words when it has no title. Absent
   * when the slide is blank. */
  title?: string
}

export interface DeckRefineStatusResult {
  status: RefineJobStatus
  summary?: RefineJobSummary
  /** Present while running, once the first slide has been reached. */
  progress?: RefineJobProgress
  error?: string
}

/** What one run of the per-slide Refine dialog should do. Every field is
 * optional; `options` as a whole may be omitted, which falls back to the
 * lecture's persisted Refine settings (how the kebab behaved before the dialog
 * existed, and how a scripted caller gets "the usual"). */
export interface SlideRefineOptions {
  /** Diarize the recording this slide's speech came from and reframe the slide
   * if students spoke on it. Needs retained audio for the slide. */
  identifySpeakers?: boolean
  /** Which aspects of the slide the content pass may change; absent = all. */
  parts?: SlideRefineParts
  /** Let the refine break this slide into several when one slide genuinely
   * cannot hold what it carries. Absent = the lecture's saved setting. */
  allowSplit?: boolean
  /** Rewrite the slide's spoken narration too. */
  refineTranscript?: boolean
  /** 1 (light) – 5 (substantial), applied to BOTH the content and narration
   * passes of this run. Absent = the lecture's saved levels. */
  level?: number
}

/** Refine a single slide (the "Refine this slide" kebab action). Runs the same
 * passes as the whole-lecture refine but scoped to one slide. Without
 * `options` it uses the lecture's persisted Refine settings. */
export interface DeckRefineSlideInput {
  deckId: string
  slideId: string
  options?: SlideRefineOptions
}

/** The refreshed slide plus what changed, so the viewer can patch it in place. */
export interface DeckRefineSlideResult {
  slide: Slide
  /** The slide's content was refined (false if disabled or hand-edited). */
  refined: boolean
  /** The slide's narration was re-generated. */
  narrationUpdated: boolean
  /** Speakers were identified for this slide's audio (absent when not asked
   * for); true only when the slide was actually reframed as student speech. */
  reframed?: boolean
  /**
   * The slide was broken into several (GEN-4), and this is what that did.
   *
   * Only ever present when the run allowed splitting AND one slide genuinely
   * could not hold the content. `slide` above is the first part, keeping the
   * original's id and place; these are the slides inserted after it, and the
   * deck's order once they were.
   */
  split?: SlideSplitOutcome
}

/** The result of breaking one slide into several, for a viewer patching the
 * deck in place rather than reloading it. */
export interface SlideSplitOutcome {
  /** The model's one-phrase reason, so the instructor can be told WHY their
   * slide became several — "three separate stages". */
  reason: string
  /** The slides created after the original, in order. */
  added: Slide[]
  /** The deck's slide order after the insert, so the viewer can re-key. */
  slideOrder: string[]
}

/**
 * Apply a split the instructor accepted (GEN-4).
 *
 * The parts are sent back rather than looked up, so what is written is
 * exactly what they were shown — the same contract the quiz review uses
 * (QUIZ-2). They are validated against the deck's own template regardless.
 */
export interface DeckSplitSlideInput {
  deckId: string
  slideId: string
  parts: SlideSplitPart[]
}

export interface DeckSplitSlideResult {
  /** The original slide, now holding the first part. */
  slide: Slide
  /** The slides created after it, in order. */
  added: Slide[]
  /** The deck's slide order after the insert, so the viewer can re-key. */
  slideOrder: string[]
}

/** Refine just one slide's spoken narration (EDIT-6 "Refine" in the transcript
 * editor). Runs the same narration pass, at the same strength, as the kebab
 * "Refine this slide" and the lecture-wide Refine tab. Without `save` the text
 * is only returned, for the user to review before committing. */
export interface DeckRefineSlideTranscriptInput {
  deckId: string
  slideId: string
  save?: boolean
}

export interface DeckRefineSlideTranscriptResult {
  /** The refined narration. */
  transcript: string
  /** The refreshed slide — present only when it was saved. */
  slide?: Slide
}

/** Reformat a deck's slides now that speaker roles are known (GEN-4 Phase 4). */
export interface DeckReformatInput {
  deckId: string
}

/** Summary of a reformat run: how each slide was handled. */
export interface DeckReformatResult {
  /** Student/mixed slides regenerated with role context. */
  reformatted: number
  /** Lecturer-only slides left unchanged. */
  kept: number
  /** Hand-edited or manually-added slides protected from change. */
  protectedCount: number
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
  /** Edits keyed by slot name, for any slot the layout declares — including
   * ones the template's author named (TMPL-9). Merged per slot, so patching
   * one leaves the rest alone. */
  slots?: Record<string, SlotValue>
}

/** Replaces a slide's spoken narration (EDIT-6). The transcript drives TTS
 * playback and is the timeline whiteboard marks are anchored to, so the server
 * re-anchors those marks onto the new text rather than stranding them. */
export interface SlideEditTranscriptInput {
  slideId: string
  transcript: string
}

/** Re-transcribes one slide from its retained lecture audio (GEN-4/EDIT-6).
 * Without `save` the text is only returned — the transcript editor shows it for
 * the user to accept or discard; a bulk pass sets `save` to write each slide. */
export interface SlideRegenerateTranscriptInput {
  slideId: string
  save?: boolean
}

export interface SlideRegenerateTranscriptResult {
  /** What the speech engine heard in the slide's recorded audio. */
  transcript: string
  /** The refreshed slide — present only when it was saved. */
  slide?: Slide
}

/** Replaces a slide's whiteboard drawings wholesale (WB-1). The client sends
 * the full stroke set after each draw/erase; erased strokes are kept (with
 * their `erasedAnchor`) so synced playback can replay the erasure. */
export interface SlideEditDrawingsInput {
  slideId: string
  drawings: Stroke[]
}

export interface SlideDeleteInput {
  slideId: string
}

/** Switches one slide's layout to another of its template's layouts (EDIT-3). */
export interface SlideSetLayoutInput {
  slideId: string
  layoutType: string
}

/**
 * Fills the boxes a layout switch left empty (GEN-9). Sent right after
 * `slide.setLayout`; the server decides whether there is anything to do, so
 * a switch that carried across cleanly costs no AI call.
 */
export interface SlideRefitLayoutInput {
  slideId: string
  /** The layout the slide just came from, so the request can describe what
   * the content used to sit in. */
  fromLayoutType?: string
}

/** The refit's outcome, so the client knows whether to offer an undo. */
export interface SlideRefitLayoutResult {
  slide: Slide
  /** Boxes the refit wrote into. Empty when nothing needed filling or the
   * model declined — in both cases the slide came back unchanged. */
  filled: string[]
}

/** Appends a blank starter slide at the end of the deck. */
export interface SlideAddInput {
  deckId: string
  /** Layout for the new slide; defaults to `content` with placeholder text.
   * A `whiteboard` layout yields a truly blank canvas (no placeholder). Must
   * be a layout of the deck's template. */
  layoutType?: string
}

/** Full new ordering; must contain exactly the deck's current slide ids. */
export interface DeckReorderInput {
  deckId: string
  slideOrder: string[]
}
