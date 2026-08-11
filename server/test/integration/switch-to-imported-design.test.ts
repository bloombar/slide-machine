/**
 * Applying an imported design to a lecture that already has slides (TMPL-8).
 *
 * This is the case a template switch could not previously survive. An imported
 * design names its layouts after whatever its slides turned out to be — there
 * is no `content` and no `list` to match on — so the lecture's slides were left
 * pointing at layout types the new design has never heard of, holding content
 * under box names it does not declare. The lecture went blank.
 *
 * What is asserted here is the promise the switch makes: every slide lands on
 * a layout the new design actually has, its content arrives in the boxes that
 * design draws, and nothing is deleted on the way.
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
import { TemplateVersionModel } from '../../src/models/template-version'
import { RefreshTokenModel } from '../../src/models/refresh-token'

const server = createApp().listen(0)

const act = (token: string, name: string, input: object = {}) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(input)

let ada: string
let projectId: string
let deckId: string

beforeAll(async () => {
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
    TemplateModel.deleteMany({}),
    TemplateVersionModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  const res = await request(server).post('/api/auth/register').send({
    email: 'ada@example.com',
    password: 'longenough1',
    displayName: 'Ada',
  })
  ada = res.body.accessToken as string
  const project = await act(ada, 'project.create', { title: 'Hydrology' })
  projectId = project.body.id as string
  const deck = await act(ada, 'deck.create', {
    projectId,
    title: 'Runoff',
    templateId: 'classic',
  })
  deckId = deck.body.id as string
})

/**
 * A design of the shape an import produces: its layouts named after what its
 * slides were, its boxes named by the same pass. Nothing here shares a name
 * with the built-in `classic` the lecture starts on.
 */
const importedDesign = async (): Promise<string> => {
  const owner = await UserModel.findOne({ email: 'ada@example.com' })
  const template = await TemplateModel.create({
    ownerId: owner!._id,
    name: 'Imported deck',
    permalinkSlug: `imported-${Date.now()}`,
    theme: { background: '#0d1a66', text: '#ffffff', accent: '#ffcc00' },
    layouts: [
      {
        type: 'cover',
        label: 'Cover',
        purpose: 'opens the deck',
        slots: [{ name: 'heading', kind: 'text', label: 'Heading' }],
        elementPositions: {
          heading: { x: 0.1, y: 0.4, w: 0.8, h: 0.2, textStyle: 'title' },
        },
      },
      {
        type: 'statement-and-detail',
        label: 'Statement and detail',
        purpose: 'a point with its explanation',
        slots: [
          { name: 'heading', kind: 'text', label: 'Heading' },
          { name: 'detail', kind: 'text', label: 'Detail' },
        ],
        elementPositions: {
          heading: { x: 0.08, y: 0.1, w: 0.84, h: 0.2, textStyle: 'title' },
          detail: { x: 0.08, y: 0.35, w: 0.84, h: 0.5, textStyle: 'body' },
        },
      },
      {
        type: 'points',
        label: 'Points',
        purpose: 'a list of points',
        slots: [
          { name: 'heading', kind: 'text', label: 'Heading' },
          { name: 'items', kind: 'bullets', label: 'Items' },
        ],
        elementPositions: {
          heading: { x: 0.08, y: 0.1, w: 0.84, h: 0.2, textStyle: 'title' },
          items: { x: 0.08, y: 0.35, w: 0.84, h: 0.5, textStyle: 'bullet' },
        },
      },
    ],
    visibility: 'private',
  })
  return String(template._id)
}

/** The lecture's slides, in order, as they are stored. */
const slidesOfDeck = async () => {
  const deck = await DeckModel.findById(deckId)
  return SlideModel.find({ deckId: deck!._id }).sort({ index: 1 })
}

/** A slide on the lecture's current design, holding exactly this content. */
const addSlide = async (layoutType: string, content: object = {}) => {
  const added = await act(ada, 'slide.add', { deckId, layoutType })
  expect(added.status).toBe(200)
  const slideId = added.body.id as string
  if (Object.keys(content).length) {
    // `slide.add` seeds editable starter text; replace it with the content
    // this test is actually about.
    const edited = await act(ada, 'slide.editContent', { slideId, ...content })
    expect(edited.status).toBe(200)
  }
  return slideId
}

