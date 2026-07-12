/**
 * GenerationProvider — finalized speech + context in, slide content out
 * (SPEC GEN-1/GEN-6/GEN-7/GEN-8 / TECH-8). Gemini is the pilot adapter.
 * Interface is minimal and expected to evolve with the first adapter.
 */
import type { LayoutDescriptor, LayoutType } from '../types/template'

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
    bodyWords: number
  }
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
  /** Whether the phrase starts a new slide, updates the current one, or changes nothing (GEN-8). */
  action: 'new' | 'update' | 'none'
  layoutType: LayoutType
  /** Content mapped to the chosen layout's slots. */
  slots: {
    title?: string
    body?: string
    bullets?: string[]
    caption?: string
  }
  imageGuidance?: ImageGuidance
}

export interface GenerationProvider {
  readonly name: string
  generateSlideContent(
    request: SlideGenerationRequest,
  ): Promise<SlideGenerationResult>
}
