/**
 * Integration tests for template voting and the browsable template feed
 * (TMPL-27 voting, TMPL-28 feed/search) against a real MongoDB. Exercises
 * casting/changing/clearing a vote on a stored template and on a built-in,
 * the denormalized `voteScore` (and that voting never bumps `updatedAt`),
 * the "latest"/"top"/"mine" sorts and their paging (including a tied-score,
 * tied-date page boundary), built-ins merging into "latest" and "top",
 * search within each sort (including that a restricted template never leaks
 * through search under any sort), soft-delete exclusion, and the
 * `owner`/`layoutCount`/`description`/`votes` card metadata — `votes.myVote`
 * included — on `template.list`, `template.get` and the feed.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { Types } from 'mongoose'
import type { Template } from '@slide-machine/shared'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { TemplateModel } from '../../src/models/template'
import { VoteModel } from '../../src/models/vote'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import { listBuiltinTemplates } from '../../src/templates/builtin'

const server = createApp().listen(0)
afterAll(() => server.close())

const registerUser = async (email: string): Promise<string> => {
  const res = await request(server)
    .post('/api/auth/register')
    .send({ email, password: 'longenough1', displayName: email.split('@')[0] })
  // Confirmed, so making a template public (AUTH-3) is never the thing under
  // test failing.
  await UserModel.updateOne({ email }, { emailVerified: true })
  return res.body.accessToken as string
}

const act = (token: string, name: string, input: object = {}) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(input)

const builtinId = (): string => listBuiltinTemplates()[0]!.id

/** A public template owned by `token`'s user, from a duplicated built-in. */
const makePublicTemplate = async (
  token: string,
  name: string,
): Promise<Template> => {
  const dup = await act(token, 'template.duplicate', {
    templateId: builtinId(),
    name,
  })
  const set = await act(token, 'template.setAccess', {
    templateId: dup.body.id,
    visibility: 'public',
  })
  return set.body as Template
}

/** Forces a document's `updatedAt` to an exact value, past Mongoose's own
 * timestamp handling — the only way to produce a genuine tie between two
 * templates for the paging-stability tests below. */
const forceUpdatedAt = async (
  templateId: string,
  when: Date,
): Promise<void> => {
  await TemplateModel.collection.updateOne(
    { _id: new Types.ObjectId(templateId) },
    { $set: { updatedAt: when } },
  )
}

let ada: string
let bob: string
let cleo: string

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
    TemplateModel.deleteMany({}),
    VoteModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  bob = await registerUser('bob@example.com')
  cleo = await registerUser('cleo@example.com')
})

