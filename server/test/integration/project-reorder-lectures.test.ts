/**
 * Integration tests for ordering a project's lectures by dragging (PROJ-4),
 * against a real MongoDB.
 *
 * Three things are checked, because three things could each be wrong on
 * their own:
 *
 *   - project.reorderLectures itself — the permutation guard (the same one
 *     deck.reorderSlides has) and the owner-only gate;
 *   - deck.list honouring the stored order for the project it belongs to,
 *     staying newest-first for one that was never arranged, putting a
 *     lecture the order does not mention first, and tolerating a stale id
 *     for a lecture since deleted;
 *   - the SAME order reaching the home page, which lists across every
 *     project with no projectId and groups by project client-side — the
 *     requirement most likely to be quietly missed.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type { Server } from 'node:http'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import {
  startServer,
  registerUser,
  act,
  actAnonymously,
} from './helpers/actions'

/** A well-formed id that addresses nothing. */
const ABSENT = '507f1f77bcf86cd799439011'

let server: Server
let ada: string
let bob: string
let physics: string

/** Backdates a deck's updatedAt so newest-first order is deterministic. */
const backdateDeck = (id: string, updatedAt: string) =>
  DeckModel.updateOne(
    { _id: id },
    { $set: { updatedAt: new Date(updatedAt) } },
    { timestamps: false },
  )

/** Creates a lecture in `physics` titled `title`, backdated to `updatedAt`. */
const createLecture = async (title: string, updatedAt: string) => {
  const id = (
    await act(server, ada, 'deck.create', { projectId: physics, title })
  ).body.id as string
  await backdateDeck(id, updatedAt)
  return id
}

beforeAll(async () => {
  server = startServer()
  await connectMongo(env.MONGODB_URI)
  await Promise.all([UserModel.init(), DeckModel.init()])
})

afterAll(async () => {
  await disconnectMongo()
  server.close()
})

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    SlideModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  ada = await registerUser(server, 'ada@example.com')
  bob = await registerUser(server, 'bob@example.com')
  physics = (await act(server, ada, 'project.create', { title: 'Physics' }))
    .body.id as string
})

describe('project.reorderLectures (PROJ-4)', () => {
  it('rejects an array missing one of the current lecture ids', async () => {
    const l1 = await createLecture('L1', '2024-01-01')
    await createLecture('L2', '2024-01-02')

    const res = await act(server, ada, 'project.reorderLectures', {
      projectId: physics,
      lectureOrder: [l1],
    })
    expect(res.status).toBe(400)
    expect(await DeckModel.find({ projectId: physics })).toHaveLength(2)
  })

  it('rejects an array with an extra id not among the project’s lectures', async () => {
    const l1 = await createLecture('L1', '2024-01-01')

    const res = await act(server, ada, 'project.reorderLectures', {
      projectId: physics,
      lectureOrder: [l1, ABSENT],
    })
    expect(res.status).toBe(400)
  })

  it('rejects an array with a duplicate id', async () => {
    const l1 = await createLecture('L1', '2024-01-01')
    await createLecture('L2', '2024-01-02')

    const res = await act(server, ada, 'project.reorderLectures', {
      projectId: physics,
      lectureOrder: [l1, l1],
    })
    expect(res.status).toBe(400)
  })

  it('accepts a genuine permutation and stores it', async () => {
    const l1 = await createLecture('L1', '2024-01-01')
    const l2 = await createLecture('L2', '2024-01-02')

    const res = await act(server, ada, 'project.reorderLectures', {
      projectId: physics,
      lectureOrder: [l1, l2],
    })
    expect(res.status).toBe(200)
    expect((await ProjectModel.findById(physics))!.lectureOrder).toEqual([
      l1,
      l2,
    ])
  })

  it('refuses an editor, who may reshape lectures but not the shelf they sit on', async () => {
    const l1 = await createLecture('L1', '2024-01-01')
    const l2 = await createLecture('L2', '2024-01-02')
    await act(server, ada, 'project.share', {
      projectId: physics,
      email: 'bob@example.com',
      role: 'editor',
    })

    const res = await act(server, bob, 'project.reorderLectures', {
      projectId: physics,
      lectureOrder: [l2, l1],
    })
    expect(res.status).toBe(403)
    expect((await ProjectModel.findById(physics))!.lectureOrder).toBeUndefined()
  })

  it('refuses a stranger', async () => {
    const l1 = await createLecture('L1', '2024-01-01')
    const res = await act(server, bob, 'project.reorderLectures', {
      projectId: physics,
      lectureOrder: [l1],
    })
    expect(res.status).toBe(403)
  })

  it('refuses an anonymous caller', async () => {
    const l1 = await createLecture('L1', '2024-01-01')
    const res = await actAnonymously(server, 'project.reorderLectures', {
      projectId: physics,
      lectureOrder: [l1],
    })
    expect(res.status).toBe(401)
  })
})

