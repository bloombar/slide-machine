/**
 * Social actions (SPEC §11 / SOC-1, SOC-2, SOC-3). `deck.vote` casts, changes
 * or clears a user's vote on a lecture and keeps the denormalized
 * `deck.voteScore` in sync; `deck.feed` returns the global public-lecture feed
 * and `social.search` searches public content. Both lists share one shape: the
 * caller picks the sort ("latest" or "top") and pages through the results by
 * offset, so the same client component drives either. Templates are deferred
 * (built-in only), so today these cover decks.
 */
import { z } from 'zod'
import { Types, type HydratedDocument } from 'mongoose'
import {
  DISCOVER_PAGE_SIZE,
  type DeckFeedResponse,
  type DeckPage,
  type FeedDeck,
  type FeedSort,
  type MyVote,
  type SearchResults,
  type VoteResult,
} from '@slide-machine/shared'
import { defineAction } from './define'
import { registerAction, ActionForbiddenError } from './dispatch'
import type { ActionContext } from './context'
import { DeckModel, loadDeckAcl, type DeckDb } from '../models/deck'
import { ProjectModel } from '../models/project'
import { SlideModel } from '../models/slide'
import { UserModel } from '../models/user'
import { VoteModel, voteBreakdown, voteBreakdowns } from '../models/vote'
import { canViewAcl } from '../lib/access'

/** Shared paging input for every browsable list (SOC-2): which order, and which
 * slice of it. `limit` is capped so one request cannot ask for everything. */
const pagingInput = {
  sort: z.enum(['latest', 'top']).default('latest'),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(50).default(DISCOVER_PAGE_SIZE),
}

const requireUser = (ctx: ActionContext): string => {
  if (!ctx.userId) throw new ActionForbiddenError('Sign in to continue')
  return ctx.userId
}

/**
 * Up/down-vote a lecture, or clear the vote with 0 (SOC-1). One vote per user
 * per deck; the caller must be able to view the deck. Updating the score does
 * not bump `updatedAt`, so voting never reorders the "latest" feed.
 */
export const deckVote = defineAction<
  { deckId: string; value: 1 | -1 | 0 },
  VoteResult
>({
  name: 'deck.vote',
  input: z.object({
    deckId: z.string().min(1),
    value: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
  }),
  execute: async (ctx, input) => {
    const userId = requireUser(ctx)
    const deck = await DeckModel.findById(input.deckId).catch(() => null)
    if (!deck) throw new ActionForbiddenError()
    const acl = await loadDeckAcl(deck)
    if (!canViewAcl(acl, userId)) throw new ActionForbiddenError()

    const key = {
      userId: new Types.ObjectId(userId),
      targetType: 'deck' as const,
      targetId: deck._id,
    }
    if (input.value === 0) {
      await VoteModel.deleteOne(key)
    } else {
      await VoteModel.updateOne(
        key,
        { $set: { value: input.value } },
        { upsert: true },
      )
    }
    const { up, down, voteScore } = await voteBreakdown('deck', deck._id)
    await DeckModel.updateOne(
      { _id: deck._id },
      { voteScore },
      { timestamps: false },
    )
    return { up, down, voteScore, myVote: input.value }
  },
})

/**
 * The filter for lectures anyone may browse (SOC-2/SOC-3): the caller's own are
 * excluded (both the feed and search show *others'* work), and a lecture counts
 * as public when it overrides to public or, with no override, sits in a public
 * project. Soft-deleted rows are dropped by the model's query middleware.
 */
const publicDeckFilter = (
  userId: string,
  publicProjectIds: Types.ObjectId[],
) => ({
  ownerId: { $ne: new Types.ObjectId(userId) },
  $or: [
    { 'accessOverride.visibility': 'public' as const },
    {
      accessOverride: { $exists: false },
      projectId: { $in: publicProjectIds },
    },
  ],
})

/**
 * The Mongo sort for a list order (SOC-2). "top" ranks by net vote score;
 * "latest" by recency. Both fall through to `_id` so paging is deterministic
 * when two rows tie — without it the same lecture can appear on two pages.
 */
const sortSpecFor = (sort: FeedSort): Record<string, 1 | -1> =>
  sort === 'top'
    ? { voteScore: -1, updatedAt: -1, _id: -1 }
    : { updatedAt: -1, _id: -1 }

/** The ids of every public project, used to resolve inherited deck visibility. */
const publicProjectIds = async (): Promise<Types.ObjectId[]> => {
  const rows = await ProjectModel.find({ visibility: 'public' }).select('_id')
  return rows.map(p => p._id)
}

