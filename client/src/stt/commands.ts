/**
 * Voice commands (CAP-4): a small fixed vocabulary behind a wake word,
 * so ordinary lecture speech is never misinterpreted — "slide machine,
 * next slide" navigates; "next slide" alone is lecture content and
 * flows to generation. Matching is whole-phrase against synonyms after
 * normalization.
 *
 * SPEC's start/resume-by-voice needs an always-listening command mode
 * and arrives with the Cloud STT path; pause works today (it stops the
 * mic, so resuming *listening* is a click). Note `resume` is a different
 * axis: it resumes content generation after the whiteboard pause (GEN-10)
 * while the mic keeps running, so it needs no always-listening mode.
 *
 * The command ids live in shared: the server's AI command-intent path
 * (GENERATION_VOICE_COMMANDS) returns the same ids, so both routes run
 * through the same executor.
 */
import type { VoiceCommand } from '@slide-machine/shared'

export type { VoiceCommand }

export const WAKE_WORD = 'slide machine'

/** Synonyms per command (SPEC: small, configurable vocabulary). */
const VOCABULARY: Record<VoiceCommand, string[]> = {
  next: ['next slide', 'next', 'forward', 'fast forward'],
  previous: ['previous slide', 'previous', 'back', 'go back', 'rewind'],
  pause: ['pause', 'stop', 'stop listening'],
  resume: ['resume', 'resume generation', 'continue', 'keep going', 'carry on'],
  newSlide: ['new slide', 'add slide', 'add a slide', 'blank slide'],
  newWhiteboardSlide: [
    'new whiteboard',
    'new whiteboard slide',
    'whiteboard',
    'new chalkboard',
    'chalkboard',
    'blank whiteboard',
  ],
}

/** Human label for on-screen feedback. */
export const COMMAND_LABELS: Record<VoiceCommand, string> = {
  next: 'Next slide',
  previous: 'Previous slide',
  pause: 'Paused listening',
  resume: 'Content generation resumed',
  newSlide: 'New slide',
  newWhiteboardSlide: 'New whiteboard',
}

const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Matches a finalized phrase against the command vocabulary. Returns
 * null unless the phrase starts with the wake word AND the remainder
 * is exactly a known command.
 */
export const matchVoiceCommand = (phrase: string): VoiceCommand | null => {
  const normalized = normalize(phrase)
  if (!normalized.startsWith(WAKE_WORD)) return null
  const rest = normalized.slice(WAKE_WORD.length).trim()
  for (const [command, synonyms] of Object.entries(VOCABULARY) as Array<
    [VoiceCommand, string[]]
  >) {
    if (synonyms.includes(rest)) return command
  }
  return null
}