describe('switching a lecture onto an imported design', () => {
  it('moves every slide onto a layout the new design actually has', async () => {
    await addSlide('content', { title: 'Runoff', body: 'Water off a roof' })
    await addSlide('list', { title: 'Sources', bullets: ['Roofs', 'Roads'] })

    const templateId = await importedDesign()
    const switched = await act(ada, 'deck.switchTemplate', {
      deckId,
      templateId,
    })
    expect(switched.status).toBe(200)

    const slides = await slidesOfDeck()
    const types = slides.map(s => s.layoutType)
    // Not one of them is still on a layout the imported design never declared
    expect(types).not.toContain('content')
    expect(types).not.toContain('list')
    expect(
      types.every(t => ['cover', 'statement-and-detail', 'points'].includes(t)),
    ).toBe(true)
  })

  it('carries the words into the boxes the new design draws', async () => {
    await addSlide('content', { title: 'Runoff', body: 'Water off a roof' })

    const templateId = await importedDesign()
    await act(ada, 'deck.switchTemplate', { deckId, templateId })

    const [slide] = await slidesOfDeck()
    expect(slide!.layoutType).toBe('statement-and-detail')
    expect(slide!.slots?.heading).toMatchObject({
      kind: 'text',
      value: 'Runoff',
    })
    expect(slide!.slots?.detail).toMatchObject({
      kind: 'text',
      value: 'Water off a roof',
    })
  })

  it('keeps a list a list', async () => {
    // Pairing is on what a box holds, not on its name: bullets must not land
    // in a prose box just because it was declared next
    await addSlide('list', { title: 'Sources', bullets: ['Roofs', 'Roads'] })

    const templateId = await importedDesign()
    await act(ada, 'deck.switchTemplate', { deckId, templateId })

    const [slide] = await slidesOfDeck()
    expect(slide!.layoutType).toBe('points')
    expect(slide!.slots?.items).toMatchObject({
      kind: 'bullets',
      items: ['Roofs', 'Roads'],
    })
  })

  it('puts a slide holding only a heading on the cover layout', async () => {
    // Empty boxes do not vote for a bigger layout
    await addSlide('content', { title: 'Runoff', body: '' })

    const templateId = await importedDesign()
    await act(ada, 'deck.switchTemplate', { deckId, templateId })

    const [slide] = await slidesOfDeck()
    expect(slide!.layoutType).toBe('cover')
    expect(slide!.slots?.heading).toMatchObject({ value: 'Runoff' })
  })

  it('leaves content the new design cannot place on the slide', async () => {
    // Nothing is deleted by a switch: switching back finds it, and the GEN-9
    // re-fit reads it as source material for the boxes the move left empty
    await addSlide('title', { title: 'Runoff', body: '', caption: 'Fig. 1' })

    const templateId = await importedDesign()
    await act(ada, 'deck.switchTemplate', { deckId, templateId })

    const [slide] = await slidesOfDeck()
    const kept = Object.values(slide!.slots ?? {}).some(
      value => value.kind === 'text' && value.value === 'Fig. 1',
    )
    expect(kept).toBe(true)
  })

  it('is reversible: switching back restores the lecture’s own boxes', async () => {
    await addSlide('content', { title: 'Runoff', body: 'Water off a roof' })

    const templateId = await importedDesign()
    await act(ada, 'deck.switchTemplate', { deckId, templateId })
    await act(ada, 'deck.switchTemplate', { deckId, templateId: 'classic' })

    const [slide] = await slidesOfDeck()
    expect(slide!.layoutType).toBe('content')
    expect(slide!.slots?.title).toMatchObject({ value: 'Runoff' })
    expect(slide!.slots?.body).toMatchObject({ value: 'Water off a roof' })
  })

  it('leaves a whiteboard slide alone', async () => {
    // It has no boxes to pair and its layout is not one a design declares
    await addSlide('content', { title: 'Runoff', body: 'Water off a roof' })
    await addSlide('whiteboard')

    const templateId = await importedDesign()
    await act(ada, 'deck.switchTemplate', { deckId, templateId })

    const slides = await slidesOfDeck()
    expect(slides[1]!.layoutType).toBe('whiteboard')
  })
})
