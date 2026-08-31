/**
 * Integration tests for moving a lecture between projects (PROJ-3),
 * against a real MongoDB.
 *
 * Three things are checked, because three things could each be wrong on
 * their own:
 *
 *   - the move itself — the lecture leaves one project's listing and joins
 *     the other's, keeping its slides, template and title;
 *   - the gate — the mover must own BOTH the lecture and the project it
 *     lands in, which is the gate deck.create applies, and a destination
 *     that does not exist refuses exactly as one belonging to someone else
 *     does;
 *   - what follows it — a lecture that inherits its privacy settings
 *     (SHARE-1) starts inheriting the destination's, and one that pinned
 *     its own keeps it. That is an access change nobody asked for
 *     explicitly, so it is also what the settings-log assertion is about.
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
import { SettingsChangeLogModel } from '../../src/models/settings-change-log'
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
let adaId: string
/** Ada's two projects and the lecture that starts in the first. */
let physics: string
let chemistry: string
let deckId: string

beforeAll(async () => {
  server = startServer()
  await connectMongo(env.MONGODB_URI)
  await Promise.all([
    UserModel.init(),
    DeckModel.init(),
    SettingsChangeLogModel.init(),
  ])
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
    SettingsChangeLogModel.deleteMany({}),
  ])
  ada = await registerUser(server, 'ada@example.com')
  bob = await registerUser(server, 'bob@example.com')
  adaId = (await UserModel.findOne({
    email: 'ada@example.com',
  }))!._id.toString()
  physics = (await act(server, ada, 'project.create', { title: 'Physics' }))
    .body.id as string
  chemistry = (await act(server, ada, 'project.create', { title: 'Chemistry' }))
    .body.id as string
  deckId = (
    await act(server, ada, 'deck.create', {
      projectId: physics,
      title: 'Waves',
    })
  ).body.id as string
  // Only what each test does should show up in the settings log.
  await SettingsChangeLogModel.deleteMany({})
})

describe('deck.move (PROJ-3)', () => {
  it('files the lecture under the destination project', async () => {
    const res = await act(server, ada, 'deck.move', {
      deckId,
      projectId: chemistry,
    })
    expect(res.status).toBe(200)
    expect(res.body.projectId).toBe(chemistry)
    // Its own things came with it
    expect(res.body.title).toBe('Waves')
    expect(res.body.id).toBe(deckId)

    const stored = await DeckModel.findById(deckId)
    expect(stored!.projectId.toString()).toBe(chemistry)
  })

  it('moves the lecture between the two projects’ listings', async () => {
    await act(server, ada, 'deck.move', { deckId, projectId: chemistry })

    const from = await act(server, ada, 'deck.list', { projectId: physics })
    expect(from.body).toEqual([])
    const to = await act(server, ada, 'deck.list', { projectId: chemistry })
    expect(to.body.map((d: { id: string }) => d.id)).toEqual([deckId])
  })

  it('refuses a destination project the caller does not own', async () => {
    const bobsProject = (
      await act(server, bob, 'project.create', { title: 'Bob’s' })
    ).body.id as string

    const res = await act(server, ada, 'deck.move', {
      deckId,
      projectId: bobsProject,
    })
    expect(res.status).toBe(403)
    expect((await DeckModel.findById(deckId))!.projectId.toString()).toBe(
      physics,
    )
  })

  it('refuses a destination that does not exist, identically', async () => {
    const res = await act(server, ada, 'deck.move', {
      deckId,
      projectId: ABSENT,
    })
    expect(res.status).toBe(403)
  })

  it('refuses an editor who does not own the lecture', async () => {
    // Bob may edit the lecture's contents, and owns somewhere to put it —
    // neither makes the lecture his to move.
    await act(server, ada, 'deck.share', {
      deckId,
      email: 'bob@example.com',
      role: 'editor',
    })
    const bobsProject = (
      await act(server, bob, 'project.create', { title: 'Bob’s' })
    ).body.id as string

    const res = await act(server, bob, 'deck.move', {
      deckId,
      projectId: bobsProject,
    })
    expect(res.status).toBe(403)
  })

  it('refuses a lecture the caller cannot reach at all', async () => {
    const bobsProject = (
      await act(server, bob, 'project.create', { title: 'Bob’s' })
    ).body.id as string
    const res = await act(server, bob, 'deck.move', {
      deckId,
      projectId: bobsProject,
    })
    expect(res.status).toBe(403)
  })

  it('hands an inheriting lecture the destination project’s access', async () => {
    // Ada's address is confirmed by the helper, so her projects are public
    // by default; the destination is closed.
    await act(server, ada, 'project.setAccess', {
      projectId: chemistry,
      visibility: 'restricted',
    })

    const before = await act(server, ada, 'deck.get', { deckId })
    expect(before.body.deck.visibility).toBe('public')
    expect(before.body.deck.accessInherited).toBe(true)

    const res = await act(server, ada, 'deck.move', {
      deckId,
      projectId: chemistry,
    })
    expect(res.status).toBe(200)
    expect(res.body.visibility).toBe('restricted')
    expect(res.body.accessInherited).toBe(true)
  })

  it('leaves a lecture that pinned its own access alone', async () => {
    await act(server, ada, 'project.setAccess', {
      projectId: chemistry,
      visibility: 'restricted',
    })
    // The lecture pins public for itself, detaching from its project.
    await act(server, ada, 'deck.setAccess', { deckId, visibility: 'public' })

    const res = await act(server, ada, 'deck.move', {
      deckId,
      projectId: chemistry,
    })
    expect(res.status).toBe(200)
    expect(res.body.visibility).toBe('public')
    expect(res.body.accessInherited).toBe(false)
  })

  it('records the move, and the access that moved with it', async () => {
    await act(server, ada, 'project.setAccess', {
      projectId: chemistry,
      visibility: 'restricted',
    })
    await SettingsChangeLogModel.deleteMany({})

    await act(server, ada, 'deck.move', { deckId, projectId: chemistry })

    const entries = await SettingsChangeLogModel.find()
    expect(entries).toHaveLength(1)
    const entry = entries[0]!
    expect(entry.actorId.toString()).toBe(adaId)
    expect(entry.actorRole).toBe('owner')
    expect(entry.entityType).toBe('deck')
    expect(entry.entityId).toBe(deckId)
    expect(entry.ownerId).toBe(adaId)
    expect(entry.changes.projectId).toEqual({ from: physics, to: chemistry })
    // The lecture inherits, so the move changed its effective visibility
    // without anyone editing its sharing — the entry says so.
    expect(entry.changes.visibility).toEqual({
      from: 'public',
      to: 'restricted',
    })
  })

  it('changes and records nothing when the destination is where it already is', async () => {
    const res = await act(server, ada, 'deck.move', {
      deckId,
      projectId: physics,
    })
    expect(res.status).toBe(200)
    expect(res.body.projectId).toBe(physics)
    expect(await SettingsChangeLogModel.countDocuments()).toBe(0)
  })

  it('refuses an anonymous caller', async () => {
    const res = await actAnonymously(server, 'deck.move', {
      deckId,
      projectId: chemistry,
    })
    expect(res.status).toBe(401)
  })
})
