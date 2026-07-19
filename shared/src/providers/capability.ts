/**
 * AI capabilities that go through the provider abstraction (SPEC GEN-2/TECH-8).
 * Each capability has its own interface; the active adapter per capability
 * is resolved from server configuration.
 */
export const CAPABILITIES = [
  'transcription',
  'generation',
  'quizGeneration',
  'imageGeneration',
  'tts',
] as const

export type Capability = (typeof CAPABILITIES)[number]
