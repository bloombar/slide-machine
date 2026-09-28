/**
 * Social actions (SPEC §11 / SOC-1, SOC-2, SOC-3), for both lectures and
 * style templates (TMPL-27, TMPL-28).
 *
 * `deck.vote`/`template.vote` cast, change or clear a user's vote on a
 * lecture or design and keep the denormalized `voteScore` in sync (a
 * built-in template has no document of its own to denormalize onto, so its
 * score is tallied live instead — see `decorateTemplates`). `deck.feed` and
 * `template.feed` return the global public feed for their own kind of
 * content, and `social.search`/`template.search` search it. Every list shares
 * one shape: the caller picks the sort and pages through by offset, so the
 * same client component (`useDiscover`) can drive any of them.
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
  type Template,
  type TemplateFeedSort,
  type TemplatePage,
  type VoteResult,
} from '@slide-machine/shared'
import { defineAction } from './define'
import {
  custom,
  deckViewer,
  signedIn,
  templateReadable,
  type DeckAccess,
  type Signed,
  type TemplateAccess,
} from './access'

/** Voting is a reader's act, so anyone who may see the lecture may vote. */
const viewerOf = deckViewer((input: { deckId: string }) => input.deckId)
/** Same rule for a design (TMPL-27): anyone who may read it may vote on it. */
const templateReadableOf = templateReadable(
  (input: { templateId: string }) => input.templateId,
)
import { registerAction, ActionForbiddenError } from './dispatch'
import type { ActionContext } from './context'
import { DeckModel, type DeckDb } from '../models/deck'
import { ProjectModel } from '../models/project'
import { SlideModel } from '../models/slide'
import { UserModel } from '../models/user'
import { VoteModel, voteBreakdown, voteBreakdowns } from '../models/vote'
import { TemplateModel, toTemplateDto } from '../models/template'
import { decorateTemplates } from '../templates/resolve'
import { listBuiltinTemplates } from '../templates/builtin'

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
  VoteResult,
  DeckAccess
