/**
 * Integration tests for the quiz publishing actions (QUIZ-1..4) against a
 * real MongoDB. The Google pieces are mock-backed (QUIZ_PROVIDER=mock,
 * mock publisher), so this exercises the full connect → folders → publish
 * flow, persistence on the deck, and ownership enforcement — no network.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { RefreshTokenModel } from '../../src/models/refresh-token'

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

let ada: string
let bob: string
let deckId: string

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await UserModel.init()
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
    RefreshTokenModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  bob = await registerUser('bob@example.com')
  const project = await act(ada, 'project.create', { title: 'Bio' })
  const deck = await act(ada, 'deck.create', {
    projectId: project.body.id,
    title: 'Photosynthesis',
    templateId: 'classic',
  })
  deckId = deck.body.id
  for (const phrase of [
    'Photosynthesis occurs in chloroplasts',
    'It needs sunlight, water, and carbon dioxide',
    'It produces glucose and oxygen',
  ]) {
    await act(ada, 'session.phrase', { deckId, phrase })
  }
})

describe('quiz actions', () => {
  it('starts disconnected with no quiz, and sees the lecture has a transcript', async () => {
    const res = await act(ada, 'quiz.status', { deckId })
    expect(res.status).toBe(200)
    // The three spoken phrases were appended to the deck transcript.
    expect(res.body).toEqual({ googleConnected: false, hasTranscript: true })
  })

  it('blocks folder listing and publishing until Google is connected', async () => {
    expect((await act(ada, 'quiz.driveFolders')).status).toBe(403)
    expect(
      (await act(ada, 'quiz.publish', { deckId, driveFolderId: 'root' }))
        .status,
    ).toBe(403)
  })

  it('connects, lists folders, publishes, and persists the quiz URL', async () => {
    const connect = await act(ada, 'quiz.connectGoogle')
    expect(connect.body).toEqual({ status: 'connected' })

    const folders = await act(ada, 'quiz.driveFolders')
    expect(folders.status).toBe(200)
    expect(folders.body.folders.length).toBeGreaterThan(0)
    const folder = folders.body.folders[0]

    const publish = await act(ada, 'quiz.publish', {
      deckId,
      driveFolderId: folder.id,
      driveFolderName: folder.name,
    })
    expect(publish.status).toBe(200)
    expect(publish.body.formUrl).toMatch(
      /^https:\/\/docs\.google\.com\/forms\/d\/e\/mock-[0-9a-f]+\/viewform$/,
    )
    expect(publish.body.driveFolderName).toBe(folder.name)

    // The URL persists and comes back from status
    const status = await act(ada, 'quiz.status', { deckId })
    expect(status.body.googleConnected).toBe(true)
    expect(status.body.quiz.formUrl).toBe(publish.body.formUrl)
  })

  it('creates a new destination folder (mock)', async () => {
    await act(ada, 'quiz.connectGoogle')
    const res = await act(ada, 'quiz.createFolder', { name: 'Week 5' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: 'folder-week-5', name: 'Week 5' })
  })

  it('rejects folder creation until Google is connected', async () => {
    expect((await act(ada, 'quiz.createFolder', { name: 'X' })).status).toBe(
      403,
    )
  })

  it('navigates into a sub-folder (mock finder tree)', async () => {
    await act(ada, 'quiz.connectGoogle')
    const root = await act(ada, 'quiz.driveFolders')
    expect(root.body.folders).toContainEqual({
      id: 'folder-lectures',
      name: 'Lectures',
    })
    const sub = await act(ada, 'quiz.driveFolders', {
      parentId: 'folder-lectures',
    })
    expect(sub.body.folders).toEqual([{ id: 'folder-week1', name: 'Week 1' }])
  })

  it('regenerating avoids the prior questions, yielding a different quiz', async () => {
    await act(ada, 'quiz.connectGoogle')
    const first = await act(ada, 'quiz.publish', {
      deckId,
      driveFolderId: 'root',
    })
    // Republishing over the existing quiz steers clear of its questions, so
    // the fabricated URL (derived from quiz content) changes (QUIZ-6).
    const second = await act(ada, 'quiz.publish', {
      deckId,
      driveFolderId: 'root',
    })
    expect(second.body.formUrl).not.toBe(first.body.formUrl)
  })

  it('includes the spoken transcript in generation when asked', async () => {
    await act(ada, 'quiz.connectGoogle')
    const withoutTx = await act(ada, 'quiz.publish', {
      deckId,
      driveFolderId: 'root',
    })
    // A fresh deck to compare against, quizzed WITH the transcript folded in.
    const project = await act(ada, 'project.create', { title: 'Bio2' })
    const d2 = await act(ada, 'deck.create', {
      projectId: project.body.id,
      title: 'Photosynthesis',
      templateId: 'classic',
    })
    for (const phrase of [
      'Photosynthesis occurs in chloroplasts',
      'It needs sunlight, water, and carbon dioxide',
      'It produces glucose and oxygen',
    ]) {
      await act(ada, 'session.phrase', { deckId: d2.body.id, phrase })
    }
    const withTx = await act(ada, 'quiz.publish', {
      deckId: d2.body.id,
      driveFolderId: 'root',
      includeTranscript: true,
    })
    // The transcript adds source material, so the generated Form differs.
    expect(withTx.body.formUrl).not.toBe(withoutTx.body.formUrl)
  })

  it('deletes the quiz and forgets it, and regeneration differs afterwards', async () => {
    await act(ada, 'quiz.connectGoogle')
    const first = await act(ada, 'quiz.publish', {
      deckId,
      driveFolderId: 'root',
    })
    const del = await act(ada, 'quiz.delete', { deckId })
    expect(del.status).toBe(200)
    expect(del.body).toEqual({ deleted: true })

    // Status no longer reports a quiz.
    const status = await act(ada, 'quiz.status', { deckId })
    expect(status.body.quiz).toBeUndefined()

    // Deleting again is a no-op.
    expect((await act(ada, 'quiz.delete', { deckId })).body).toEqual({
      deleted: false,
    })

    // Regenerating avoids the deleted quiz's questions → a different Form.
    const again = await act(ada, 'quiz.publish', {
      deckId,
      driveFolderId: 'root',
    })
    expect(again.body.formUrl).not.toBe(first.body.formUrl)
  })

  it('forbids a non-owner from deleting the quiz', async () => {
    await act(ada, 'quiz.connectGoogle')
    await act(ada, 'quiz.publish', { deckId, driveFolderId: 'root' })
    expect((await act(bob, 'quiz.delete', { deckId })).status).toBe(403)
  })

  it('rejects a token whose account has been removed', async () => {
    await UserModel.deleteMany({ email: 'ada@example.com' })
    expect((await act(ada, 'quiz.connectGoogle')).status).toBe(403)
  })

  it('forbids a non-owner from viewing or publishing the quiz', async () => {
    await act(ada, 'quiz.connectGoogle')
    expect((await act(bob, 'quiz.status', { deckId })).status).toBe(403)
    await act(bob, 'quiz.connectGoogle')
    expect(
      (await act(bob, 'quiz.publish', { deckId, driveFolderId: 'root' }))
        .status,
    ).toBe(403)
  })
})
