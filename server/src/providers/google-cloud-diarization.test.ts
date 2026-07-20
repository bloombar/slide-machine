/**
 * Unit tests for the Google Cloud batch diarizer's pure parsing
 * (wordsToSpeakerSegments) and its no-op guard when GCS is unconfigured. The
 * live BatchRecognize/GCS round-trip is validated separately on a real run.
 */
import { describe, it, expect } from 'vitest'
import {
  wordsToSpeakerSegments,
  GoogleCloudDiarizationProvider,
} from './google-cloud-diarization'

/** A protobuf Duration for `seconds` seconds. */
const dur = (seconds: number) => ({
  seconds: Math.floor(seconds),
  nanos: Math.round((seconds - Math.floor(seconds)) * 1e9),
})

describe('wordsToSpeakerSegments', () => {
  it('collapses consecutive same-speaker words into intervals', () => {
    const words = [
      { speakerLabel: '1', startOffset: dur(0), endOffset: dur(1) },
      { speakerLabel: '1', startOffset: dur(1), endOffset: dur(2) },
      { speakerLabel: '2', startOffset: dur(2), endOffset: dur(3) },
      { speakerLabel: '1', startOffset: dur(3), endOffset: dur(4) },
    ]
    expect(wordsToSpeakerSegments(words)).toEqual([
      { speaker: 1, startMs: 0, endMs: 2000 },
      { speaker: 2, startMs: 2000, endMs: 3000 },
      { speaker: 1, startMs: 3000, endMs: 4000 },
    ])
  })

  it('numbers non-numeric speaker labels in first-seen order', () => {
    const words = [
      { speakerLabel: 'speaker_A', startOffset: dur(0), endOffset: dur(1) },
      { speakerLabel: 'speaker_B', startOffset: dur(1), endOffset: dur(2) },
      { speakerLabel: 'speaker_A', startOffset: dur(2), endOffset: dur(3) },
    ]
    expect(wordsToSpeakerSegments(words).map(s => s.speaker)).toEqual([1, 2, 1])
  })

  it('sorts words by start time before grouping', () => {
    const words = [
      { speakerLabel: '1', startOffset: dur(2), endOffset: dur(3) },
      { speakerLabel: '1', startOffset: dur(0), endOffset: dur(1) },
    ]
    expect(wordsToSpeakerSegments(words)).toEqual([
      { speaker: 1, startMs: 0, endMs: 3000 },
    ])
  })

  it('returns nothing for no words', () => {
    expect(wordsToSpeakerSegments([])).toEqual([])
  })
})

describe('GoogleCloudDiarizationProvider.diarize', () => {
  it('is a no-op (returns []) when GCS_AUDIO_BUCKET is unconfigured', async () => {
    // The test env sets no GCS bucket, so diarize bails before any Google call.
    const provider = new GoogleCloudDiarizationProvider()
    expect(
      await provider.diarize({ audioKey: 'audio/x.wav', sampleRate: 16_000 }),
    ).toEqual([])
  })
})