describe('deck.list honours the project’s stored order (PROJ-4)', () => {
  it('stays newest-first for a project that has never been arranged', async () => {
    const l1 = await createLecture('L1', '2024-01-01')
    const l2 = await createLecture('L2', '2024-01-03')
    const l3 = await createLecture('L3', '2024-01-02')

    const res = await act(server, ada, 'deck.list', { projectId: physics })
    expect(res.body.map((d: { id: string }) => d.id)).toEqual([l2, l3, l1])
  })

  it('returns the stored order once one has been set', async () => {
    const l1 = await createLecture('L1', '2024-01-01')
    const l2 = await createLecture('L2', '2024-01-03')
    const l3 = await createLecture('L3', '2024-01-02')
    // Deliberately not newest-first, and not creation order either.
    await act(server, ada, 'project.reorderLectures', {
      projectId: physics,
      lectureOrder: [l3, l1, l2],
    })

    const res = await act(server, ada, 'deck.list', { projectId: physics })
    expect(res.body.map((d: { id: string }) => d.id)).toEqual([l3, l1, l2])
  })

  it('puts a lecture created after the order was set first', async () => {
    const l1 = await createLecture('L1', '2024-01-01')
    const l2 = await createLecture('L2', '2024-01-02')
    await act(server, ada, 'project.reorderLectures', {
      projectId: physics,
      lectureOrder: [l1, l2],
    })

    // Imported or moved in would land here identically — both just create
    // (or re-home) a deck under this project, which is all deck.list sees.
    const l3 = await createLecture('L3', '2024-01-03')

    const res = await act(server, ada, 'deck.list', { projectId: physics })
    expect(res.body.map((d: { id: string }) => d.id)).toEqual([l3, l1, l2])
  })

  it('ignores a stored id for a lecture since deleted, without crashing', async () => {
    // Dates chosen so the stored order is NOT what newest-first would give
    // either before or after the delete — l1/l3 oldest-first here, while
    // default order is newest-first (l3, l2, l1) — so this can only pass
    // if the stored order is actually the thing being applied, not a
    // coincidence of the dates.
    const l1 = await createLecture('L1', '2024-01-01')
    const l2 = await createLecture('L2', '2024-01-02')
    const l3 = await createLecture('L3', '2024-01-03')
    await act(server, ada, 'project.reorderLectures', {
      projectId: physics,
      lectureOrder: [l1, l3, l2],
    })

    // l2 is the stale id: stored (in the middle), then deleted.
    await act(server, ada, 'deck.delete', { deckId: l2 })

    const res = await act(server, ada, 'deck.list', { projectId: physics })
    expect(res.status).toBe(200)
    // l1 before l3, matching the stored order with l2 skipped — newest-
    // first would give [l3, l1] instead.
    expect(res.body.map((d: { id: string }) => d.id)).toEqual([l1, l3])
  })

  it('restores a soft-deleted lecture to the position its id still holds', async () => {
    // The stored order is the OPPOSITE of newest-first ([l2, l1] would be
    // the default given these dates) — [l1, l2] — so the restored lecture
    // landing second only happens if the stored order is actually applied,
    // not because newest-first happens to agree.
    const l1 = await createLecture('L1', '2024-01-01')
    const l2 = await createLecture('L2', '2024-01-02')
    await act(server, ada, 'project.reorderLectures', {
      projectId: physics,
      lectureOrder: [l1, l2],
    })
    await act(server, ada, 'deck.delete', { deckId: l2 })
    // Restore is direct DB manipulation here (no restore action in scope
    // for this slice) — it stands in for whatever P-10's restore path does,
    // which is exactly "clear deletedAt".
    await DeckModel.updateOne(
      { _id: l2 },
      { $set: { deletedAt: null } },
      { timestamps: false },
    ).setOptions({ withDeleted: true })

    const res = await act(server, ada, 'deck.list', { projectId: physics })
    // l2 back in the SECOND position it always held, not promoted to
    // first the way "just restored" or "newest" would put it.
    expect(res.body.map((d: { id: string }) => d.id)).toEqual([l1, l2])
  })
})

describe('the home page sees the same order (PROJ-4)', () => {
  it('applies a project’s order within its own group of a cross-project list', async () => {
    const l1 = await createLecture('L1', '2024-01-01')
    const l2 = await createLecture('L2', '2024-01-02')
    await act(server, ada, 'project.reorderLectures', {
      projectId: physics,
      lectureOrder: [l1, l2],
    })

    const chemistry = (
      await act(server, ada, 'project.create', { title: 'Chemistry' })
    ).body.id as string
    const c1 = (
      await act(server, ada, 'deck.create', {
        projectId: chemistry,
        title: 'C1',
      })
    ).body.id as string
    await backdateDeck(c1, '2024-01-05')

    // The home page's own request: no projectId, spanning every project.
    const res = await act(server, ada, 'deck.list', {})
    expect(res.status).toBe(200)

    // Group exactly as HomePage.tsx does — preserving the order found.
    const grouped = new Map<string, string[]>()
    for (const d of res.body as { id: string; projectId: string }[]) {
      grouped.set(d.projectId, [...(grouped.get(d.projectId) ?? []), d.id])
    }
    expect(grouped.get(physics)).toEqual([l1, l2])
    expect(grouped.get(chemistry)).toEqual([c1])
  })

  it('leaves an unarranged project’s group newest-first in the same list', async () => {
    const l1 = await createLecture('L1', '2024-01-01')
    const l2 = await createLecture('L2', '2024-01-03')
    const l3 = await createLecture('L3', '2024-01-02')

    const res = await act(server, ada, 'deck.list', {})
    const grouped = new Map<string, string[]>()
    for (const d of res.body as { id: string; projectId: string }[]) {
      grouped.set(d.projectId, [...(grouped.get(d.projectId) ?? []), d.id])
    }
    expect(grouped.get(physics)).toEqual([l2, l3, l1])
  })
})

