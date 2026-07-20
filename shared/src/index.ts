/**
 * @slide-machine/shared — single source of truth for data-model types,
 * API DTOs, and AI-provider interfaces shared by client and server
 * (SPEC TECH-6). Exported as TypeScript source; consumers transpile it.
 */
export * from './types/locale'
export * from './types/plans'
export * from './types/user'
export * from './types/project'
export * from './types/template'
export * from './types/voice-commands'
export * from './types/deck'
export * from './types/tts-voices'
export * from './types/quiz'
export * from './types/social'
export * from './dto/health'
export * from './dto/config'
export * from './dto/auth'
export * from './dto/profile'
export * from './dto/actions'
export * from './dto/generation'
export * from './dto/images'
export * from './providers/capability'
export * from './providers/transcription'
export * from './providers/diarization'
export * from './providers/generation'
export * from './providers/quiz-generation'
export * from './providers/image-generation'
export * from './providers/tts'
