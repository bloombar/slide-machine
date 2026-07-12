/**
 * Project, seeding, and preflight-concept data models (SPEC §15, §6).
 * Field sets are indicative — they will evolve as features land.
 */
import type { ProjectDefaults } from './user'
import type { Visibility } from './deck'

export interface Project {
  id: string
  ownerId: string
  title: string
  course?: string
  description?: string
  seedContext?: string
  /** General access; lectures inherit this unless they override (SHARE-1). */
  visibility: Visibility
  /** Default template applied to new lectures at creation (TMPL-2);
   * each lecture stores its own template and can switch any time. */
  templateId: string
  /** AI content freedom (1-10) for lectures in this project; absent =
   * the server default. Lectures inherit unless they set their own. */
  generationFreedom?: number
  /** The value in effect (own or the server default) — what inheriting
   * lectures actually use; for display. */
  effectiveGenerationFreedom: number
  /** User ids with view access. Owner-only surfaces. */
  viewers?: string[]
  /** User ids with edit access (can edit every lecture inside). Owner-only surfaces. */
  editors?: string[]
  /** Overrides the owner's projectDefaults (GEN-8/GEN-9). */
  settings?: ProjectDefaults
  createdAt: string
}

export type SeedAssetType =
  'doc' | 'pdf' | 'gdoc' | 'gdrive' | 'gslides' | 'image'

/** Upload → background extraction lifecycle. */
export type SeedAssetStatus = 'processing' | 'ready' | 'failed'

/** Imported seed content used as context for slide generation (SEED-1/SEED-2). */
export interface SeedAsset {
  id: string
  projectId: string
  /** Present for lecture-level assets; absent for project-level ones. */
  deckId?: string
  type: SeedAssetType
  /** Original file name, shown in the asset list. */
  name: string
  status: SeedAssetStatus
  text?: string
  imageUrl?: string
  caption?: string
  keywords: string[]
  enabled: boolean
  createdAt: string
}

/** A preflight concept the instructor has honed before lecturing (PREP-1/2/3). */
export interface Concept {
  id: string
  projectId: string
  label: string
  canonical: string
  synonyms: string[]
  gloss?: string
  /** Resolved entity id, e.g. a Wikidata QID, for image disambiguation (IMG-3). */
  entityId?: string
  preferredImageRef?: string
  importance: 'must' | 'maybe'
  source?: string
  confirmed: boolean
}