/**
 * A lecture the project owner cannot see (finding 1): deck.transferOwnership
 * hands a lecture to someone else, who can then revoke the former owner's
 * access to it — the lecture stays in the project (nothing here moves or
 * deletes it), but deck.list's per-row ACL filter hides it from the owner.
 * The permutation guard must check against exactly what the owner could
 * have been shown, not every live deck, or a lecture like this wedges every
 * future reorder with a permanent 400 — and a lecture the owner reorders
 * around must keep the position the one they cannot see already held.
 */
describe('a lecture the owner cannot see (PROJ-4, finding 1)', () => {
  it('lets the owner reorder the lectures they can see, leaving the hidden one in place', async () => {
    // Restricted: canViewAcl only grants a public deck by visibility alone,
    // so this is what makes a revoked lecture actually invisible below.
    await act(server, ada, 'project.setAccess', {
      projectId: physics,
      visibility: 'restricted',
    })
    // L2 is newest, so it would sort first by default — landing it exactly
    // where a reader who mistook "invisible" for "absent" would put it,
    // rather than somewhere the assertion below could not tell apart.
    const l1 = await createLecture('L1', '2024-01-01')
    const l3 = await createLecture('L3', '2024-01-02')
    const l2 = await createLecture('L2', '2024-01-03')

    const bobId = (await UserModel.findOne({
      email: 'bob@example.com',
    }))!._id.toString()
    await act(server, ada, 'deck.transferOwnership', {
      deckId: l2,
      userId: bobId,
    })
    // Bob now owns L2; revoking Ada's pinned editor access is his call to
    // make, and it does not touch L1, L3, or the project itself.
    const adaId = (await UserModel.findOne({
      email: 'ada@example.com',
    }))!._id.toString()
    await act(server, bob, 'deck.unshare', {
      deckId: l2,
      userId: adaId,
      role: 'editor',
    })

    // The repro from the report: every live deck is 3, but Ada's own list
    // — what any client actually has to send lectureOrder back from — is 2.
    expect(await DeckModel.countDocuments({ projectId: physics })).toBe(3)
    const list = await act(server, ada, 'deck.list', { projectId: physics })
    expect(list.body.map((d: { id: string }) => d.id).sort()).toEqual(
      [l1, l3].sort(),
    )

    // Sending back exactly what deck.list showed her — no 400.
    const res = await act(server, ada, 'project.reorderLectures', {
      projectId: physics,
      lectureOrder: [l1, l3],
    })
    expect(res.status).toBe(200)

    // L2 — never in the proposal, never even visible to Ada — keeps the
    // first position it already held rather than being dropped from the
    // stored order or bumped by the reorder around it.
    const stored = (await ProjectModel.findById(physics))!.lectureOrder
    expect(stored).toEqual([l2, l1, l3])

    // And Ada's own view reflects exactly the order she set, L2 filtered
    // out precisely because she still cannot see it.
    const after = await act(server, ada, 'deck.list', { projectId: physics })
    expect(after.body.map((d: { id: string }) => d.id)).toEqual([l1, l3])
  })

  it('still rejects a genuine non-permutation of the visible set', async () => {
    await act(server, ada, 'project.setAccess', {
      projectId: physics,
      visibility: 'restricted',
    })
    // A visible lecture too, so the sent array isn't trivially empty —
    // the point is the hidden id inside it, not the array's shape.
    await createLecture('L1', '2024-01-01')
    const l2 = await createLecture('L2', '2024-01-02')
    const bobId = (await UserModel.findOne({
      email: 'bob@example.com',
    }))!._id.toString()
    await act(server, ada, 'deck.transferOwnership', {
      deckId: l2,
      userId: bobId,
    })
    const adaId = (await UserModel.findOne({
      email: 'ada@example.com',
    }))!._id.toString()
    await act(server, bob, 'deck.unshare', {
      deckId: l2,
      userId: adaId,
      role: 'editor',
    })

    // Sending the hidden lecture's id back — something no client of Ada's
    // could ever have done honestly — is still refused, exactly as a
    // fabricated id always was.
    const res = await act(server, ada, 'project.reorderLectures', {
      projectId: physics,
      lectureOrder: [l2],
    })
    expect(res.status).toBe(400)
  })
})
