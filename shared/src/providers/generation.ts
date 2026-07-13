/**
 * GenerationProvider — finalized speech + context in, slide content out
 * (SPEC GEN-1/GEN-6/GEN-7/GEN-8 / TECH-8). Gemini is the pilot adapter.
 * Interface is minimal and expected to evolve with the first adapter.
 */
import type { LayoutDescriptor, LayoutType } from '../types/template'
import type {
  VoiceCommand,
  VoiceCommandDescriptor,
} from '../types/voice-commands'

/** A seeded image the model may select for a slide (SEED-2 / GEN-7). */
export interface SeededImageDescriptor {
  id: string
  caption?: string
  keywords: string[]
}

export interface SlideGenerationRequest {
  /** The finalized spoken phrase driving this generation step. */
  phrase: string
  /** Short rolling context of recent phrases/slides for topic coherence. */
  rollingContext: string[]
  /** Seed context layers (typed notes, imported docs, honed concepts).
   * Deck-level notes are more specific and outrank project-level ones. */
  seedContext?: {
    project?: string
    deck?: string
  }
  /** The active template's layouts — the option set the model must pick from (GEN-6). */
  layoutDescriptors: LayoutDescriptor[]
  seededImages?: SeededImageDescriptor[]
  /** Content freedom 1-10: 1 = only what was said, 10 = free
   * elaboration. Servers resolve it from lecture → project → config. */
  freedom?: number
  /** Snapshot of the current (last) slide so the model can judge
   * whether an update still fits or a new slide is due (GEN-8). */
  currentSlide?: {
    layoutType: LayoutType
    bulletCount: number
    bodyChars: number
    /** The slide's exact slot content — present when layout re-fit is
     * allowed, so the model can re-map it rather than guess it from
     * the rolling context. */
    content?: {
      title?: string
      body?: string
      bullets?: string[]
      caption?: string
    }
  }
  /** GENERATION_LAYOUT_REFIT feature flag: the model may switch an
   * updated slide's layout — including a full re-map of existing
   * content via updateMode 'refit' (GEN-8 "re-fit the layout"). */
  allowLayoutRefit?: boolean
  /** The fixed CAP-4 command set the model may recognize as the intent
   * of a phrase. Present only when the server's GENERATION_VOICE_COMMANDS
   * feature flag is on; absent = command detection disabled. */
  voiceCommands?: VoiceCommandDescriptor[]
}

/** The model's per-slide image recommendation (GEN-7). */
export interface ImageGuidance {
  keywords: string[]
  /** Set when the model selects a specific seeded image. */
  seededImageId?: string
  /** True when the model recommends generating an image instead (IMG-4). */
  generate?: boolean
  /** True when the slide warrants no image. */
  none?: boolean
}

export interface SlideGenerationResult {
  /** Whether the phrase starts a new slide, updates the current one,
   * changes nothing (GEN-8) — or, when voice commands were offered, is
   * an operational command addressed to the slide system. */
  action: 'new' | 'update' | 'none' | 'command'
  layoutType: LayoutType
  /** Content mapped to the chosen layout's slots. */
  slots: {
    title?: string
    body?: string
    bullets?: string[]
    caption?: string
  }
  imageGuidance?: ImageGuidance
  /** Update semantics (allowLayoutRefit only): 'delta' (the default)
   * means slots hold ONLY the added material; 'refit' means slots hold
   * the COMPLETE slide re-mapped to the chosen layout. */
  updateMode?: 'delta' | 'refit'
  /** Set when action is 'command': the recognized command id. */
  command?: VoiceCommand
}

export interface GenerationProvider {
  readonly name: string
  generateSlideContent(
    request: SlideGenerationRequest,
  ): Promise<SlideGenerationResult>
}