describe('template.vote (TMPL-27)', () => {
  it('casts an up-vote on a stored template and updates its denormalized score', async () => {
    const mine = await makePublicTemplate(ada, 'Ada Style')
    const res = await act(bob, 'template.vote', {
      templateId: mine.id,
      value: 1,
    })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ up: 1, down: 0, voteScore: 1, myVote: 1 })
    const doc = await TemplateModel.findById(mine.id)
    expect(doc!.voteScore).toBe(1)
  })

  it('changes an up-vote to a down-vote in place', async () => {
    const mine = await makePublicTemplate(ada, 'Ada Style')
    await act(bob, 'template.vote', { templateId: mine.id, value: 1 })
    const res = await act(bob, 'template.vote', {
      templateId: mine.id,
      value: -1,
    })
    expect(res.body).toEqual({ up: 0, down: 1, voteScore: -1, myVote: -1 })
    expect(
      await VoteModel.countDocuments({ targetId: new Types.ObjectId(mine.id) }),
    ).toBe(1)
  })

  it('clears a vote with value 0', async () => {
    const mine = await makePublicTemplate(ada, 'Ada Style')
    await act(bob, 'template.vote', { templateId: mine.id, value: 1 })
    const res = await act(bob, 'template.vote', {
      templateId: mine.id,
      value: 0,
    })
    expect(res.body).toEqual({ up: 0, down: 0, voteScore: 0, myVote: 0 })
    expect(
      await VoteModel.countDocuments({ targetId: new Types.ObjectId(mine.id) }),
    ).toBe(0)
  })

  it('does not bump updatedAt (votes never reorder the latest feed)', async () => {
    const mine = await makePublicTemplate(ada, 'Ada Style')
    const before = (await TemplateModel.findById(mine.id))!.updatedAt
    await act(bob, 'template.vote', { templateId: mine.id, value: 1 })
    const after = (await TemplateModel.findById(mine.id))!.updatedAt
    expect(after!.getTime()).toBe(before!.getTime())
  })

  it('votes on a built-in, up, down, changed, and cleared, with no document to write', async () => {
    const id = builtinId()
    const up = await act(bob, 'template.vote', { templateId: id, value: 1 })
    expect(up.body).toEqual({ up: 1, down: 0, voteScore: 1, myVote: 1 })
    expect(
      await VoteModel.countDocuments({ targetId: id, targetType: 'template' }),
    ).toBe(1)

    const changed = await act(cleo, 'template.vote', {
      templateId: id,
      value: -1,
    })
    expect(changed.body).toEqual({ up: 1, down: 1, voteScore: 0, myVote: -1 })

    const cleared = await act(bob, 'template.vote', {
      templateId: id,
      value: 0,
    })
    expect(cleared.body).toEqual({ up: 0, down: 1, voteScore: -1, myVote: 0 })
  })

  it('keeps one vote per user (idempotent re-vote), stored and built-in alike', async () => {
    const mine = await makePublicTemplate(ada, 'Ada Style')
    await act(bob, 'template.vote', { templateId: mine.id, value: 1 })
    await act(bob, 'template.vote', { templateId: mine.id, value: 1 })
    expect(
      await VoteModel.countDocuments({ targetId: new Types.ObjectId(mine.id) }),
    ).toBe(1)

    const id = builtinId()
    await act(bob, 'template.vote', { templateId: id, value: 1 })
    await act(bob, 'template.vote', { templateId: id, value: 1 })
    expect(
      await VoteModel.countDocuments({ targetId: id, targetType: 'template' }),
    ).toBe(1)
  })

  it('keeps deck votes and template votes independent under the widened schema', async () => {
    // Deck and template votes now share one Mixed `targetId` field
    // (models/vote.ts) — the unique index must still keep them apart.
    const project = await act(ada, 'project.create', { title: 'Proj' })
    const deck = await act(ada, 'deck.create', {
      projectId: project.body.id,
      title: 'Deck',
      templateId: 'classic',
    })
    await act(bob, 'deck.vote', { deckId: deck.body.id, value: 1 })
    const mine = await makePublicTemplate(ada, 'Ada Style')
    await act(bob, 'template.vote', { templateId: mine.id, value: -1 })
    expect(await VoteModel.countDocuments({})).toBe(2)
    const deckVote = await VoteModel.findOne({ targetType: 'deck' })
    const templateVote = await VoteModel.findOne({ targetType: 'template' })
    expect(deckVote!.value).toBe(1)
    expect(templateVote!.value).toBe(-1)
  })

  it('refuses to vote on a template the caller cannot read', async () => {
    const dup = await act(ada, 'template.duplicate', {
      templateId: builtinId(),
      name: 'Private',
    })
    const res = await act(bob, 'template.vote', {
      templateId: dup.body.id,
      value: 1,
    })
    expect(res.status).toBe(403)
  })

  it('requires authentication', async () => {
    const res = await request(server)
      .post('/api/actions/template.vote')
      .send({ templateId: builtinId(), value: 1 })
    expect(res.status).toBe(401)
  })
})

