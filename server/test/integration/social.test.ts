/**
 * Integration tests for the social actions (SOC-1 voting, SOC-2 browse/search/
 * sort, SOC-3 feeds) against a real MongoDB. Exercises casting/changing/
 * clearing a vote and the denormalized `deck.voteScore`, one-vote-per-user,
 * view-permission enforcement, the public lecture feed (latest vs top ordering,
 * own-lecture exclusion, soft-delete exclusion, `myVote`), offset paging on
 * both lists, search by title/author/content with the caller's sort applied,
 * and the vote fields on the deck viewer route.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { Types } from 'mongoose'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { VoteModel } from '../../src/models/vote'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import { deleteDeckCascade } from '../../src/lib/cascade'

const server = createApp().listen(0)
afterAll(() => server.close())

const registerUser = async (email: string): Promise<string> => {
  const res = await request(server)
    .post('/api/auth/register')
    .send({ email, password: 'longenough1', displayName: email.split('@')[0] })
  return res.body.accessToken as string
}

const act = (token: string, name: string, input: object = {}) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(input)

const getDeck = (slug: string, token?: string) => {
  const req = request(server).get(`/api/decks/${slug}`)
  return token ? req.set('Authorization', `Bearer ${token}`) : req
}

/** Creates a public lecture owned by `token`'s user and returns id + slug. */
const makeLecture = async (
  token: string,
  title: string,
): Promise<{ deckId: string; slug: string }> => {
  const project = await act(token, 'project.create', { title: `${title} proj` })
  const deck = await act(token, 'deck.create', {
    projectId: project.body.id,
    title,
    templateId: 'classic',
  })
  return { deckId: deck.body.id as string, slug: deck.body.permalinkSlug }
}

let ada: string
let bob: string
let cleo: string
let deckId: string
let slug: string

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await UserModel.init()
  await VoteModel.init()
})
afterAll(async () => {
  await disconnectMongo()
})

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    SlideModel.deleteMany({}),
    VoteModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  bob = await registerUser('bob@example.com')
  cleo = await registerUser('cleo@example.com')
  const lecture = await makeLecture(ada, 'Photosynthesis')
  deckId = lecture.deckId
  slug = lecture.slug
})

describe('deck.vote (SOC-1)', () => {
  it('casts an up-vote and updates the denormalized score', async () => {
    const res = await act(bob, 'deck.vote', { deckId, value: 1 })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ up: 1, down: 0, voteScore: 1, myVote: 1 })
    const deck = await DeckModel.findById(deckId)
    expect(deck!.voteScore).toBe(1)
  })

  it('changes an up-vote to a down-vote in place', async () => {
    await act(bob, 'deck.vote', { deckId, value: 1 })
    const res = await act(bob, 'deck.vote', { deckId, value: -1 })
    expect(res.body).toEqual({ up: 0, down: 1, voteScore: -1, myVote: -1 })
    expect(await VoteModel.countDocuments({ targetId: deckId })).toBe(1)
  })

  it('clears a vote with value 0', async () => {
    await act(bob, 'deck.vote', { deckId, value: 1 })
    const res = await act(bob, 'deck.vote', { deckId, value: 0 })
    expect(res.body).toEqual({ up: 0, down: 0, voteScore: 0, myVote: 0 })
    expect(await VoteModel.countDocuments({ targetId: deckId })).toBe(0)
  })

  it('reports separate up and down counts across users', async () => {
    await act(bob, 'deck.vote', { deckId, value: 1 })
    const res = await act(cleo, 'deck.vote', { deckId, value: -1 })
    expect(res.body).toEqual({ up: 1, down: 1, voteScore: 0, myVote: -1 })
  })

  it('keeps one vote per user (idempotent re-vote)', async () => {
    await act(bob, 'deck.vote', { deckId, value: 1 })
    await act(bob, 'deck.vote', { deckId, value: 1 })
    expect(await VoteModel.countDocuments({ targetId: deckId })).toBe(1)
    const deck = await DeckModel.findById(deckId)
    expect(deck!.voteScore).toBe(1)
  })

  it('sums votes across users', async () => {
    await act(bob, 'deck.vote', { deckId, value: 1 })
    const res = await act(cleo, 'deck.vote', { deckId, value: 1 })
    expect(res.body.voteScore).toBe(2)
  })

  it('does not bump updatedAt (votes never reorder the latest feed)', async () => {
    const before = (await DeckModel.findById(deckId))!.updatedAt
    await act(bob, 'deck.vote', { deckId, value: 1 })
    const after = (await DeckModel.findById(deckId))!.updatedAt
    expect(after!.getTime()).toBe(before!.getTime())
  })

  it('refuses to vote on a lecture the caller cannot view', async () => {
    await act(ada, 'deck.setAccess', { deckId, visibility: 'restricted' })
    const res = await act(bob, 'deck.vote', { deckId, value: 1 })
    expect(res.status).toBe(403)
  })

  it('requires authentication', async () => {
    const res = await request(server)
      .post('/api/actions/deck.vote')
      .send({ deckId, value: 1 })
    expect(res.status).toBe(401)
  })
})

