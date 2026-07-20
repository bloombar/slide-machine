/**
 * Integration test for deck.diarize (GEN-4 Phase 3, mock diarizer). Given a
 * deck with a recording and timed transcript segments, the action time-joins
 * the mock's scripted speakers onto the segments and tags each with a speaker
 * and a lecturer/student role. MongoDB is real; DIARIZATION_PROVIDER=mock.
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
import { TranscriptSegmentModel } from '../../src/models/transcript-segment'
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
let deckId: string

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await Promise.all([UserModel.init(), DeckModel.init()])
})

afterAll(disconnectMongo)

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    ProjectModel.deleteMany({}),
    DeckModel.deleteMany({}),
    SlideModel.deleteMany({}),
    TranscriptSegmentModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  const project = await act(ada, 'project.create', { title: 'Bio 101' })
  const deck = await act(ada, 'deck.create', {
    projectId: project.body.id,
    title: 'Lecture 1',
    templateId: 'classic',
  })
  deckId = deck.body.id
})

describe('deck.diarize', () => {
  it('tags segments with speaker + role from the diarized recording', async () => {
    // One recording; the mock diarizer scripts speaker 1 (lecturer, 0–600s)
    // and speaker 2 (student, 600–620s).
    await DeckModel.updateOne(
      { _id: deckId },
      {
        $push: {
          recordings: {
            sessionId: 'rec-1',
            audioKey: 'audio/x.wav',
            sampleRate: 16_000,
            durationMs: 620_000,
            createdAt: new Date(),
          },
        },
      },
    )
    const lectured = await TranscriptSegmentModel.create({
      deckId,
      sessionId: 'rec-1',
      text: 'Photosynthesis basics',
      action: 'new',
      startMs: 0,
      endMs: 1000,
      words: [{ word: 'Photosynthesis', startMs: 0, endMs: 1000 }],
    })
    const asked = await TranscriptSegmentModel.create({
      deckId,
      sessionId: 'rec-1',
      text: 'Is that always true?',
      action: 'none',
      startMs: 600_500,
      endMs: 601_000,
      words: [{ word: 'Is', startMs: 600_500, endMs: 601_000 }],
    })

    const res = await act(ada, 'deck.diarize', { deckId })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ sessionsProcessed: 1, segmentsTagged: 2 })

    const lec = await TranscriptSegmentModel.findById(lectured._id)
    expect(lec?.speaker).toBe(1)
    expect(lec?.role).toBe('lecturer')

    const stu = await TranscriptSegmentModel.findById(asked._id)
    expect(stu?.speaker).toBe(2)
    expect(stu?.role).toBe('student')
  })

  it('is a no-op for a deck with no recordings', async () => {
    const res = await act(ada, 'deck.diarize', { deckId })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ sessionsProcessed: 0, segmentsTagged: 0 })
  })

  it("403s diarizing another user's deck", async () => {
    const bob = await registerUser('bob@example.com')
    const res = await act(bob, 'deck.diarize', { deckId })
    expect(res.status).toBe(403)
  })
})