describe('template.list/get card metadata (TMPL-27/TMPL-28)', () => {
  it('carries owner, layoutCount, description and votes on template.list', async () => {
    const mine = await act(ada, 'template.duplicate', {
      templateId: builtinId(),
      name: 'Ada Style',
    })
    await act(ada, 'template.update', {
      templateId: mine.body.id,
      name: 'Ada Style',
      renderMode: mine.body.renderMode,
      theme: mine.body.theme,
      layouts: mine.body.layouts,
      aiInstructions: 'Write for a curious ten-year-old.',
    })
    // Bob has to be able to read it before he can vote on it.
    await act(ada, 'template.setAccess', {
      templateId: mine.body.id,
      visibility: 'public',
    })
    await act(bob, 'template.vote', { templateId: mine.body.id, value: 1 })

    const res = await act(ada, 'template.list')
    const row = res.body.find((t: { id: string }) => t.id === mine.body.id)
    expect(row.owner).toEqual({ id: expect.any(String), displayName: 'ada' })
    expect(row.layoutCount).toBe(
      row.layouts.filter((l: { type: string }) => l.type !== 'whiteboard')
        .length,
    )
    expect(row.description).toBe('Write for a curious ten-year-old.')
    expect(row.votes).toEqual({ up: 1, down: 0, myVote: 0 })
  })

  it('a built-in carries owner null and a tallied vote score', async () => {
    const id = builtinId()
    await act(bob, 'template.vote', { templateId: id, value: 1 })
    const res = await act(ada, 'template.list')
    const row = res.body.find((t: { id: string }) => t.id === id)
    expect(row.owner).toBeNull()
    expect(row.voteScore).toBe(1)
    expect(row.votes).toEqual({ up: 1, down: 0, myVote: 0 })
  })

  it('carries the same metadata on template.get', async () => {
    const mine = await makePublicTemplate(ada, 'Ada Style')
    await act(cleo, 'template.vote', { templateId: mine.id, value: -1 })
    const res = await act(bob, 'template.get', { slug: mine.permalinkSlug })
    expect(res.body.owner.displayName).toBe('ada')
    expect(res.body.votes).toEqual({ up: 0, down: 1, myVote: 0 })
    expect(typeof res.body.layoutCount).toBe('number')
  })

  describe('votes.myVote for the voter, stored and built-in alike', () => {
    it('on template.list', async () => {
      // `template.list` is the caller's own library (own + shared + built-ins),
      // not a public browse — so the stored case has to be the voter's own
      // template (owners may vote too, same as on a lecture); the built-in
      // case works for anyone, since every built-in is in every library.
      const mine = await makePublicTemplate(ada, 'Ada Style')
      await act(ada, 'template.vote', { templateId: mine.id, value: 1 })
      const id = builtinId()
      await act(bob, 'template.vote', { templateId: id, value: -1 })

      const adaRes = await act(ada, 'template.list')
      const stored = adaRes.body.find((t: { id: string }) => t.id === mine.id)
      expect(stored.votes.myVote).toBe(1)

      const bobRes = await act(bob, 'template.list')
      const builtin = bobRes.body.find((t: { id: string }) => t.id === id)
      expect(builtin.votes.myVote).toBe(-1)
    })

    it('on template.get', async () => {
      const mine = await makePublicTemplate(ada, 'Ada Style')
      await act(bob, 'template.vote', { templateId: mine.id, value: 1 })
      const res = await act(bob, 'template.get', { slug: mine.permalinkSlug })
      expect(res.body.votes.myVote).toBe(1)
    })

    it('on template.feed', async () => {
      const mine = await makePublicTemplate(ada, 'Ada Style')
      await act(bob, 'template.vote', { templateId: mine.id, value: 1 })
      const id = builtinId()
      await act(bob, 'template.vote', { templateId: id, value: -1 })

      const res = await act(bob, 'template.feed', { sort: 'latest', limit: 50 })
      const stored = res.body.items.find(
        (t: { id: string }) => t.id === mine.id,
      )
      const builtin = res.body.items.find((t: { id: string }) => t.id === id)
      expect(stored.votes.myVote).toBe(1)
      expect(builtin.votes.myVote).toBe(-1)
    })
  })
})