describe('deck.feed (SOC-3)', () => {
  it('lists other users public lectures, not the caller own', async () => {
    await makeLecture(bob, 'Bob lecture')
    const res = await act(bob, 'deck.feed', { sort: 'latest' })
    expect(res.status).toBe(200)
    const ids = res.body.items.map((i: { id: string }) => i.id)
    expect(ids).toContain(deckId) // ada's public lecture
    expect(ids).not.toContain(
      // bob's own lecture is excluded
      (await DeckModel.findOne({ title: 'Bob lecture' }))!._id.toString(),
    )
  })

  it('carries owner, project, the caller vote, and up/down counts per row', async () => {
    await act(bob, 'deck.vote', { deckId, value: 1 })
    await act(cleo, 'deck.vote', { deckId, value: -1 })
    const res = await act(bob, 'deck.feed', { sort: 'latest' })
    const row = res.body.items.find((i: { id: string }) => i.id === deckId)
    expect(row.owner.displayName).toBe('ada')
    expect(row.project.title).toBe('Photosynthesis proj')
    expect(row.myVote).toBe(1)
    expect(row.up).toBe(1)
    expect(row.down).toBe(1)
    expect(row.voteScore).toBe(0)
  })

  it('orders "top" by net score', async () => {
    const second = await makeLecture(ada, 'Cell division')
    await act(bob, 'deck.vote', { deckId: second.deckId, value: 1 })
    const res = await act(bob, 'deck.feed', { sort: 'top' })
    const ids = res.body.items.map((i: { id: string }) => i.id)
    expect(ids[0]).toBe(second.deckId) // higher score first
  })

  it('excludes restricted lectures', async () => {
    await act(ada, 'deck.setAccess', { deckId, visibility: 'restricted' })
    const res = await act(bob, 'deck.feed', { sort: 'latest' })
    const ids = res.body.items.map((i: { id: string }) => i.id)
    expect(ids).not.toContain(deckId)
  })

  it('excludes soft-deleted lectures', async () => {
    const deck = await DeckModel.findById(deckId)
    await deleteDeckCascade(deck!)
    const res = await act(bob, 'deck.feed', { sort: 'latest' })
    const ids = res.body.items.map((i: { id: string }) => i.id)
    expect(ids).not.toContain(deckId)
  })
})

describe('deck.feed paging (SOC-2)', () => {
  beforeEach(async () => {
    // Ada already owns one lecture; three more makes four to page through.
    await makeLecture(ada, 'Mitosis')
    await makeLecture(ada, 'Osmosis')
    await makeLecture(ada, 'Enzymes')
  })

  it('returns one page at a time and reports that more remain', async () => {
    const res = await act(bob, 'deck.feed', { sort: 'latest', limit: 2 })
    expect(res.body.items).toHaveLength(2)
    expect(res.body.hasMore).toBe(true)
  })

  it('walks the whole list by offset, without repeats or gaps', async () => {
    const first = await act(bob, 'deck.feed', {
      sort: 'latest',
      limit: 2,
      offset: 0,
    })
    const second = await act(bob, 'deck.feed', {
      sort: 'latest',
      limit: 2,
      offset: 2,
    })
    const ids = [...first.body.items, ...second.body.items].map(
      (i: { id: string }) => i.id,
    )
    expect(new Set(ids).size).toBe(4)
    expect(second.body.hasMore).toBe(false)
  })

  it('clears hasMore on the last page', async () => {
    const res = await act(bob, 'deck.feed', { sort: 'latest', limit: 50 })
    expect(res.body.items).toHaveLength(4)
    expect(res.body.hasMore).toBe(false)
  })

  it('pages the "top" order the same way', async () => {
    const decks = await DeckModel.find({ ownerId: { $ne: null } }).sort({
      createdAt: 1,
    })
    // Give the last lecture the only up-vote so it must lead the "top" page.
    const favourite = decks[decks.length - 1]!
    await act(bob, 'deck.vote', {
      deckId: favourite._id.toString(),
      value: 1,
    })
    const res = await act(bob, 'deck.feed', { sort: 'top', limit: 1 })
    expect(res.body.items[0].id).toBe(favourite._id.toString())
    expect(res.body.hasMore).toBe(true)
  })

  it('rejects a limit beyond the cap', async () => {
    expect(
      (await act(bob, 'deck.feed', { sort: 'latest', limit: 500 })).status,
    ).toBe(400)
  })
})

