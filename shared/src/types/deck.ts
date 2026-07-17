/**
 * Deck, slide, and slide-translation data models (SPEC §15).
 * Field sets are indicative — they will evolve as features land.
 */
import type { Locale } from './locale'
import type { LayoutType } from './template'

/**
 * General access (Google-Docs style): 'restricted' means only the owner
 * and people with access can open the deck; 'public' means anyone on
 * the internet with the link can view.
 */
export type Visibility = 'restricted' | 'public'

/**
 * AI content freedom, 1-10 (GEN-1): 1 = slides contain only what the
 * speaker explicitly said; 10 = the AI may elaborate freely around it.
 * Stored per project/lecture only when explicitly set — lectures
 * inherit their project, projects inherit the server default.
 */
export const GENERATION_FREEDOM_MIN = 1
export const GENERATION_FREEDOM_MAX = 10

export interface Deck {
  id: string
  projectId: string
  ownerId: string
  title: string
  /** Always stored on the lecture; initialized from the project's
   * default template at creation (TMPL-2). */
  templateId: string
  /** EFFECTIVE general access: the lecture's own override when one
   * exists, otherwise inherited from its project. */
  visibility: Visibility
  /** True when this lecture has no privacy override and follows its
   * project's settings (the default). */
  accessInherited: boolean
  /** Effective user ids with view access. Owner-only surfaces. */
  viewers?: string[]
  /** Effective user ids with edit access. Owner-only surfaces. */
  editors?: string[]
  permalinkSlug: string
  slideOrder: string[]
  /** Lecture-level seed notes; stack on top of the project's (PROJ-1/SEED-1). */
  seedContext?: string
  /** Own AI-freedom setting (1-10); absent = inherit the project's. */
  generationFreedom?: number
  /** Lecturing/generation language, only when explicitly chosen; absent
   * = inherit (project, then owner profile, then browser default). */
  language?: Locale
  /** Finalized full lecture transcript, retained for post-lecture reformat (GEN-4). */
  transcript?: string
  voteScore: number
  createdAt: string
  /** Bumped whenever the deck or its slides change; drives recency ordering. */
  updatedAt: string
}

/** Where a slide's image came from, including AI-generated provenance (IMG-4). */
export type ImageSource = 'seeded' | 'stock' | 'generated'

/**
 * Image credit/licensing shown behind the on-slide "i" icon (IMG-5).
 * A simplified subset of TASL: where the image came from, who to credit,
 * and the license. Any field may be absent.
 */
export interface ImageAttribution {
  /** Where the image came from — a page URL, opened in a new tab. */
  sourceUrl?: string
  /** Who to credit (author/creator, often with the source name). */
  author?: string
  /** License name, e.g. "CC BY 4.0". */
  license?: string
}

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
  /** Image credit/licensing behind the "i" icon (IMG-5). */
  attribution?: ImageAttribution
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
