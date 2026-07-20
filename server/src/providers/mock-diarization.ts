/**
 * Deterministic mock DiarizationProvider (GEN-4 Phase 3) + an explicit "none"
 * adapter. The mock returns a scripted two-speaker layout — a dominant lecturer
 * plus a brief student window — so the diarization pipeline (time-join, role
 * mapping, persistence) runs end to end in tests without Google or real audio.
 * Selected with DIARIZATION_PROVIDER=mock.
 */
import type {
  DiarizationProvider,
  DiarizedSpeakerSegment,
} from '@slide-machine/shared'
import { registry } from './registry'

/** Speaker 1 owns the first 10 minutes (the lecturer); speaker 2 a 20-second
 * window after it (a student question). Segments join by time to one or the
 * other; talk-time makes speaker 1 the lecturer. */
const SCRIPTED: DiarizedSpeakerSegment[] = [
  { speaker: 1, startMs: 0, endMs: 600_000 },
  { speaker: 2, startMs: 600_000, endMs: 620_000 },
]

export class MockDiarizationProvider implements DiarizationProvider {
  readonly name = 'mock'
  async diarize(): Promise<DiarizedSpeakerSegment[]> {
    return SCRIPTED
  }
}

/** Diarization explicitly disabled: returns nothing, so segments stay untagged
 * and the reconciliation pass is a no-op. The default engine. */
export class NoneDiarizationProvider implements DiarizationProvider {
  readonly name = 'none'
  async diarize(): Promise<DiarizedSpeakerSegment[]> {
    return []
  }
}

registry.register('diarization', 'mock', () => new MockDiarizationProvider())
registry.register('diarization', 'none', () => new NoneDiarizationProvider())