describe('deck viewer route vote fields', () => {
  it('returns owner, project, myVote, and up/down counts', async () => {
    await act(bob, 'deck.vote', { deckId, value: -1 })
    const res = await getDeck(slug, bob)
    expect(res.status).toBe(200)
    expect(res.body.owner.displayName).toBe('ada')
    expect(res.body.project.title).toBe('Photosynthesis proj')
    expect(res.body.myVote).toBe(-1)
    expect(res.body.voteUp).toBe(0)
    expect(res.body.voteDown).toBe(1)
  })

  it('reports myVote 0 for an anonymous viewer', async () => {
    const res = await getDeck(slug)
    expect(res.body.myVote).toBe(0)
  })
})

describe('social.search (SOC-2)', () => {
  beforeEach(async () => {
    // Ada owns a public "Cat Biology" lecture in a "Cats" project; a user named
    // "Catherine" exists. "dog" should match none of them.
    await act(ada, 'deck.rename', { deckId, title: 'Cat Biology' })
    const project = await act(ada, 'project.create', { title: 'Cats project' })
    await act(ada, 'deck.create', {
      projectId: project.body.id,
      title: 'Kittens 101',
      templateId: 'classic',
    })
    await act(ada, 'project.create', { title: 'Dogs project' })
    await registerUser('catherine@example.com')
  })

  it('matches public lectures, public projects, and people by name', async () => {
    const res = await act(bob, 'social.search', { q: 'cat' })
    expect(res.status).toBe(200)
    const lectureTitles = res.body.lectures.map(
      (l: { title: string }) => l.title,
    )
    expect(lectureTitles).toContain('Cat Biology')
    const projectTitles = res.body.projects.map(
      (p: { title: string }) => p.title,
    )
    expect(projectTitles).toContain('Cats project')
    expect(projectTitles).not.toContain('Dogs project')
    const userNames = res.body.users.map(
      (u: { displayName: string }) => u.displayName,
    )
    expect(userNames).toContain('catherine')
  })

  it('carries owner and project on lecture matches', async () => {
    const res = await act(bob, 'social.search', { q: 'Cat Biology' })
    const hit = res.body.lectures.find(
      (l: { title: string }) => l.title === 'Cat Biology',
    )
    expect(hit.owner.displayName).toBe('ada')
    expect(hit.project.title).toBe('Photosynthesis proj')
    expect(hit.slug).toBeTruthy()
  })

  it('is case-insensitive and returns nothing for a non-match', async () => {
    const upper = await act(bob, 'social.search', { q: 'KITTENS' })
    expect(
      upper.body.lectures.map((l: { title: string }) => l.title),
    ).toContain('Kittens 101')
    const none = await act(bob, 'social.search', { q: 'zzzznomatch' })
    expect(none.body).toEqual({
      lectures: [],
      hasMore: false,
      projects: [],
      users: [],
    })
  })

  it('excludes restricted lectures and projects from results', async () => {
    await act(ada, 'deck.setAccess', { deckId, visibility: 'restricted' })
    const res = await act(bob, 'social.search', { q: 'Cat Biology' })
    expect(
      res.body.lectures.map((l: { title: string }) => l.title),
    ).not.toContain('Cat Biology')
  })

  it('searches others work, not the caller own lectures', async () => {
    await makeLecture(bob, 'Cat anatomy')
    const res = await act(bob, 'social.search', { q: 'cat' })
    expect(
      res.body.lectures.map((l: { title: string }) => l.title),
    ).not.toContain('Cat anatomy')
  })

  it('carries the vote tally on lecture matches, so a hit can show a rating', async () => {
    await act(bob, 'deck.vote', { deckId, value: 1 })
    const res = await act(cleo, 'social.search', { q: 'Cat Biology' })
    const hit = res.body.lectures.find(
      (l: { title: string }) => l.title === 'Cat Biology',
    )
    expect(hit.up).toBe(1)
    expect(hit.down).toBe(0)
    expect(hit.voteScore).toBe(1)
  })

  it('requires a query and authentication', async () => {
    expect((await act(bob, 'social.search', { q: '' })).status).toBe(400)
    const anon = await request(server)
      .post('/api/actions/social.search')
      .send({ q: 'cat' })
    expect(anon.status).toBe(401)
  })
})

