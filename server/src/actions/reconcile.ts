/**
 * Post-lecture reconciliation (GEN-4 Phase 3): `deck.diarize` runs speaker
 * diarization on a deck's retained recordings and tags its transcript segments
 * with a speaker and a lecturer/student role. Per recording session: diarize
 * the audio → time-join the speaker intervals onto that session's segments →
 * map speakers to roles by talk-time → persist speaker + role on each segment.
 *
 * Diarizer tags are session-scoped, so each recording is processed on its own.
 * A no-op when the deck has no recordings or the diarizer returns nothing
 * (e.g. DIARIZATION_PROVIDER=none), leaving segments untagged. Phase 4 consumes
 * the roles to regenerate student/mixed slides.
 */
import { z } from 'zod'
import type {
  DeckDiarizeInput,
  DeckDiarizeResult,
  DiarizationProvider,
} from '@slide-machine/shared'
import { defineAction } from './define'
import { registerAction } from './dispatch'
import { loadEditableDeck } from './deck'
import { registry } from '../providers/registry'
import { TranscriptSegmentModel } from '../models/transcript-segment'
import { assignSpeakers } from '../lib/diarization-join'
import { mapSpeakerRoles } from '../lib/speaker-roles'

export const deckDiarize = defineAction<DeckDiarizeInput, DeckDiarizeResult>({
  name: 'deck.diarize',
  input: z.object({ deckId: z.string().min(1) }),
  execute: async (ctx, input) => {
    const { deck } = await loadEditableDeck(ctx, input.deckId)
    const recordings = deck.recordings ?? []
    if (!recordings.length) return { sessionsProcessed: 0, segmentsTagged: 0 }

    const provider = registry.get<DiarizationProvider>('diarization')
    const segments = await TranscriptSegmentModel.find({ deckId: deck._id })

    let sessionsProcessed = 0
    let segmentsTagged = 0
    for (const rec of recordings) {
      const sessionSegments = segments.filter(s => s.sessionId === rec.sessionId)
      if (!sessionSegments.length) continue

      const diarized = await provider.diarize({
        audioKey: rec.audioKey,
        sampleRate: rec.sampleRate,
      })
      if (!diarized.length) continue
      sessionsProcessed++

      const roleBySpeaker = mapSpeakerRoles(diarized)
      const speakerBySegment = assignSpeakers(
        sessionSegments.map(s => ({
          id: s._id.toString(),
          startMs: s.startMs,
          endMs: s.endMs,
          words: s.words,
        })),
        diarized,
      )

      for (const seg of sessionSegments) {
        const speaker = speakerBySegment.get(seg._id.toString())
        if (speaker == null) continue
        await TranscriptSegmentModel.updateOne(
          { _id: seg._id },
          { speaker, role: roleBySpeaker.get(speaker) },
        )
        segmentsTagged++
      }
    }
    return { sessionsProcessed, segmentsTagged }
  },
})

registerAction(deckDiarize)