describe('template.feed "latest" (TMPL-28)', () => {
  it("lists every public template, including the caller's own, and every built-in", async () => {
    const mine = await makePublicTemplate(ada, 'Ada Style')
    const res = await act(ada, 'template.feed', { sort: 'latest', limit: 50 })
    const ids = res.body.items.map((t: { id: string }) => t.id)
    expect(ids).toContain(mine.id)
    for (const builtin of listBuiltinTemplates()) {
      expect(ids).toContain(builtin.id)
    }
  })

  it('excludes a restricted template', async () => {
    const dup = await act(ada, 'template.duplicate', {
      templateId: builtinId(),
      name: 'Private',
    })
    const res = await act(bob, 'template.feed', { sort: 'latest', limit: 50 })
    const ids = res.body.items.map((t: { id: string }) => t.id)
    expect(ids).not.toContain(dup.body.id)
  })

  it('excludes a soft-deleted template', async () => {
    const mine = await makePublicTemplate(ada, 'Deleted Style')
    await act(ada, 'template.delete', { templateId: mine.id })
    const res = await act(bob, 'template.feed', { sort: 'latest', limit: 50 })
    const ids = res.body.items.map((t: { id: string }) => t.id)
    expect(ids).not.toContain(mine.id)
  })

  it('sorts stored templates by real recency, not creation order', async () => {
    const first = await makePublicTemplate(ada, 'First')
    const second = await makePublicTemplate(ada, 'Second')
    const third = await makePublicTemplate(ada, 'Third')
    // Date the middle one latest. Only a sort on `updatedAt` gives
    // second, third, first: insertion order and either `_id` direction give
    // first-second-third or its reverse. Explicit dates, so two saves landing
    // in one millisecond cannot fall through to the id tie-break.
    await forceUpdatedAt(first.id, new Date('2026-01-01T00:00:00Z'))
    await forceUpdatedAt(third.id, new Date('2026-01-02T00:00:00Z'))
    await forceUpdatedAt(second.id, new Date('2026-01-03T00:00:00Z'))

    const res = await act(bob, 'template.feed', { sort: 'latest', limit: 50 })
    const ids: string[] = res.body.items.map((t: { id: string }) => t.id)
    expect(ids).toContain(builtinId())
    // Built-ins come first, so the stored designs trail every one of them —
    // they stay reachable at the top of the default sort rather than being
    // buried once enough public designs accumulate ahead of them.
    expect(ids.indexOf(first.id)).toBeGreaterThan(ids.indexOf(builtinId()))
    const stored = ids.filter(
      id => !listBuiltinTemplates().some(b => b.id === id),
    )
    expect(stored.slice(0, 3)).toEqual([second.id, third.id, first.id])
  })

  it('walks the whole merged list by offset, without repeats or gaps', async () => {
    await makePublicTemplate(ada, 'First')
    await makePublicTemplate(ada, 'Second')
    const total =
      (await TemplateModel.countDocuments({ visibility: 'public' })) +
      listBuiltinTemplates().length
    const pageSize = 2
    const seen = new Set<string>()
    let offset = 0
    let hasMore = true
    while (hasMore) {
      const res = await act(bob, 'template.feed', {
        sort: 'latest',
        offset,
        limit: pageSize,
      })
      for (const item of res.body.items as { id: string }[]) seen.add(item.id)
      hasMore = res.body.hasMore
      offset += pageSize
    }
    expect(seen.size).toBe(total)
  })

  it('rejects a limit beyond the cap', async () => {
    expect(
      (await act(bob, 'template.feed', { sort: 'latest', limit: 500 })).status,
    ).toBe(400)
  })

  it('requires authentication', async () => {
    const res = await request(server)
      .post('/api/actions/template.feed')
      .send({ sort: 'latest' })
    expect(res.status).toBe(401)
  })
})

