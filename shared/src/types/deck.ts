/**
 * Deck, slide, and slide-translation data models (SPEC §15).
 * Field sets are indicative — they will evolve as features land.
 */
import type { Locale } from './locale'
import type { LayoutType } from './template'

export type Visibility = 'private' | 'unlisted' | 'public'

export interface Deck {
  id: string
  projectId: string
  ownerId: string
  title: string
  templateId: string
  visibility: Visibility
  permalinkSlug: string
  slideOrder: string[]
  /** Finalized full lecture transcript, retained for post-lecture reformat (GEN-4). */
  transcript?: string
  voteScore: number
  createdAt: string
}

/** Where a slide's image came from, including AI-generated provenance (IMG-4). */
export type ImageSource = 'seeded' | 'stock' | 'generated'

export interface Slide {
  id: string
  deckId: string
  index: number
  /** Chosen by the AI from the template's layout descriptors (GEN-6). */
  layoutType: LayoutType
  title?: string
  body?: string
  bullets?: string[]
  imageRef?: string
  imageSource?: ImageSource
  /** AI-recommended image search terms (GEN-7). */
  imageKeywords?: string[]
  caption?: string
  sourceTranscript?: string
  attribution?: string
}

/** Cached on-demand translation of a deck's slide content (SHARE-2). */
export interface SlideTranslation {
  id: string
  deckId: string
  locale: Locale
  perSlide: Record<
    string,
    {
      title?: string
      body?: string
      bullets?: string[]
      caption?: string
    }
  >
  createdAt: string
}