>({
  name: 'deck.vote',
  access: viewerOf,
  input: z.object({
    deckId: z.string().min(1),
    value: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
  }),
  execute: async (ctx, input, { userId, deck }) => {
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
 * Up/down-vote a template, or clear the vote with 0 (TMPL-27). One vote per
 * user per design; the caller must be able to read it — owners may vote too,
 * as on a lecture, and it is the client's job to show a tally instead of the
 * buttons to one.
 *
 * Built-ins are voteable (TMPL-27) despite being files with no document of
 * their own: the vote itself keys on the built-in's slug rather than a
 * document id (`VoteDb.targetId` is widened to allow either — models/vote.ts),
 * and there is no `voteScore` field to denormalize onto, so nothing is
 * written back beyond the vote row itself. `decorateTemplates` is what tallies
 * a built-in's score from `VoteModel` wherever one is listed.
 */
export const templateVote = defineAction<
  { templateId: string; value: 1 | -1 | 0 },
  VoteResult,
  TemplateAccess
>({
  name: 'template.vote',
  access: templateReadableOf,
  input: z.object({
    templateId: z.string().min(1),
    value: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
  }),
  execute: async (ctx, input, { userId, template, doc }) => {
    // A stored template votes by document id, same as a deck; a built-in has
    // none, so it votes by its slug instead (`template.id`).
    const targetId: Types.ObjectId | string = doc ? doc._id : template.id
    const key = {
      userId: new Types.ObjectId(userId),
      targetType: 'template' as const,
      targetId,
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
    const { up, down, voteScore } = await voteBreakdown('template', targetId)
    if (doc) {
      await TemplateModel.updateOne(
        { _id: doc._id },
        { voteScore },
        { timestamps: false },
      )
    }
    return { up, down, voteScore, myVote: input.value }
  },
})

/**
 * The filter for lectures anyone may browse (SOC-2/SOC-3): the caller's own are
 * excluded (both the feed and search show *others'* work), and a lecture counts
 * as public when it overrides to public or, with no override, sits in a public
 * project. Soft-deleted rows are dropped by the model's query middleware. Decks
 * with no slides or no title are also excluded (SOC-2/SOC-3): a reader cannot
 * open or identify either, so neither belongs in a public listing.
 */
const publicDeckFilter = (
  userId: string,
  publicProjectIds: Types.ObjectId[],
) => ({
  ownerId: { $ne: new Types.ObjectId(userId) },
  // `slideOrder.0` matches only when a first element exists, i.e. the deck
  // has at least one slide (see lectures.ts / export-bundle.ts, which both
  // read deck.slideOrder.length as the slide count).
  'slideOrder.0': { $exists: true },
  // Title is `{ default: '', trim: true }` (models/deck.ts), so it may be
  // empty, whitespace-only pre-trim data, or absent on older rows. A regex
  // requiring a non-whitespace character excludes all three.
  title: { $regex: /\S/ },
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
  DeckFeedResponse,
  Signed
>({
  name: 'deck.feed',
  // Nothing is fetched to decide: publicDeckFilter matches only lectures
  // whose access already makes them public, and excludes the caller's own.
  access: custom(
    'the Mongo filter IS the authorization — publicDeckFilter reimplements deck ACL resolution at query level, so there is no single resource to resolve',
  ),
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
  SearchResults,
  Signed
>({
  name: 'social.search',
  // Nothing is fetched to decide: publicDeckFilter matches only lectures
  // whose access already makes them public, and excludes the caller's own.
  access: custom(
    'the Mongo filter IS the authorization — the same publicDeckFilter, applied to a search rather than a listing',
  ),
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

/**
 * The Mongo filter for public templates anyone signed in may browse
 * (TMPL-28): every one whose owner has listed it, **including the caller's
 * own** — unlike a lecture's feed, which excludes the caller's own work, a
 * template's browsable set is meant to include it (SPEC TMPL-28: "Latest ...
 * lists every public template"). Soft-deleted rows are dropped by the
 * model's query middleware. `visibility` is read directly rather than through
 * `legacyVisibility` (models/template.ts): the migration job backfills every
 * stored document to the two-value vocabulary, so a raw `'public'` match is
 * exact once it has run, and a document still mid-migration is restricted by
 * default anyway.
 */
const publicTemplateFilter = () => ({ visibility: 'public' as const })

/**
 * Owners whose display name matches a template search's query (TMPL-28): the
 * same capped substring match `authorCandidates` uses for a lecture search's
 * author dimension, so a design's creator is a third way in alongside its
 * name and its AI instructions. Built-ins have no owner and so are never
 * found this way — only by name or instructions.
 *
 * Narrowed to `TemplateModel`'s own distinct owners *before* the name match
 * (round 2), not a plain capped `displayName` lookup across every user: a
 * name-matching user who owns no template at all still counts against
 * `CANDIDATE_CAP`, and with enough of them ahead of a real creator in
 * whatever order Mongo returns, that creator's own templates go silently
 * unmatched — the cap is spent on candidates that were never going to
 * contribute an id to the `$in` this feeds.
 */
const templateOwnerCandidates = async (
  rx: RegExp,
): Promise<Types.ObjectId[]> => {
  const ownerIds = await TemplateModel.distinct('ownerId')
  const owners = await UserModel.find({
    _id: { $in: ownerIds },
    displayName: rx,
  })
    .select('_id')
    .limit(CANDIDATE_CAP)
  return owners.map(u => u._id)
}

/**
 * Templates the caller owns or has been shared (TMPL-28 "Mine"): any
 * visibility, since a design not yet public is still theirs to find. No
 * built-ins — nobody owns, edits or is a viewer of one (TMPL-26).
 */
const mineTemplateFilter = (userId: string) => ({
  $or: [
    { ownerId: new Types.ObjectId(userId) },
    { viewers: userId },
    { editors: userId },
  ],
})

/**
 * Combines a sort's scope filter (public, or "mine") with an optional search
 * match, `$and`-ed rather than spread together. Both are `$or` documents, and
 * `{ ...scope, ...match }` would have the *second* `$or` key silently
 * overwrite the first — the bug that let a "mine" search return someone
 * else's restricted template whenever its name happened to match, since the
 * ownership `$or` never ran at all. Used for every sort, even where the two
 * filters do not collide today, so the same mistake cannot resurface if one
 * of them grows a second top-level key later.
 */
const scopedTemplateFilter = (
  scope: Record<string, unknown>,
  match: Record<string, unknown> | undefined,
): Record<string, unknown> => (match ? { $and: [scope, match] } : scope)

/**
 * The Mongo sort for a page of stored templates (TMPL-27/TMPL-28), mirroring
 * `sortSpecFor` for decks. "mine" orders by recency like "latest" — an
 * owner's own library is browsed newest-first, not ranked.
 */
const templateSortSpecFor = (sort: TemplateFeedSort): Record<string, 1 | -1> =>
  sort === 'top'
    ? { voteScore: -1, updatedAt: -1, _id: -1 }
    : { updatedAt: -1, _id: -1 }

/**
 * Which built-ins match a query (TMPL-28). There are only a handful, so this
 * is a plain in-memory filter — no query, no vote lookup. "Top" is the only
 * sort that ranks by score, so it is the only one that pays for tallying one
 * (`rankedBuiltins` below); "latest" and "mine" (which never includes
 * built-ins) have no use for a score here, and `decorateTemplates` computes
 * the real one for whatever ends up on the page regardless of sort.
 */
const builtinTemplateCandidates = (rx: RegExp | undefined): Template[] =>
  listBuiltinTemplates().filter(
    t => !rx || rx.test(t.name) || rx.test(t.aiInstructions ?? ''),
  )

/** A template reduced to what ranking "top" needs: its score, its recency
 * (meaningless for a built-in, see below), and whether it is one. */
interface RankRow {
  id: string
  voteScore: number
  updatedAt: string
  builtin: boolean
}

/**
 * Orders two ranked rows the way Mongo's own `{ voteScore: -1, updatedAt: -1,
 * _id: -1 }` sort would for two stored templates — net score first, then
 * recency, then id, all descending, matching `templateSortSpecFor('top')` so
 * the in-memory merge below cannot silently disagree with the database sort
 * it is layered on top of.
 *
 * A built-in complicates only the middle term. It has no meaningful
 * `updatedAt` of its own (a fixed placeholder — see `templates/builtin.ts`),
 * so on a score tie it ranks *after* every stored template rather than being
 * compared against one by that placeholder date — comparing real dates only
 * between two stored rows keeps a coincidental placeholder match from
 * deciding an otherwise-tied order.
 */
const compareRanked = (a: RankRow, b: RankRow): number => {
  if (b.voteScore !== a.voteScore) return b.voteScore - a.voteScore
  if (a.builtin !== b.builtin) return a.builtin ? 1 : -1
  if (!a.builtin) {
    const byDate = Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    if (byDate !== 0) return byDate
  }
  // Descending, mirroring Mongo's own `_id: -1` tie-break; a built-in's slug
  // sorts by the same rule as a stored id once dates cannot decide it either.
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

/**
 * One page of the template feed or search (TMPL-27/TMPL-28), across all
 * three sorts. `rx`, when given, narrows to a query match; its absence is
 * the plain feed.
 *
 * "Mine" pages a plain Mongo query — no built-ins to merge, so it works
 * exactly like a lecture's own feed page. "Latest" and "top" differ because a
 * built-in has no stored document to page through:
 *
 *   - **Latest** appends built-ins after every stored template (SPEC TMPL-28:
 *     "Built-ins ... have no meaningful date") — a plain concatenation, so
 *     paging stays stable by tracking how many stored rows exist and only
 *     reaching into the built-in list once they run out.
 *   - **Top** ranks built-ins by their tallied score alongside stored ones, so
 *     a well-liked built-in can outrank a stored template — this needs an
 *     actual merge (see `rankedTop` below).
 */
const pageOfTemplates = async (
  sort: TemplateFeedSort,
  rx: RegExp | undefined,
  { offset, limit }: { offset: number; limit: number },
  userId: string,
): Promise<TemplatePage> => {
  // The creator match is a third `$or` arm (TMPL-28), not a second query — a
  // template whose name or instructions miss but whose owner's display name
  // hits is still a match, so all three sit in the one `$or` rather than
  // being combined with an `$and` that would require all three to agree.
  const queryMatch = rx
    ? {
        $or: [
          { name: rx },
          { aiInstructions: rx },
          { ownerId: { $in: await templateOwnerCandidates(rx) } },
        ],
      }
    : undefined

  if (sort === 'mine') {
    const filter = scopedTemplateFilter(mineTemplateFilter(userId), queryMatch)
    const docs = await TemplateModel.find(filter)
      .sort(templateSortSpecFor(sort))
      .skip(offset)
      .limit(limit + 1)
    const hasMore = docs.length > limit
    const items = docs.slice(0, limit).map(d => toTemplateDto(d, userId))
    return { items: await decorateTemplates(items, userId), hasMore }
  }

  const filter = scopedTemplateFilter(publicTemplateFilter(), queryMatch)
  const builtins = builtinTemplateCandidates(rx)

  if (sort === 'latest') {
    const storedCount = await TemplateModel.countDocuments(filter)
    const total = storedCount + builtins.length
    const hasMore = offset + limit < total
    let items: Template[]
    if (offset < storedCount) {
      const docs = await TemplateModel.find(filter)
        .sort(templateSortSpecFor(sort))
        .skip(offset)
        .limit(limit)
      items = docs.map(d => toTemplateDto(d, userId))
      const remaining = limit - items.length
      items =
        remaining > 0 ? [...items, ...builtins.slice(0, remaining)] : items
    } else {
      const builtinOffset = offset - storedCount
      items = builtins.slice(builtinOffset, builtinOffset + limit)
    }
    return { items: await decorateTemplates(items, userId), hasMore }
  }

  return rankedTopPage(filter, builtins, { offset, limit }, userId)
}

/**
 * "Top": ranks every matching stored template alongside every matching
 * built-in by net score, then assembles the page from just the ids that
 * belong on it (TMPL-27/TMPL-28).
 *
 * The rank itself reads only `_id voteScore updatedAt` — the three fields
 * `compareRanked` needs — never a whole document, and **with no cap**: a lean
 * three-field read of every matching template is cheap enough that ranking
 * the full set beats the alternative, a capped prefetch that can leave
 * `hasMore: true` pointing at a page that turns out empty once the cap is
 * hit. (It is not a covered read: `updatedAt`, the soft-delete condition and
 * any search regex all reach past the `{visibility, voteScore}` index.) Built-ins are
 * already fully in memory (a handful of files), so tallying their score here
 * is one batched vote lookup, not a query per built-in.
 *
 * Only the page's own rows are then hydrated to full documents, by a single
 * `_id: $in` lookup — the rank decided which ids belong on the page; nothing
 * else needs a full document.
 */
const rankedTopPage = async (
  filter: Record<string, unknown>,
  builtins: Template[],
  { offset, limit }: { offset: number; limit: number },
  userId: string,
): Promise<TemplatePage> => {
  const [storedRows, breakdowns] = await Promise.all([
    TemplateModel.find(filter).select('_id voteScore updatedAt').lean(),
    voteBreakdowns(
      'template',
      builtins.map(t => t.id),
    ),
  ])
  const ranked: RankRow[] = [
    ...storedRows.map(d => ({
      id: d._id.toString(),
      // A lean read skips schema defaults, so fall back as the deck feed does
      voteScore: d.voteScore ?? 0,
      updatedAt: (d.updatedAt ?? d.createdAt ?? new Date(0)).toISOString(),
      builtin: false,
    })),
    ...builtins.map(t => {
      const counts = breakdowns.get(t.id) ?? { up: 0, down: 0 }
      return {
        id: t.id,
        voteScore: counts.up - counts.down,
        updatedAt: t.updatedAt,
        builtin: true,
      }
    }),
  ].sort(compareRanked)

  const hasMore = offset + limit < ranked.length
  const page = ranked.slice(offset, offset + limit)

  const storedIds = page
    .filter(r => !r.builtin)
    .map(r => new Types.ObjectId(r.id))
  const storedDocs = storedIds.length
    ? // The scope filter again: a design deleted or restricted between the
      // rank and this read drops off the page rather than failing it or
      // leaking once.
      await TemplateModel.find({ $and: [filter, { _id: { $in: storedIds } }] })
    : []
  const storedById = new Map(storedDocs.map(d => [d._id.toString(), d]))
  const builtinById = new Map(builtins.map(t => [t.id, t]))
  // Rehydrated in the rank's own order, not `$in`'s return order (Mongo makes
  // no promise about it) and not the built-in file list's order either.
  const items = page.flatMap(row => {
    if (row.builtin) return [builtinById.get(row.id)!]
    const doc = storedById.get(row.id)
    return doc ? [toTemplateDto(doc, userId)] : []
  })
  return { items: await decorateTemplates(items, userId), hasMore }
}

/** Paging input shared by `template.feed` and `template.search`
 * (TMPL-27/TMPL-28) — the deck-list version plus "mine". */
const templatePagingInput = {
  sort: z.enum(['latest', 'top', 'mine']).default('latest'),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(50).default(DISCOVER_PAGE_SIZE),
}

/**
 * The public template feed (TMPL-27/TMPL-28): every public design, sorted by
 * recency, net score, or restricted to the caller's own library — one page
 * at a time. Shaped to fit `useDiscover`'s `DiscoverSource` alongside
 * `deck.feed`.
 */
export const templateFeed = defineAction<
  { sort: TemplateFeedSort; offset: number; limit: number },
  TemplatePage,
  Signed
>({
  name: 'template.feed',
  access: signedIn(),
  input: z.object(templatePagingInput),
  execute: async (ctx, input) => {
    const userId = requireUser(ctx)
    return pageOfTemplates(input.sort, undefined, input, userId)
  },
})

/**
 * Searches templates within the caller's chosen sort (TMPL-27/TMPL-28):
 * case-insensitive, matching the name, the creator's display name, or the AI
 * instructions. A built-in has no creator, so it matches only by name or
 * instructions. Restricted designs never surface here, in any sort, for
 * anyone not on their people list — the same Mongo filter `template.feed`
 * uses is what "top"/"latest" narrow with a query match, and "mine" is
 * already scoped to the caller
 * (`scopedTemplateFilter` `$and`s the two together rather than merging them,
 * so the query can never widen "mine" past the caller's own templates).
 *
 * `q` rather than `query`, matching `social.search` (SPEC: "shaped to fit
 * useDiscover"), and the same `TemplatePage` shape `template.feed` returns
 * rather than lecture search's `SearchResults` — the client's `DiscoverSource`
 * gets a normalizer over the difference rather than this action reshaping
 * itself to fit a lecture-specific type.
 */
export const templateSearch = defineAction<
  { q: string; sort: TemplateFeedSort; offset: number; limit: number },
  TemplatePage,
  Signed
>({
  name: 'template.search',
  access: signedIn(),
  input: z.object({
    q: z.string().trim().min(1).max(100),
    ...templatePagingInput,
  }),
  execute: async (ctx, input) => {
    const userId = requireUser(ctx)
    const rx = new RegExp(escapeRegex(input.q), 'i')
    return pageOfTemplates(input.sort, rx, input, userId)
  },
})

registerAction(deckVote)
registerAction(templateVote)
registerAction(deckFeed)
registerAction(templateFeed)
registerAction(socialSearch)
registerAction(templateSearch)