describe('template.feed "top" (TMPL-27/TMPL-28)', () => {
  it('ranks a highly-voted built-in above a lower-voted stored template', async () => {
    const mine = await makePublicTemplate(ada, 'Ada Style')
    await act(bob, 'template.vote', { templateId: mine.id, value: 1 })
    const id = builtinId()
    await act(bob, 'template.vote', { templateId: id, value: 1 })
    await act(cleo, 'template.vote', { templateId: id, value: 1 })

    const res = await act(bob, 'template.feed', { sort: 'top', limit: 50 })
    const ids = res.body.items.map((t: { id: string }) => t.id)
    expect(ids).toContain(id)
    expect(ids).toContain(mine.id)
    expect(ids.indexOf(id)).toBeLessThan(ids.indexOf(mine.id))
  })

  it('orders stored templates by net score', async () => {
    const low = await makePublicTemplate(ada, 'Low')
    const high = await makePublicTemplate(ada, 'High')
    await act(bob, 'template.vote', { templateId: high.id, value: 1 })
    await act(cleo, 'template.vote', { templateId: high.id, value: 1 })
    const res = await act(bob, 'template.feed', { sort: 'top', limit: 50 })
    const ids = res.body.items.map((t: { id: string }) => t.id)
    expect(ids).toContain(high.id)
    expect(ids).toContain(low.id)
    expect(ids.indexOf(high.id)).toBeLessThan(ids.indexOf(low.id))
  })

  it('excludes a soft-deleted template even if it outscores everything else', async () => {
    const mine = await makePublicTemplate(ada, 'Deleted High Scorer')
    await act(bob, 'template.vote', { templateId: mine.id, value: 1 })
    await act(cleo, 'template.vote', { templateId: mine.id, value: 1 })
    await act(ada, 'template.delete', { templateId: mine.id })
    const res = await act(bob, 'template.feed', { sort: 'top', limit: 50 })
    const ids = res.body.items.map((t: { id: string }) => t.id)
    expect(ids).not.toContain(mine.id)
  })

  it('pages the merged top order without repeats or gaps', async () => {
    await makePublicTemplate(ada, 'First')
    await makePublicTemplate(ada, 'Second')
    const total =
      (await TemplateModel.countDocuments({ visibility: 'public' })) +
      listBuiltinTemplates().length
    const pageSize = 2
    const seen = new Set<string>()
    let offset = 0
    let hasMore = true
    while (hasMore) {
      const res = await act(bob, 'template.feed', {
        sort: 'top',
        offset,
        limit: pageSize,
      })
      for (const item of res.body.items as { id: string }[]) seen.add(item.id)
      hasMore = res.body.hasMore
      offset += pageSize
    }
    expect(seen.size).toBe(total)
  })

  it('pages a page boundary where every candidate ties on score and date, with no duplicates or skips', async () => {
    // Three stored templates, none voted (score 0, tied with every built-in's
    // own untouched score), all forced to the exact same `updatedAt` — the
    // same tie built-ins already have among themselves by default. Only the
    // id tie-break can decide the order, and it must still be a total order:
    // paging by 1 across the whole set must visit each exactly once.
    const tied = [
      await makePublicTemplate(ada, 'Tied A'),
      await makePublicTemplate(ada, 'Tied B'),
      await makePublicTemplate(ada, 'Tied C'),
    ]
    const when = new Date('2026-01-01T00:00:00.000Z')
    for (const t of tied) await forceUpdatedAt(t.id, when)

    const total = tied.length + listBuiltinTemplates().length
    const seen: string[] = []
    let offset = 0
    let hasMore = true
    while (hasMore) {
      const res = await act(bob, 'template.feed', {
        sort: 'top',
        offset,
        limit: 1,
      })
      expect(res.body.items).toHaveLength(1)
      seen.push(res.body.items[0].id)
      hasMore = res.body.hasMore
      offset += 1
    }
    expect(seen).toHaveLength(total)
    expect(new Set(seen).size).toBe(total) // no duplicates
    for (const t of tied) expect(seen).toContain(t.id) // no skips
    // On a score tie stored designs lead built-ins, and a full tie falls to
    // the id, descending, as Mongo's own `_id: -1` would order them.
    const byIdDesc = tied.map(t => t.id).sort((a, b) => (a < b ? 1 : -1))
    expect(seen.slice(0, tied.length)).toEqual(byIdDesc)
  })
})

