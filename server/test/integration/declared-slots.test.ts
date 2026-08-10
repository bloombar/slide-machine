/**
 * A lecture generated onto the boxes its template declares (GEN-11).
 *
 * The requirement's claim is that a template teaches the system what a slide
 * can hold, so this goes the whole way: a design with a maths box and a code
 * box, a spoken phrase, and a slide that comes back carrying a formula and a
 * listing in the right shapes — with the language the template chose, not one
 * the model guessed.
 *
 * And the other half of the claim, which matters more: a design that declares
 * no such box can never end up with one, whatever the model says.
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
import { TemplateModel } from '../../src/models/template'
import { RefreshTokenModel } from '../../src/models/refresh-token'

const server = createApp().listen(0)

const registerUser = async (email: string): Promise<string> => {
  const res = await request(server)
    .post('/api/auth/register')
    .send({ email, password: 'longenough1', displayName: 'Ada' })
  return res.body.accessToken as string
}

const act = (token: string, name: string, input: object = {}) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(input)

let ada: string

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await UserModel.init()
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
    TemplateModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
})

/** A lecture whose design declares exactly these boxes on its content
 * layout. Written straight to the model: what is being tested is generation,
 * not the template editor. */
const lectureWith = async (
  slots: Record<string, unknown>[],
): Promise<string> => {
  const owner = await UserModel.findOne({ email: 'ada@example.com' })
  const template = await TemplateModel.create({
    ownerId: owner!._id,
    name: 'Physics',
    permalinkSlug: `physics-${Date.now()}`,
    theme: { background: '#ffffff', text: '#111111', accent: '#0055ff' },
    layouts: [
      {
        type: 'content',
        label: 'Content',
        purpose: 'a worked example',
        slots,
        elementPositions: {},
      },
      {
        type: 'whiteboard',
        label: 'Whiteboard',
        purpose: 'a blank slate',
        slots: [],
        elementPositions: {},
      },
    ],
    visibility: 'private',
  })
  const project = await act(ada, 'project.create', { title: 'Physics' })
  const created = await act(ada, 'deck.create', {
    projectId: project.body.id,
    title: 'Motion',
    templateId: String(template._id),
  })
  // A lecture takes its project's design and pins the version it was built
  // against (TMPL-11); pointed at this one, unpinned, so generation sees the
  // boxes it declares.
  await DeckModel.updateOne(
    { _id: created.body.id },
    {
      $set: { templateId: String(template._id) },
      $unset: { templateVersionId: '' },
    },
  )
  return created.body.id as string
}

const slotsOfFirstSlide = async (deckId: string) => {
  const deck = await DeckModel.findById(deckId)
  const slide = await SlideModel.findOne({ deckId: deck!._id }).sort({
    index: 1,
  })
  return slide?.slots ?? {}
}

describe('generating onto the boxes a template declares (GEN-11)', () => {
  it('fills a maths box with a formula and a code box with a listing', async () => {
    const deckId = await lectureWith([
      { name: 'title', kind: 'text', label: 'Title' },
      { name: 'eq', kind: 'math', label: 'Equation' },
      {
        name: 'sample',
        kind: 'code',
        label: 'Sample',
        options: { language: 'python' },
      },
    ])

    await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Velocity under gravity grows with time',
    })

    const slots = await slotsOfFirstSlide(deckId)
    expect(slots.eq).toMatchObject({ kind: 'math' })
    expect(slots.sample).toMatchObject({
      kind: 'code',
      // The language is the template's decision, not the model's
      language: 'python',
    })
  })

  it('cannot put a formula on a design that declares no maths box', async () => {
    // A history template can never yield a formula, because the box it would
    // go in does not exist
    const deckId = await lectureWith([
      { name: 'title', kind: 'text', label: 'Title' },
      { name: 'body', kind: 'text', label: 'Body' },
    ])

    await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Velocity under gravity grows with time',
    })

    const slots = await slotsOfFirstSlide(deckId)
    expect(
      Object.values(slots).some(v => v.kind === 'math' || v.kind === 'code'),
    ).toBe(false)
  })

  it('holds an authored box to the limit the template set', async () => {
    const deckId = await lectureWith([
      { name: 'title', kind: 'text', label: 'Title' },
      { name: 'note', kind: 'text', label: 'Note', maxWords: 3 },
    ])

    await act(ada, 'session.phrase', {
      deckId,
      phrase: 'Velocity under gravity grows with time and distance',
    })

    const slots = await slotsOfFirstSlide(deckId)
    const note = slots.note
    expect(note?.kind).toBe('text')
    if (note?.kind === 'text') {
      expect(note.value.trim().split(/\s+/)).toHaveLength(3)
    }
  })
})