/**
 * Turns deck documents into feed rows, resolving owner names, project titles,
 * vote tallies and the caller's own vote in one batch each. Shared by the feed
 * and by search so both lists render identically.
 */
const toFeedDecks = async (
  docs: HydratedDocument<DeckDb>[],
  userId: string,
): Promise<FeedDeck[]> => {
  if (docs.length === 0) return []
  const ownerIds = [...new Set(docs.map(d => d.ownerId.toString()))]
  const projectIds = [...new Set(docs.map(d => d.projectId.toString()))]
  const deckIds = docs.map(d => d._id)
  const [owners, projects, myVotes, breakdowns] = await Promise.all([
    UserModel.find({ _id: { $in: ownerIds } }).select('displayName'),
    ProjectModel.find({ _id: { $in: projectIds } }).select('title'),
    VoteModel.find({
      userId: new Types.ObjectId(userId),
      targetType: 'deck',
      targetId: { $in: deckIds },
    }),
    voteBreakdowns('deck', deckIds),
  ])
  const ownerById = new Map(owners.map(u => [u._id.toString(), u.displayName]))
  const projectById = new Map(projects.map(p => [p._id.toString(), p.title]))
  const myVoteById = new Map(
    myVotes.map(v => [v.targetId.toString(), v.value as MyVote]),
  )

  return docs.map(d => {
    const counts = breakdowns.get(d._id.toString()) ?? { up: 0, down: 0 }
    return {
      id: d._id.toString(),
      slug: d.permalinkSlug,
      title: d.title,
      up: counts.up,
      down: counts.down,
      voteScore: d.voteScore,
      myVote: myVoteById.get(d._id.toString()) ?? 0,
      updatedAt: (d.updatedAt ?? d.createdAt).toISOString(),
      owner: {
        id: d.ownerId.toString(),
        displayName: ownerById.get(d.ownerId.toString()) ?? '',
      },
      project: {
        id: d.projectId.toString(),
        title: projectById.get(d.projectId.toString()) ?? '',
      },
    }
  })
}

/**
 * Runs one page of a lecture query: sorts it, over-fetches by a single row to
 * learn whether another page exists, then hydrates the rows it keeps.
 */
const pageOfDecks = async (
  filter: Record<string, unknown>,
  { sort, offset, limit }: { sort: FeedSort; offset: number; limit: number },
  userId: string,
): Promise<DeckPage> => {
  const docs = await DeckModel.find(filter)
    .sort(sortSpecFor(sort))
    .skip(offset)
    .limit(limit + 1)
  const hasMore = docs.length > limit
  return { items: await toFeedDecks(docs.slice(0, limit), userId), hasMore }
}

/**
 * The public lecture feed (SOC-3): every public lecture the caller does not
 * own, newest-first ("latest") or by net score ("top"), one page at a time.
 */
export const deckFeed = defineAction<
  { sort: FeedSort; offset: number; limit: number },
  DeckFeedResponse
>({
  name: 'deck.feed',
  input: z.object(pagingInput),
  execute: async (ctx, input) => {
    const userId = requireUser(ctx)
    const filter = publicDeckFilter(userId, await publicProjectIds())
    return pageOfDecks(filter, input, userId)
  },
})

/** Escapes a user query so it matches literally inside a case-insensitive
 * regex (a search for "c++" must not be read as regex syntax). */
const escapeRegex = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** How many projects and people one search returns; lectures page instead. */
const GROUP_LIMIT = 10

/**
 * The most candidate lectures any one lookup contributes. Every id list below
 * feeds an `$in`, so without a ceiling a broad query could build an unbounded
 * array and hand it back to Mongo. The cap is far above what a page shows; a
 * query broad enough to hit it is one nobody is reading to the end anyway.
 */
const CANDIDATE_CAP = 500

const uniqueIds = (ids: Types.ObjectId[]): Types.ObjectId[] => [
  ...new Map(ids.map(id => [id.toString(), id])).values(),
]

/**
 * Candidate lectures for a query: whichever match by their own text (title,
 * transcript) or by the text on their slides.
 *
 * The text indexes answer first, because `$text` is an indexed lookup and a
 * case-insensitive regex cannot use an index at all — scanning every deck and
 * every slide per keystroke is what stops working as the corpus grows. But
 * `$text` only matches whole words, so a half-typed one finds nothing; that
 * case, and only that case, falls back to a capped substring scan.
 */
