/**
 * The fixed voice-command vocabulary (CAP-4), shared so the client's
 * wake-word matcher and the AI command-intent path agree on command
 * ids. The descriptors are the AI-facing option set: when the server's
 * GENERATION_VOICE_COMMANDS flag is on, they ride along with each
 * generation request so the model can flag a phrase as a command
 * instead of lecture content.
 */

export const VOICE_COMMANDS = ['next', 'previous', 'pause', 'newSlide'] as const

export type VoiceCommand = (typeof VOICE_COMMANDS)[number]

/** One command as offered to the generation model. */
export interface VoiceCommandDescriptor {
  id: VoiceCommand
  /** What the command does, phrased for the model. */
  description: string
}

export const VOICE_COMMAND_DESCRIPTORS: VoiceCommandDescriptor[] = [
  { id: 'next', description: 'Advance to the next slide' },
  { id: 'previous', description: 'Go back to the previous slide' },
  { id: 'pause', description: 'Pause the session and stop listening' },
  { id: 'newSlide', description: 'Append a new blank slide' },
]

/** Type guard for command ids arriving from the model or the wire. */
export const isVoiceCommand = (value: unknown): value is VoiceCommand =>
  typeof value === 'string' &&
  (VOICE_COMMANDS as readonly string[]).includes(value)
