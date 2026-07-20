/**
 * Deterministic mock TranscriptionProvider — lets the real-time STT transport
 * (WebSocket + capture) run end to end in tests/e2e without Google or real
 * audio. On the first audio chunk it emits a scripted interim then final
 * phrase, which flows through the same session.phrase pipeline as any engine.
 * Selected with TRANSCRIPTION_PROVIDER=mock.
 */
import type {
  TranscriptionEvent,
  TranscriptionProvider,
  TranscriptionStream,
} from '@slide-machine/shared'
import { registry } from './registry'
import { AsyncQueue } from './async-queue'

/** A short, command-free phrase the mock generator turns into a title slide. */
const SCRIPTED_PHRASE = 'Photosynthesis basics'

export class MockTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'mock'

  startStream(): TranscriptionStream {
    const events = new AsyncQueue<TranscriptionEvent>()
    let emitted = false
    return {
      write() {
        // Fire once, on the first real audio frame, so the phrase is
        // deterministic and needs no timers.
        if (emitted) return
        emitted = true
        events.push({ text: 'Photosynthesis', isFinal: false, confidence: 0 })
        // Static word timings (no clock) give the diarization-groundwork path
        // deterministic coverage through the WS relay and the session.phrase
        // segment write.
        events.push({
          text: SCRIPTED_PHRASE,
          isFinal: true,
          confidence: 1,
          words: [
            { word: 'Photosynthesis', startMs: 0, endMs: 800, confidence: 1 },
            { word: 'basics', startMs: 800, endMs: 1200, confidence: 1 },
          ],
        })
      },
      end() {
        events.close()
      },
      events,
    }
  }
}

registry.register(
  'transcription',
  'mock',
  () => new MockTranscriptionProvider(),
)