describe('social.search by author and content (SOC-2)', () => {
  let adaDeckId: string

  beforeEach(async () => {
    // "ada" is the author; her lecture is titled so the title never matches the
    // author or content queries below, proving each field is searched in its
    // own right.
    const lecture = await makeLecture(ada, 'Untitled topic')
    adaDeckId = lecture.deckId
    await DeckModel.updateOne(
      { _id: adaDeckId },
      { transcript: 'today we discuss chloroplasts at length' },
    )
    await SlideModel.create({
      deckId: new Types.ObjectId(adaDeckId),
      index: 0,
      layoutType: 'content',
      title: 'Ribosome basics',
      body: 'The mitochondrion is the powerhouse',
      bullets: ['golgi apparatus'],
      caption: 'a labelled vacuole',
    })
  })

  it('matches a lecture by its author name', async () => {
    const res = await act(bob, 'social.search', { q: 'ada' })
    expect(res.body.lectures.map((l: { id: string }) => l.id)).toContain(
      adaDeckId,
    )
  })

  it('matches a lecture by its spoken transcript', async () => {
    const res = await act(bob, 'social.search', { q: 'chloroplasts' })
    expect(res.body.lectures.map((l: { id: string }) => l.id)).toContain(
      adaDeckId,
    )
  })

  it.each([
    ['slide title', 'Ribosome'],
    ['slide body', 'powerhouse'],
    ['slide bullets', 'golgi'],
    ['slide caption', 'vacuole'],
  ])('matches a lecture by its %s', async (_field, q) => {
    const res = await act(bob, 'social.search', { q })
    expect(res.body.lectures.map((l: { id: string }) => l.id)).toContain(
      adaDeckId,
    )
  })

  it('still respects visibility when matching on content', async () => {
    await act(ada, 'deck.setAccess', {
      deckId: adaDeckId,
      visibility: 'restricted',
    })
    const res = await act(bob, 'social.search', { q: 'powerhouse' })
    expect(res.body.lectures.map((l: { id: string }) => l.id)).not.toContain(
      adaDeckId,
    )
  })

  it('treats a query with regex characters literally', async () => {
    const res = await act(bob, 'social.search', { q: 'a.a' })
    // "a.a" must not match "ada" the way an unescaped regex dot would
    expect(res.body.lectures.map((l: { id: string }) => l.id)).not.toContain(
      adaDeckId,
    )
  })
})

describe('social.search sort and paging (SOC-2)', () => {
  let low: string
  let high: string

  beforeEach(async () => {
    // Two matching lectures: the older one carries the higher score, so
    // "latest" and "top" must disagree about which comes first.
    const first = await makeLecture(ada, 'Sorting alpha')
    const second = await makeLecture(ada, 'Sorting beta')
    high = first.deckId
    low = second.deckId
    await act(bob, 'deck.vote', { deckId: high, value: 1 })
    await act(cleo, 'deck.vote', { deckId: high, value: 1 })
  })

  it('orders search results by recency for "latest"', async () => {
    const res = await act(bob, 'social.search', {
      q: 'Sorting',
      sort: 'latest',
    })
    expect(res.body.lectures[0].id).toBe(low) // newest first
  })

  it('orders the same search by rank for "top"', async () => {
    const res = await act(bob, 'social.search', { q: 'Sorting', sort: 'top' })
    expect(res.body.lectures[0].id).toBe(high) // highest net score first
  })

  it('defaults to "latest" when no sort is given', async () => {
    const res = await act(bob, 'social.search', { q: 'Sorting' })
    expect(res.body.lectures[0].id).toBe(low)
  })

  it('pages lecture matches by offset', async () => {
    const first = await act(bob, 'social.search', {
      q: 'Sorting',
      sort: 'top',
      limit: 1,
    })
    expect(first.body.lectures).toHaveLength(1)
    expect(first.body.hasMore).toBe(true)
    const second = await act(bob, 'social.search', {
      q: 'Sorting',
      sort: 'top',
      limit: 1,
      offset: 1,
    })
    expect(second.body.lectures[0].id).not.toBe(first.body.lectures[0].id)
    expect(second.body.hasMore).toBe(false)
  })

  it('returns the project and people groups only with the first page', async () => {
    const first = await act(bob, 'social.search', { q: 'Sorting', limit: 1 })
    const later = await act(bob, 'social.search', {
      q: 'Sorting',
      limit: 1,
      offset: 1,
    })
    expect(first.body.projects.length).toBeGreaterThan(0)
    expect(later.body.projects).toEqual([])
    expect(later.body.users).toEqual([])
  })
})