describe('template.feed "mine" (TMPL-28)', () => {
  it('lists templates the caller owns, of any visibility, no built-ins', async () => {
    const restricted = await act(ada, 'template.duplicate', {
      templateId: builtinId(),
      name: 'Restricted mine',
    })
    const res = await act(ada, 'template.feed', { sort: 'mine', limit: 50 })
    const ids = res.body.items.map((t: { id: string }) => t.id)
    expect(ids).toContain(restricted.body.id)
    expect(ids).not.toContain(builtinId())
  })

  it('lists a template shared with the caller as a viewer', async () => {
    const dup = await act(ada, 'template.duplicate', {
      templateId: builtinId(),
      name: 'Shared',
    })
    await act(ada, 'template.share', {
      templateId: dup.body.id,
      email: 'bob@example.com',
      role: 'viewer',
    })
    const res = await act(bob, 'template.feed', { sort: 'mine', limit: 50 })
    const ids = res.body.items.map((t: { id: string }) => t.id)
    expect(ids).toContain(dup.body.id)
  })

  it('does not list templates owned by someone else and not shared', async () => {
    const dup = await act(ada, 'template.duplicate', {
      templateId: builtinId(),
      name: 'Ada only',
    })
    const res = await act(bob, 'template.feed', { sort: 'mine', limit: 50 })
    const ids = res.body.items.map((t: { id: string }) => t.id)
    expect(ids).not.toContain(dup.body.id)
  })

  it('excludes a soft-deleted template of the caller own', async () => {
    const dup = await act(ada, 'template.duplicate', {
      templateId: builtinId(),
      name: 'Deleted mine',
    })
    await act(ada, 'template.delete', { templateId: dup.body.id })
    const res = await act(ada, 'template.feed', { sort: 'mine', limit: 50 })
    const ids = res.body.items.map((t: { id: string }) => t.id)
    expect(ids).not.toContain(dup.body.id)
  })

  it('orders by real recency, not creation order', async () => {
    const first = await act(ada, 'template.duplicate', {
      templateId: builtinId(),
      name: 'First',
    })
    const second = await act(ada, 'template.duplicate', {
      templateId: builtinId(),
      name: 'Second',
    })
    const third = await act(ada, 'template.duplicate', {
      templateId: builtinId(),
      name: 'Third',
    })
    // Date the middle one latest: only an `updatedAt` sort yields second,
    // third, first (insertion order and either `_id` direction cannot).
    await forceUpdatedAt(first.body.id, new Date('2026-01-01T00:00:00Z'))
    await forceUpdatedAt(third.body.id, new Date('2026-01-02T00:00:00Z'))
    await forceUpdatedAt(second.body.id, new Date('2026-01-03T00:00:00Z'))

    const res = await act(ada, 'template.feed', { sort: 'mine', limit: 50 })
    const ids = res.body.items.map((t: { id: string }) => t.id)
    expect(ids).toEqual([second.body.id, third.body.id, first.body.id])
  })
})

