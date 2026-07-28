/**
 * Integration test for deck.reformat (GEN-4 Phase 4, mock generator). With
 * speaker roles on the segments, only student/mixed slides are regenerated;
 * lecturer-only slides are kept and hand-edited / un-backed slides protected.
 * The mock reformat appends each student turn as a "Q:" bullet. MongoDB real.
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

/** Creates a slide and its role-tagged segments. */
const makeSlide = async (
  index: number,
  fields: { title?: string; bullets?: string[]; manuallyEdited?: boolean },
  turns: { role: 'lecturer' | 'student'; text: string }[],
): Promise<string> => {
  const slide = await SlideModel.create({
    deckId,
    index,
    layoutType: 'list',
    title: fields.title,
    bullets: fields.bullets,
    manuallyEdited: fields.manuallyEdited,
  })
  for (const t of turns)
    await TranscriptSegmentModel.create({
      deckId,
      sessionId: 'rec-1',
      text: t.text,
      action: 'new',
      slideId: slide._id,
      role: t.role,
      speaker: t.role === 'lecturer' ? 1 : 2,
    })
  return slide._id.toString()
}

describe('deck.reformat', () => {
  it('reformats student/mixed slides, keeps lecturer-only, protects the rest', async () => {
    const lecturerOnly = await makeSlide(
      0,
      {
        title: 'Photosynthesis',
        bullets: ['Plants convert light to energy'],
      },
      [{ role: 'lecturer', text: 'Plants convert light to energy' }],
    )

    const mixed = await makeSlide(
      1,
      {
        title: 'Chloroplasts',
        bullets: ['Chloroplasts capture light'],
      },
      [
        { role: 'lecturer', text: 'Chloroplasts capture light' },
        { role: 'student', text: 'Is that on the exam?' },
      ],
    )

    const edited = await makeSlide(
      2,
      {
        title: 'Edited',
        bullets: ['hand written'],
        manuallyEdited: true,
      },
      [{ role: 'student', text: 'A question here' }],
    )

    // A slide with no role-tagged segments (e.g. manually added).
    const added = await SlideModel.create({
      deckId,
      index: 3,
      layoutType: 'title',
      title: 'Added by hand',
    })

    const res = await act(ada, 'deck.reformat', { deckId })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ reformatted: 1, kept: 1, protectedCount: 2 })

    // The mixed slide gained the student turn as a "Q:" bullet.
    const m = await SlideModel.findById(mixed)
    expect(m?.bullets).toEqual([
      'Chloroplasts capture light',
      'Q: Is that on the exam?',
    ])

    // Lecturer-only slide unchanged.
    const l = await SlideModel.findById(lecturerOnly)
    expect(l?.bullets).toEqual(['Plants convert light to energy'])

    // Protected slides untouched.
    expect((await SlideModel.findById(edited))?.bullets).toEqual([
      'hand written',
    ])
    expect((await SlideModel.findById(added))?.title).toBe('Added by hand')
  })

  it("403s reformatting another user's deck", async () => {
    const bob = await registerUser('bob@example.com')
    const res = await act(bob, 'deck.reformat', { deckId })
    expect(res.status).toBe(403)
  })
})
