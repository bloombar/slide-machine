/**
 * Social-layer data models (SPEC §11, §15): voting (SOC-1), browse/search/sort
 * (SOC-2) and public feeds (SOC-3). Templates are deferred (built-in only), so
 * today these cover decks.
 */
export interface Vote {
  id: string
  userId: string
  targetType: 'deck' | 'template'
  targetId: string
  value: 1 | -1
}

/** The caller's own vote on an item: up (1), down (-1), or none (0). */
export type MyVote = 1 | -1 | 0

/** Vote tallies for an item: separate up/down counts and the net score. */
export interface VoteCounts {
  up: number
  down: number
  voteScore: number
}

/** Vote tallies plus the caller's own vote, returned after voting (SOC-1). */
export interface VoteResult extends VoteCounts {
  myVote: MyVote
}

/** Which way a browsable list is ordered (SOC-2/SOC-3): newest published first,
 * or highest net vote score first. Every browsable list accepts both, and the
 * choice applies to search results as well as to the unfiltered feed. */
export type FeedSort = 'latest' | 'top'

/** Rows per page of a browsable list (SOC-2). Lists are loaded a page at a time
 * as the reader scrolls rather than fetched whole. Kept small so the paging is
 * visible in the narrow home sidebar — a larger page would rarely run out. */
export const DISCOVER_PAGE_SIZE = 10

/** One lecture in a browsable list (SOC-2/SOC-3): enough to render the row and
 * link to the lecture, its project, and its owner. Carries up/down counts and
 * the net score so a list can show a rating without a second request. The same
 * shape backs both the feed and search results, so one row component renders
 * either. */
export interface FeedDeck {
  id: string
  slug: string
  title: string
  up: number
  down: number
  voteScore: number
  myVote: MyVote
  updatedAt: string
  owner: { id: string; displayName: string }
  project: { id: string; title: string }
}

/** One page of a browsable lecture list. `hasMore` says whether asking for the
 * next offset would return anything, so the UI knows when to stop loading. */
export interface DeckPage {
  items: FeedDeck[]
  hasMore: boolean
}

/** The public feed of lectures (SOC-3), already sorted server-side. */
export type DeckFeedResponse = DeckPage

/** A project match in a search (SOC-2): links to its read-only project page. */
export interface SearchProject {
  id: string
  title: string
  owner: { id: string; displayName: string }
}

/** A person match in a search (SOC-2): links to their public profile. */
export interface SearchUser {
  id: string
  displayName: string
}

/**
 * Global search results across public lectures, projects, and people (SOC-2).
 * Lectures are the paged list: they honour the caller's sort and `hasMore`
 * drives lazy loading. Projects and people are small fixed groups, returned
 * only with the first page so later pages repeat neither.
 */
export interface SearchResults {
  lectures: FeedDeck[]
  hasMore: boolean
  projects: SearchProject[]
  users: SearchUser[]
}
