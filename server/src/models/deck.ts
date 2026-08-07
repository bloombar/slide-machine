/**
 * Deck model (SPEC §15 / SHARE-1). The transcript field retains the full
 * finalized lecture text for post-lecture reformatting (GEN-4).
 * updatedAt is bumped by deck saves and touched by slide edits, so
 * recency ordering reflects real modification.
 *
 * Access control: a lecture stores NO privacy settings of its own until
 * someone explicitly changes them — it inherits its project's ACL, so
 * project changes cascade to every inheriting lecture. The first
 * lecture-level change copies the project's current settings into
 * `accessOverride` (copy-on-write) and the lecture stops following the
 * project until the override is reset. resolveDeckAcl/loadDeckAcl
 * produce the effective ACL; decisions run through lib/access.ts.
 */
import { Schema, Types, type HydratedDocument } from 'mongoose'
import { defineModel } from './define-model'
import type {
  Deck,
  DiarizedSpeakerSegment,
  Visibility,
} from '@slide-machine/shared'
import { LOCALES } from '@slide-machine/shared'
import type { ResolvedAcl } from '../lib/access'
import { ProjectModel, projectAcl, type ProjectDb } from './project'
import { softDeletePlugin } from './plugins/soft-delete'

/** A lecture's own privacy settings, present only when overridden. */
export interface DeckAccessOverride {
  visibility: Visibility
  viewers: string[]
  editors: string[]
}

/**
 * A retained recording of one live session's audio (GEN-4 Phase 2), keyed by
 * the same `sessionId` its TranscriptSegments carry so the later diarization
 * pass can join speaker turns to the transcript. Server-only: not surfaced in
 * any DTO (the raw audio is not exposed to the client). `gcsUri` is set in
 * Phase 3 when the WAV is copied to GCS for batch diarization.
 */
export interface DeckRecordingDb {
  sessionId: string
  /** Blob-storage key of the WAV. */
  audioKey: string
  sampleRate: number
  durationMs: number
  gcsUri?: string
  createdAt: Date
  /**
   * Cached diarizer output for this recording. The retained WAV is written once
   * and never appended to, so the intervals are a pure function of (audio,
   * model) and never go stale — which matters because diarization is billed at
   * the same per-minute rate as live capture, and speaker identification is
   * invoked once per slide.
   */
  diarization?: DiarizedSpeakerSegment[]
  /** Which adapter produced them: a mock's scripted intervals must never be
   * reused once a real engine is configured. */
  diarizedBy?: string
  diarizedAt?: Date
}

/** The published exit-ticket quiz (Google Form) for a deck (QUIZ-3). */
export interface DeckQuizDb {
  formId: string
  formUrl: string
  driveFolderId: string
  driveFolderName?: string
  publishedAt: Date
  // The question stems of this quiz, kept so that regenerating after a delete
  // can steer clear of them (QUIZ-6).
  questions?: string[]
}

/** A deck export saved to the instructor's Google Drive (EXP-4), tracked so it
 * can be listed and deleted later (mirrors the quiz record). */
export interface DeckExportDb {
  fileId: string
  fileUrl: string
  fileName: string
  format: 'pdf' | 'yaml' | 'google-slides'
  driveFolderId: string
  driveFolderName?: string
  exportedAt: Date
  /** The user who saved this to their Drive. A different editor who later
   * deletes it can trash the app record but not the file (it lives in this
   * user's Drive), so this lets the UI say so (EXP-4). Absent on legacy rows. */
  savedBy?: Types.ObjectId
}

export interface DeckDb extends Omit<
  Deck,
  | 'id'
  | 'projectId'
  | 'ownerId'
  | 'createdAt'
  | 'updatedAt'
  | 'visibility'
  | 'accessInherited'
  | 'viewers'
  | 'editors'
> {
  projectId: Types.ObjectId
  ownerId: Types.ObjectId
  accessOverride?: DeckAccessOverride
  recordings?: DeckRecordingDb[]
  // The published exit-ticket quiz, once generated (QUIZ-3). Absent until then.
  quiz?: DeckQuizDb
  // Question stems from quizzes the instructor has since deleted/regenerated,
  // so a fresh quiz avoids repeating them (QUIZ-6). Capped and most-recent.
  quizPastQuestions?: string[]
  // Exports saved to Google Drive (EXP-4), newest last; absent until the first.
  exports?: DeckExportDb[]
  // True once the user sets the title by hand: the AI then stops suggesting
  // or refining it. False/absent = auto-titled, still open to AI refinement.
  titleLocked?: boolean
  createdAt: Date
  updatedAt: Date
  /** Soft-delete tombstone (P-10); null/absent = live. */
  deletedAt?: Date | null
}