describe('template.search (TMPL-28)', () => {
  it('matches a public template by name in "latest"', async () => {
    await makePublicTemplate(ada, 'Chalkboard Classic')
    const res = await act(bob, 'template.search', {
      q: 'Chalkboard',
      sort: 'latest',
    })
    const names = res.body.items.map((t: { name: string }) => t.name)
    expect(names).toContain('Chalkboard Classic')
  })

  it('matches a public template by its AI instructions', async () => {
    const mine = await makePublicTemplate(ada, 'Ada Style')
    await act(ada, 'template.update', {
      templateId: mine.id,
      name: mine.name,
      renderMode: mine.renderMode,
      theme: mine.theme,
      layouts: mine.layouts,
      aiInstructions: 'friendly tone for a science museum audience',
    })
    const res = await act(bob, 'template.search', {
      q: 'science museum',
      sort: 'latest',
    })
    const ids = res.body.items.map((t: { id: string }) => t.id)
    expect(ids).toContain(mine.id)
  })

  it('matches within "top"', async () => {
    await makePublicTemplate(ada, 'Sorting alpha')
    const high = await makePublicTemplate(ada, 'Sorting beta')
    await act(bob, 'template.vote', { templateId: high.id, value: 1 })
    const res = await act(cleo, 'template.search', {
      q: 'Sorting',
      sort: 'top',
    })
    expect(res.body.items[0].id).toBe(high.id)
  })

  // TMPL-28: search also matches the owner's display name, alongside a
  // template's own name and AI instructions — a third `$or` arm, so a query
  // that hits neither the name nor the instructions still finds the design
  // by who made it.
  it("matches a public template by its creator's display name, in every sort", async () => {
    const byAda = await makePublicTemplate(ada, 'Untitled One')
    const high = await makePublicTemplate(ada, 'Untitled Two')
    await act(bob, 'template.vote', { templateId: high.id, value: 1 })
    for (const sort of ['latest', 'top'] as const) {
      const res = await act(bob, 'template.search', { q: 'ada', sort })
      const ids = res.body.items.map((t: { id: string }) => t.id)
      expect(ids).toContain(byAda.id)
      expect(ids).toContain(high.id)
    }
  })

  it('matches a creator-name search within "mine", scoped to the caller and any visibility', async () => {
    // Named so its own text never contains "ada" — the query this test
    // searches on — so a match here can only be through the creator arm,
    // never a coincidental name match masquerading as one.
    const restricted = await act(ada, 'template.duplicate', {
      templateId: builtinId(),
      name: 'Confidential Style',
    })
    const res = await act(ada, 'template.search', { q: 'ada', sort: 'mine' })
    const ids = res.body.items.map((t: { id: string }) => t.id)
    expect(ids).toContain(restricted.body.id)
  })

  // The same leak this file already guards a name match against (below),
  // checked for a creator-name match too: bob's own query for "ada" must
  // never surface a design ada owns but never shared or made public.
  it("never surfaces someone else's restricted template on a creator-name match", async () => {
    // Named without "ada" in it, for the same reason as above — the
    // assertion below must fail only because of the ownership scope, never
    // because the name itself happened not to match the query either way.
    await act(ada, 'template.duplicate', {
      templateId: builtinId(),
      name: 'Confidential Design Only',
    })
    for (const sort of ['latest', 'top', 'mine'] as const) {
      const res = await act(bob, 'template.search', { q: 'ada', sort })
      const names = res.body.items.map((t: { name: string }) => t.name)
      expect(names).not.toContain('Confidential Design Only')
    }
  })

  it('matches within "mine", scoped to the caller and any visibility', async () => {
    const restricted = await act(ada, 'template.duplicate', {
      templateId: builtinId(),
      name: 'Findable Restricted',
    })
    const res = await act(ada, 'template.search', {
      q: 'Findable',
      sort: 'mine',
    })
    const ids = res.body.items.map((t: { id: string }) => t.id)
    expect(ids).toContain(restricted.body.id)
  })

  it('excludes a restricted template from search in every sort, even on a name match', async () => {
    const dup = await act(ada, 'template.duplicate', {
      templateId: builtinId(),
      name: 'Secret Design',
    })
    // Give it the top score too (its owner may vote on it), so a ranking bug
    // can't hide it from "top" by simply never reaching it.
    const vote = await act(ada, 'template.vote', {
      templateId: dup.body.id,
      value: 1,
    })
    expect(vote.status).toBe(200)

    for (const sort of ['latest', 'top'] as const) {
      const res = await act(bob, 'template.search', {
        q: 'Secret Design',
        sort,
      })
      const ids = res.body.items.map((t: { id: string }) => t.id)
      expect(ids).not.toContain(dup.body.id)
    }
  })

  // The bug this guards against: a spread-merged filter (`{ ...scope,
  // ...match }`) lets the query's own `$or` silently replace the scope's
  // `$or`, so a "mine" search would run with no ownership check at all.
  it('never returns someone else restricted template under "mine", even on a name match', async () => {
    const dup = await act(ada, 'template.duplicate', {
      templateId: builtinId(),
      name: 'Ada Only Findable',
    })
    const res = await act(bob, 'template.search', {
      q: 'Ada Only Findable',
      sort: 'mine',
    })
    const ids = res.body.items.map((t: { id: string }) => t.id)
    expect(ids).not.toContain(dup.body.id)
  })

  it('treats a query with regex characters literally', async () => {
    await makePublicTemplate(ada, 'a.a design')
    // "abad" contains the substring "aba", which an UNESCAPED `a.a` regex
    // (`.` as wildcard) would match; a literal, escaped match must not.
    await makePublicTemplate(bob, 'abad design')

    const res = await act(cleo, 'template.search', { q: 'a.a', sort: 'latest' })
    const names = res.body.items.map((t: { name: string }) => t.name)
    expect(names).toContain('a.a design')
    expect(names).not.toContain('abad design')

    const none = await act(bob, 'template.search', {
      q: 'zzzznomatch',
      sort: 'latest',
    })
    expect(none.body).toEqual({ items: [], hasMore: false })
  })

  it('excludes a soft-deleted template even on a name match', async () => {
    const mine = await makePublicTemplate(ada, 'Findable Then Deleted')
    await act(ada, 'template.delete', { templateId: mine.id })
    const res = await act(bob, 'template.search', {
      q: 'Findable Then Deleted',
      sort: 'latest',
    })
    const ids = res.body.items.map((t: { id: string }) => t.id)
    expect(ids).not.toContain(mine.id)
  })

  it('requires a query and authentication', async () => {
    expect(
      (await act(bob, 'template.search', { q: '', sort: 'latest' })).status,
    ).toBe(400)
    const anon = await request(server)
      .post('/api/actions/template.search')
      .send({ q: 'x', sort: 'latest' })
    expect(anon.status).toBe(401)
  })
})

describe('deck.vote still works (regression, TMPL-27 vote-model widening)', () => {
  it('casts, changes and clears a deck vote as before', async () => {
    const project = await act(ada, 'project.create', { title: 'Proj' })
    const deck = await act(ada, 'deck.create', {
      projectId: project.body.id,
      title: 'Deck',
      templateId: 'classic',
    })
    const up = await act(bob, 'deck.vote', {
      deckId: deck.body.id,
      value: 1,
    })
    expect(up.body).toEqual({ up: 1, down: 0, voteScore: 1, myVote: 1 })
    const changed = await act(bob, 'deck.vote', {
      deckId: deck.body.id,
      value: -1,
    })
    expect(changed.body).toEqual({ up: 0, down: 1, voteScore: -1, myVote: -1 })
    const cleared = await act(bob, 'deck.vote', {
      deckId: deck.body.id,
      value: 0,
    })
    expect(cleared.body).toEqual({ up: 0, down: 0, voteScore: 0, myVote: 0 })
    expect(await VoteModel.countDocuments({ targetType: 'deck' })).toBe(0)
  })
})
