/**
 * RefineJob (GEN-4 Refine). Post-lecture refinement — diarization, slide
 * refinement, narration — can run for minutes, so `deck.refine` starts a job
 * and returns its id; the client polls `deck.refineStatus`. Access to a job is
 * gated by edit access to its deck, so no owner field is stored here.
 */
import { Schema, model, Types } from 'mongoose'
import type {
  RefineJobProgress,
  RefineJobStatus,
  RefineJobSummary,
} from '@slide-machine/shared'
import { softDeletePlugin } from './plugins/soft-delete'

export interface RefineJobDb {
  deckId: Types.ObjectId
  status: RefineJobStatus
  summary?: RefineJobSummary
  /** Where the run has got to, rewritten as it advances so a polling client
   * can name the slide being refined. Absent before the first slide. */
  progress?: RefineJobProgress
  error?: string
  createdAt: Date
  updatedAt: Date
  /** Soft-delete tombstone (P-10); null/absent = live. */
  deletedAt?: Date | null
}

const summarySchema = new Schema<RefineJobSummary>(
  {
    reframed: { type: Number, required: true },
    slidesRefined: { type: Number, required: true },
    slidesSplit: { type: Number, required: true },
    transcriptsUpdated: { type: Number, required: true },
  },
  { _id: false },
)

/** The running job's position, replaced wholesale on each update. */
const progressSchema = new Schema<RefineJobProgress>(
  {
    phase: {
      type: String,
      enum: ['speakers', 'slides', 'narration'],
      required: true,
    },
    done: { type: Number, required: true },
    total: { type: Number, required: true },
    index: Number,
    title: String,
  },
  { _id: false },
)

const refineJobSchema = new Schema<RefineJobDb>(
  {
    deckId: {
      type: Schema.Types.ObjectId,
      ref: 'Deck',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['running', 'done', 'error'],
      required: true,
      default: 'running',
    },
    summary: { type: summarySchema, default: undefined },
    progress: { type: progressSchema, default: undefined },
    error: String,
  },
  { timestamps: true },
)

refineJobSchema.plugin(softDeletePlugin)

export const RefineJobModel = model<RefineJobDb>('RefineJob', refineJobSchema)