/** Strict, id-less subdocument for one retained session recording. */
const recordingSchema = new Schema<DeckRecordingDb>(
  {
    sessionId: { type: String, required: true },
    audioKey: { type: String, required: true },
    sampleRate: { type: Number, required: true },
    durationMs: { type: Number, required: true },
    gcsUri: String,
    createdAt: { type: Date, default: Date.now },
    // Speaker turns from the last diarization of this recording, so repeat
    // passes re-tag from cache instead of re-billing the audio. Absent until
    // the first successful run.
    diarization: {
      type: [
        new Schema<DiarizedSpeakerSegment>(
          {
            speaker: { type: Number, required: true },
            startMs: { type: Number, required: true },
            endMs: { type: Number, required: true },
          },
          { _id: false },
        ),
      ],
      default: undefined,
    },
    diarizedBy: String,
    diarizedAt: Date,
  },
  { _id: false },
)

/** Strict, id-less subdocument for the published quiz Form (QUIZ-3). */
const quizSchema = new Schema<DeckQuizDb>(
  {
    formId: { type: String, required: true },
    formUrl: { type: String, required: true },
    driveFolderId: { type: String, required: true },
    driveFolderName: String,
    publishedAt: { type: Date, default: Date.now },
    questions: { type: [String], default: undefined },
  },
  { _id: false },
)

/** Strict, id-less subdocument for a Drive-saved export (EXP-4). */
const exportSchema = new Schema<DeckExportDb>(
  {
    fileId: { type: String, required: true },
    fileUrl: { type: String, required: true },
    fileName: { type: String, required: true },
    format: {
      type: String,
      enum: ['pdf', 'yaml', 'google-slides'],
      required: true,
    },
    driveFolderId: { type: String, required: true },
    driveFolderName: String,
    exportedAt: { type: Date, default: Date.now },
    savedBy: { type: Schema.Types.ObjectId, ref: 'User', default: undefined },
  },
  { _id: false },
)

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
    // Empty allowed: the UI shows untitled lectures as 'Untitled lecture'
    title: { type: String, default: '', trim: true },
    // Set when the user names the lecture by hand; the AI stops touching it.
    titleLocked: { type: Boolean, default: false },
    templateId: { type: String, required: true },
    // The template snapshot this lecture is drawn with (TMPL-11). Not
    // required: lectures written before versions existed have none and
    // resolve their template live until the backfill pins them.
    templateVersionId: { type: String },
    accessOverride: {
      type: {
        visibility: {
          type: String,
          enum: ['restricted', 'public'],
          required: true,
        },
        viewers: { type: [String], default: [] },
        editors: { type: [String], default: [] },
      },
      default: undefined,
      _id: false,
    },
    permalinkSlug: { type: String, required: true, unique: true },
    slideOrder: { type: [String], default: [] },
    seedContext: String,
    // Absent = inherit the project's setting; stored only when set
    generationFreedom: { type: Number, min: 1, max: 5, default: undefined },
    // Per-lecture Refine settings; toggles absent = default on (speakers only
    // with audio), levels absent = inherit the server default.
    refineIdentifySpeakers: { type: Boolean, default: undefined },
    refineSlidesEnabled: { type: Boolean, default: undefined },
    refineSlidesLevel: { type: Number, min: 1, max: 5, default: undefined },
    refineTranscriptEnabled: { type: Boolean, default: undefined },
    refineTranscriptLevel: { type: Number, min: 1, max: 5, default: undefined },
    // Explicit lecturing language only; absent = inherit (project, then
    // owner profile, then the speaker's browser)
    language: { type: String, enum: LOCALES, default: undefined },
    // Narration voice id (TTS_VOICES); absent = inherit the project's
    ttsVoice: { type: String, default: undefined },
    transcript: String,
    // Retained session-audio references (GEN-4 Phase 2); server-only, appended
    // once per recording, never surfaced in a DTO.
    recordings: { type: [recordingSchema], default: undefined },
    quiz: { type: quizSchema, default: undefined },
    quizPastQuestions: { type: [String], default: undefined },
    exports: { type: [exportSchema], default: undefined },
    voteScore: { type: Number, default: 0 },
  },
  { timestamps: true },
)

// Full-text search over a lecture's own words (SOC-2). A case-insensitive
// regex cannot use an index, so searching by scanning every deck stops working
// as the corpus grows; this index makes whole-word queries indexed lookups.
// The title is weighted far above the transcript: a lecture called "Osmosis"
// should beat one that merely says the word once.
deckSchema.index(
  { title: 'text', transcript: 'text' },
  { weights: { title: 10, transcript: 1 }, name: 'deck_text' },
)

// Which lectures a design draws. Asked when deciding whether someone editing
// a lecture may read the private design behind it (TECH-14); without this the
// question costs a scan of every lecture, including when the answer is none.
deckSchema.index({ templateId: 1 })

deckSchema.plugin(softDeletePlugin)

// Reachable from the action graph — the dispatcher resolves a lecture and
// project for cost attribution (BILL-7), which some specs re-evaluate.
export const DeckModel = defineModel<DeckDb>('Deck', deckSchema)

type DeckLike = Pick<DeckDb, 'ownerId' | 'accessOverride'>

