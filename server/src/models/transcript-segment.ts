/**
 * TranscriptSegment model (GEN-4 diarization groundwork). One finalized
 * lecture phrase with its per-word timing and phrase→slide linkage, stored
 * append-only in its OWN collection — deliberately not embedded on the deck,
 * which `sessionPhrase` already rewrites per phrase and which would risk the
 * 16 MB document cap on long lectures. Nothing reads segments yet; they exist
 * so a later batch-diarization pass can time-join speaker tags onto them.
 */
import { Schema, model, Types, type HydratedDocument } from 'mongoose'
import type {
  TranscriptSegment,
  TranscriptSegmentAction,
  WordTiming,
} from '@slide-machine/shared'

export interface TranscriptSegmentDb
  extends Omit<TranscriptSegment, 'id' | 'deckId' | 'slideId' | 'createdAt'> {
  deckId: Types.ObjectId
  slideId?: Types.ObjectId
  createdAt: Date
}

/** Strict, id-less subdocument for a single word's timing. */
const wordSchema = new Schema<WordTiming>(
  {
    word: { type: String, required: true },
    startMs: { type: Number, required: true },
    endMs: { type: Number, required: true },
    confidence: { type: Number },
  },
  { _id: false },
)

const SEGMENT_ACTIONS: TranscriptSegmentAction[] = [
  'none',
  'update',
  'refit',
  'new',
]

const transcriptSegmentSchema = new Schema<TranscriptSegmentDb>(
  {
    deckId: { type: Schema.Types.ObjectId, ref: 'Deck', required: true },
    sessionId: String,
    startMs: Number,
    endMs: Number,
    text: { type: String, required: true },
    confidence: Number,
    words: { type: [wordSchema], default: undefined },
    action: {
      type: String,
      enum: SEGMENT_ACTIONS,
      required: true,
      default: 'none',
    },
    slideId: { type: Schema.Types.ObjectId, ref: 'Slide' },
  },
  // createdAt is the cross-session ordering key; segments are never updated.
  { timestamps: { createdAt: true, updatedAt: false } },
)

// Serves the Phase-3 time-join: segments of one recording, ordered by time.
transcriptSegmentSchema.index({ deckId: 1, sessionId: 1, startMs: 1 })

export const TranscriptSegmentModel = model<TranscriptSegmentDb>(
  'TranscriptSegment',
  transcriptSegmentSchema,
)

export const toTranscriptSegmentDto = (
  doc: HydratedDocument<TranscriptSegmentDb>,
): TranscriptSegment => ({
  id: doc._id.toString(),
  deckId: doc.deckId.toString(),
  sessionId: doc.sessionId,
  startMs: doc.startMs,
  endMs: doc.endMs,
  text: doc.text,
  confidence: doc.confidence,
  words: doc.words,
  action: doc.action,
  slideId: doc.slideId?.toString(),
  createdAt: doc.createdAt.toISOString(),
})
