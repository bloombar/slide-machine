/** Validates a narration-voice id against the shared voice catalog. */
import { z } from 'zod'
import { TTS_VOICES } from '@slide-machine/shared'

export const ttsVoiceIdSchema = z.enum(
  TTS_VOICES.map(v => v.id) as [string, ...string[]],
)