const deckCandidates = async (
  q: string,
  rx: RegExp,
): Promise<Types.ObjectId[]> => {
  const [decks, slides] = await Promise.all([
    DeckModel.find({ $text: { $search: q } })
      .select('_id')
      .limit(CANDIDATE_CAP),
    SlideModel.find({ $text: { $search: q } })
      .select('deckId')
      .limit(CANDIDATE_CAP),
  ])
  const indexed = uniqueIds([
    ...decks.map(d => d._id),
    ...slides.map(s => s.deckId),
  ])
  if (indexed.length > 0) return indexed

  const [byDeck, bySlide] = await Promise.all([
    DeckModel.find({ $or: [{ title: rx }, { transcript: rx }] })
      .select('_id')
      .limit(CANDIDATE_CAP),
    SlideModel.find({
      $or: [{ title: rx }, { body: rx }, { bullets: rx }, { caption: rx }],
    })
      .select('deckId')
      .limit(CANDIDATE_CAP),
  ])
  return uniqueIds([...byDeck.map(d => d._id), ...bySlide.map(s => s.deckId)])
}

/**
 * People whose display name matches (SOC-2): the text index first, then the
 * same capped substring fallback for a partly-typed name. Resolved separately
 * from the lectures — a query can match a person's name and no lecture text,
 * or the reverse, so one dimension falling back must not depend on the other.
 */
const authorCandidates = async (
  q: string,
  rx: RegExp,
): Promise<Types.ObjectId[]> => {
  const indexed = await UserModel.find({ $text: { $search: q } })
    .select('_id')
    .limit(CANDIDATE_CAP)
  if (indexed.length > 0) return indexed.map(u => u._id)
  const bySubstring = await UserModel.find({ displayName: rx })
    .select('_id')
    .limit(CANDIDATE_CAP)
  return bySubstring.map(u => u._id)
}

/**
 * Global search across public content (SOC-2). Lectures match on **title**,
 * **author** (the owner's display name) and **content** (the spoken transcript
 * and the text on their slides); the caller's chosen sort orders the matches
 * and they page like the feed does. Projects and people are returned alongside
 * as small groups — people because profiles are public and a name is how you
 * find someone's work. Tags are the one SOC-2 field left out: lectures carry
 * none, and no requirement defines them yet.
 *
 * Only public lectures and public projects are returned; soft-deleted rows are
 * excluded by the model's query middleware.
 */
export const socialSearch = defineAction<
  { q: string; sort: FeedSort; offset: number; limit: number },
  SearchResults
>({
  name: 'social.search',
  input: z.object({
    q: z.string().trim().min(1).max(100),
    ...pagingInput,
  }),
  execute: async (ctx, input) => {
    const userId = requireUser(ctx)
    const rx = new RegExp(escapeRegex(input.q), 'i')

    const publicProjects = await ProjectModel.find({
      visibility: 'public',
    }).select('_id title ownerId')
    const projectIds = publicProjects.map(p => p._id)

    const [deckIds, authorIds] = await Promise.all([
      deckCandidates(input.q, rx),
      authorCandidates(input.q, rx),
    ])

    const filter = {
      ...publicDeckFilter(userId, projectIds),
      // `publicDeckFilter` already owns `$or` (the visibility test), so the
      // match test goes alongside it under `$and` rather than replacing it.
      // Both clauses are id lookups, so this stage is indexed.
      $and: [
        {
          $or: [{ _id: { $in: deckIds } }, { ownerId: { $in: authorIds } }],
        },
      ],
    }
    const { items, hasMore } = await pageOfDecks(filter, input, userId)

    // Projects and people ride along with the first page only — they are short
    // fixed groups, and repeating them under every "load more" would be noise.
    if (input.offset > 0) {
      return { lectures: items, hasMore, projects: [], users: [] }
    }

    const projects = publicProjects
      .filter(p => rx.test(p.title ?? ''))
      .slice(0, GROUP_LIMIT)
    // People come from the same indexed lookup the lectures used, so a name is
    // matched once rather than searched for twice.
    const users = await UserModel.find({
      _id: { $in: authorIds.slice(0, GROUP_LIMIT) },
    }).select('displayName')
    const projectOwners = await UserModel.find({
      _id: { $in: projects.map(p => p.ownerId) },
    }).select('displayName')
    const ownerById = new Map(
      projectOwners.map(u => [u._id.toString(), u.displayName]),
    )

    return {
      lectures: items,
      hasMore,
      projects: projects.map(p => ({
        id: p._id.toString(),
        title: p.title ?? '',
        owner: {
          id: p.ownerId.toString(),
          displayName: ownerById.get(p.ownerId.toString()) ?? '',
        },
      })),
      users: users.map(u => ({
        id: u._id.toString(),
        displayName: u.displayName,
      })),
    }
  },
})

registerAction(deckVote)
registerAction(deckFeed)
registerAction(socialSearch)
