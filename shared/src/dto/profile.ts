/**
 * Public profile DTOs (SHARE-1 / AUTH-5): what GET /api/users/:id
 * returns. Only fields safe for strangers — never email or billing.
 */
import type { Deck } from '../types/deck'

/** The public subset of a user. */
export interface PublicUser {
  id: string
  displayName: string
  bio?: string
  avatarUrl?: string
  createdAt: string
}

/** The public subset of a project (no seed notes, no settings). */
export interface PublicProject {
  id: string
  title: string
  course?: string
  description?: string
}

/** A profile page: the user plus their lectures the viewer can see,
 * grouped by project. Projects with nothing visible are omitted. */
export interface ProfileResponse {
  user: PublicUser
  projects: Array<{ project: PublicProject; decks: Deck[] }>
}