/** The effective ACL: the lecture's override, or its project's settings
 * with the LECTURE's owner (ownership can differ after a transfer). */
export const resolveDeckAcl = (
  deck: DeckLike,
  project: Pick<
    ProjectDb,
    'ownerId' | 'visibility' | 'viewers' | 'editors'
  > | null,
): ResolvedAcl => {
  if (deck.accessOverride) {
    return {
      ownerId: deck.ownerId.toString(),
      visibility: deck.accessOverride.visibility,
      viewers: deck.accessOverride.viewers,
      editors: deck.accessOverride.editors,
      inherited: false,
    }
  }
  // A dangling project reads as restricted-to-owner, never public
  const base = project
    ? projectAcl(project)
    : { visibility: 'restricted' as Visibility, viewers: [], editors: [] }
  return {
    ownerId: deck.ownerId.toString(),
    visibility: base.visibility,
    viewers: base.viewers,
    editors: base.editors,
    inherited: true,
  }
}

/** Resolves a single deck's ACL, loading its project when inheriting. */
export const loadDeckAcl = async (
  deck: DeckLike & { projectId: Types.ObjectId },
): Promise<ResolvedAcl> => {
  if (deck.accessOverride) return resolveDeckAcl(deck, null)
  const project = await ProjectModel.findById(deck.projectId).catch(() => null)
  return resolveDeckAcl(deck, project)
}

/**
 * Batch ACL resolution: one project query for a whole deck list.
 *
 * `withDeleted` lets the project lookup see tombstoned projects, so an
 * inheriting lecture that was deleted with its project still resolves its
 * real visibility instead of the dangling-project fallback (`restricted`).
 * The admin console passes it when listing soft-deleted content (ADMIN-6);
 * product paths never hold a tombstoned lecture, so they leave it off.
 */
export const loadDeckAcls = async (
  decks: Array<HydratedDocument<DeckDb>>,
  opts: { withDeleted?: boolean } = {},
): Promise<Map<string, ResolvedAcl>> => {
  const inheriting = decks.filter(d => !d.accessOverride)
  const projectIds = [...new Set(inheriting.map(d => d.projectId.toString()))]
  const projects = projectIds.length
    ? await ProjectModel.find({ _id: { $in: projectIds } }).setOptions({
        withDeleted: opts.withDeleted,
      })
    : []
  const byId = new Map(projects.map(p => [p._id.toString(), p]))
  return new Map(
    decks.map(d => [
      d._id.toString(),
      resolveDeckAcl(d, byId.get(d.projectId.toString()) ?? null),
    ]),
  )
}

/**
 * Copy-on-write: the first explicit change to a lecture's privacy
 * settings snapshots the effective (inherited) ACL as the lecture's own
 * override; from then on the lecture stops following its project. The
 * caller still owns `markModified('accessOverride')` and the save.
 * Shared by the owner-facing actions (actions/deck.ts) and the admin
 * settings editor (routes/admin-settings.ts).
 */
export const ensureDeckOverride = (
  deck: HydratedDocument<DeckDb>,
  acl: ResolvedAcl,
): void => {
  if (deck.accessOverride) return
  deck.accessOverride = {
    visibility: acl.visibility,
    viewers: [...acl.viewers],
    editors: [...acl.editors],
  }
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

/** The wire shape carries the EFFECTIVE access, so every consumer —
 * radios, badges, lists — reads one field regardless of inheritance. */
export const toDeckDto = (
  doc: HydratedDocument<DeckDb>,
  acl: ResolvedAcl,
): Deck => ({
  id: doc._id.toString(),
  projectId: doc.projectId.toString(),
  ownerId: doc.ownerId.toString(),
  title: doc.title,
  templateId: doc.templateId,
  templateVersionId: doc.templateVersionId,
  visibility: acl.visibility,
  accessInherited: acl.inherited,
  viewers: acl.viewers,
  editors: acl.editors,
  permalinkSlug: doc.permalinkSlug,
  slideOrder: doc.slideOrder,
  seedContext: doc.seedContext,
  generationFreedom: doc.generationFreedom,
  refineIdentifySpeakers: doc.refineIdentifySpeakers,
  refineSlidesEnabled: doc.refineSlidesEnabled,
  refineSlidesLevel: doc.refineSlidesLevel,
  refineTranscriptEnabled: doc.refineTranscriptEnabled,
  refineTranscriptLevel: doc.refineTranscriptLevel,
  language: doc.language,
  ttsVoice: doc.ttsVoice,
  transcript: doc.transcript,
  hasRecordings: (doc.recordings?.length ?? 0) > 0,
  voteScore: doc.voteScore,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: (doc.updatedAt ?? doc.createdAt).toISOString(),
})

/** The deck as shown to non-owners: share lists stay with the owner. */
export const toSharedDeckDto = (
  doc: HydratedDocument<DeckDb>,
  acl: ResolvedAcl,
): Deck => {
  const dto = toDeckDto(doc, acl)
  delete dto.viewers
  delete dto.editors
  return dto
}
