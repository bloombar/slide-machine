/**
 * Integration tests for the quiz publishing actions (QUIZ-1..4) against a
 * real MongoDB. The Google pieces are mock-backed (QUIZ_PROVIDER=mock,
 * mock publisher), so this exercises the full connect → folders → publish
 * flow, persistence on the deck, and ownership enforcement — no network.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from 'vitest'
import request from 'supertest'

// Hermetic: a developer's local EXPORT_MODE=live must not leak in. The folder
// listing refuses whenever *either* Google surface is live, because the id it
// returns would then have to be a real one — so the modes are pinned here
// rather than inherited from whatever .env happens to say.
vi.mock('../../src/config/env', async importActual => {
  const actual = await importActual<typeof import('../../src/config/env')>()
  return {
    ...actual,
    env: { ...actual.env, EXPORT_MODE: 'mock', QUIZ_PUBLISH_MODE: 'mock' },
  }
})

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

  // Being invited to edit one lecture is not being invited to edit the
  // course it sits in: the publish succeeds, but the options are not
  // remembered as defaults for every other lecture in the project (QUIZ-2).
  it('does not let a lecture editor rewrite the course quiz defaults', async () => {
    await act(ada, 'deck.share', {
      deckId,
      email: 'bob@example.com',
      role: 'editor',
    })
    await act(bob, 'quiz.connectGoogle')
    const publish = await act(bob, 'quiz.publish', {
      deckId,
      driveFolderId: 'root',
      questionCount: 7,
    })
    expect(publish.status).toBe(200)

    const project = await ProjectModel.findById(
      (await DeckModel.findById(deckId))!.projectId,
    )
    expect(project!.quizDefaults).toBeUndefined()
  })

  it('remembers the owner’s options as the course defaults', async () => {
    await act(ada, 'quiz.connectGoogle')
    const publish = await act(ada, 'quiz.publish', {
      deckId,
      driveFolderId: 'root',
      questionCount: 7,
    })
    expect(publish.status).toBe(200)

    const project = await ProjectModel.findById(
      (await DeckModel.findById(deckId))!.projectId,
    )
    expect(project!.quizDefaults?.questionCount).toBe(7)
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

  it('threads generation options: per-type counts set the question count', async () => {
    await act(ada, 'quiz.connectGoogle')
    const res = await act(ada, 'quiz.publish', {
      deckId,
      driveFolderId: 'root',
      typeCounts: { single_choice: 1, short_text: 2 },
    })
    expect(res.status).toBe(200)
    const deck = await DeckModel.findById(deckId)
    // The per-type total (3) is the number of questions generated + stored.
    expect(deck!.quiz!.questions).toHaveLength(3)
  })

  it('accepts all advanced options without error', async () => {
    await act(ada, 'quiz.connectGoogle')
    const res = await act(ada, 'quiz.publish', {
      deckId,
      driveFolderId: 'root',
      questionCount: 2,
      totalPoints: 6,
      emailCollection: 'none',
      customInstructions: 'focus on the light reactions',
      includeTranscript: true,
    })
    expect(res.status).toBe(200)
    expect(res.body.formUrl).toMatch(/forms/)
  })

  it('previews questions, publishes reviewed points, and remembers project defaults (QUIZ-2)', async () => {
    await act(ada, 'quiz.connectGoogle')
    // Preview: generate the questions without publishing.
    const gen = await act(ada, 'quiz.generate', {
      deckId,
      questionCount: 2,
      totalPoints: 10,
    })
    expect(gen.status).toBe(200)
    expect(gen.body.questions.length).toBeGreaterThan(0)

    // Publish the reviewed questions with per-question point overrides.
    const reviewed = gen.body.questions.map(
      (q: { points?: number }, i: number) => ({
        ...q,
        points: i === 0 ? 7 : 3,
      }),
    )
    const pub = await act(ada, 'quiz.publish', {
      deckId,
      driveFolderId: 'root',
      questionCount: 2,
      totalPoints: 10,
      emailCollection: 'responder_input',
      questions: reviewed,
    })
    expect(pub.status).toBe(200)
    expect(pub.body.formUrl).toMatch(/forms/)

    // The used options are remembered on the project and returned by status.
    const status = await act(ada, 'quiz.status', { deckId })
    expect(status.body.defaults).toMatchObject({
      questionCount: 2,
      totalPoints: 10,
      emailCollection: 'responder_input',
    })
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
