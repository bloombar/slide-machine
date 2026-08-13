/**
 * Round-trip import of a template file (EXP-3), against a real MongoDB.
 *
 * The parser is covered by src/lib/template-import.test.ts. This is the action
 * around it: who may call it, what it saves, and the two properties EXP-3
 * states outright — that a template exported and imported back is materially
 * the same template, and that anything unresolvable refuses the import rather
 * than substituting a design nobody asked for.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'

const { env } = await import('../../src/config/env')
const { connectMongo, disconnectMongo } = await import('../../src/db/mongoose')
const { createApp } = await import('../../src/app')
const { UserModel } = await import('../../src/models/user')
const { TemplateModel } = await import('../../src/models/template')
const { RefreshTokenModel } = await import('../../src/models/refresh-token')

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
let grace: string

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
    TemplateModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  grace = await registerUser('grace@example.com')
})

/** A design of Ada's, exported to the YAML the importer consumes. */
const exportedDesign = async (over: object = {}): Promise<string> => {
  const created = await TemplateModel.create({
    ownerId: (await UserModel.findOne({ email: 'ada@example.com' }))!.id,
    name: 'Seminar',
    permalinkSlug: 'seminar-fixture',
    renderMode: 'positioned',
    theme: { background: '#0b1020', text: '#f8fafc', accent: '#38bdf8' },
    layouts: [
      {
        type: 'title',
        label: 'Title',
        purpose: 'Opening slide',
        slots: [
          {
            name: 'title',
            kind: 'text',
            label: 'Title',
            description: 'The seminar’s name.',
            maxChars: 60,
          },
        ],
        elementPositions: {
          title: { x: 0.08, y: 0.4, w: 0.84, h: 0.2, fontSize: 7 },
        },
        decoration: [{ x: 0, y: 0, w: 1, h: 0.08, fill: '#38bdf8' }],
      },
      {
        type: 'whiteboard',
        label: 'Whiteboard',
        purpose: 'A blank slate for freehand drawing',
        slots: [],
        elementPositions: {},
      },
    ],
    visibility: 'public',
    ...over,
  })
  const res = await act(ada, 'template.export', { templateId: created.id })
  return Buffer.from(res.body.contentBase64, 'base64').toString('utf8')
}

describe('template.import (EXP-3)', () => {
  it('refuses a caller who is not signed in', async () => {
    const res = await request(server)
      .post('/api/actions/template.import')
      .send({ content: 'version: 1\nkind: template\n' })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it('brings back a template exported from this app', async () => {
    const content = await exportedDesign()
    const res = await act(ada, 'template.import', { content })
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('Seminar')
  })

  it('brings back the same design, which is the guarantee EXP-3 makes', async () => {
    const content = await exportedDesign()
    const { body } = await act(ada, 'template.import', { content })
    const title = body.layouts.find(
      (l: { type: string }) => l.type === 'title',
    )!
    expect(body.theme).toMatchObject({
      background: '#0b1020',
      accent: '#38bdf8',
    })
    expect(title.elementPositions.title).toMatchObject({ x: 0.08, fontSize: 7 })
    expect(title.slots[0]).toMatchObject({
      kind: 'text',
      description: 'The seminar’s name.',
      maxChars: 60,
    })
    // The band behind the title — part of the design, and the thing the
    // exporter used to leave out entirely
    expect(title.decoration).toEqual([
      { x: 0, y: 0, w: 1, h: 0.08, fill: '#38bdf8' },
    ])
  })

  it('is a new template of the importer’s own, not a second copy of the first', async () => {
    const content = await exportedDesign()
    const { body } = await act(grace, 'template.import', { content })
    const source = await TemplateModel.findOne({
      permalinkSlug: 'seminar-fixture',
    })
    expect(body.id).not.toBe(source!.id)
    const stored = await TemplateModel.findById(body.id)
    expect(stored!.ownerId.toString()).toBe(
      (await UserModel.findOne({ email: 'grace@example.com' }))!.id,
    )
  })

  it('arrives private, whatever the file said', async () => {
    // The fixture is public; publishing someone else's design on their behalf
    // is not a thing to do silently
    const content = await exportedDesign()
    const { body } = await act(grace, 'template.import', { content })
    expect(body.visibility).toBe('private')
  })

  it('shows up in the importer’s library and nobody else’s', async () => {
    const content = await exportedDesign()
    const { body } = await act(grace, 'template.import', { content })
    const mine = await act(grace, 'template.list')
    expect(mine.body.some((t: { id: string }) => t.id === body.id)).toBe(true)
    const theirs = await act(ada, 'template.list')
    expect(theirs.body.some((t: { id: string }) => t.id === body.id)).toBe(
      false,
    )
  })

  it('takes a name from the caller when they gave one', async () => {
    const content = await exportedDesign()
    const { body } = await act(ada, 'template.import', {
      content,
      name: 'Seminar, revised',
    })
    expect(body.name).toBe('Seminar, revised')
  })

  it('can be run twice without the two colliding', async () => {
    const content = await exportedDesign()
    const first = await act(ada, 'template.import', { content })
    const second = await act(ada, 'template.import', { content })
    expect(first.body.id).not.toBe(second.body.id)
    expect(first.body.permalinkSlug).not.toBe(second.body.permalinkSlug)
  })
})

describe('a file template.import will not accept', () => {
  it('lists what is wrong rather than failing vaguely', async () => {
    const res = await act(ada, 'template.import', {
      content: 'version: 1\nkind: template\n',
    })
    expect(res.status).toBe(400)
    expect(JSON.stringify(res.body)).toMatch(/name/)
  })

  it('creates nothing when it refuses', async () => {
    // EXP-3: import validates and reports without partial-corrupting anything
    const before = await TemplateModel.countDocuments({})
    await act(ada, 'template.import', { content: 'not: [a, template' })
    expect(await TemplateModel.countDocuments({})).toBe(before)
  })

  it('refuses a deck export, which is a different document', async () => {
    const res = await act(ada, 'template.import', {
      content: 'version: 1\nkind: deck\ntitle: Week 1\nslides: []\n',
    })
    expect(res.status).toBe(400)
  })

  it('refuses rather than substituting a design the user did not ask for', async () => {
    // The distinction EXP-3 draws between the two directions: a deck import
    // falls back to a default template and warns, a template import cannot
    const res = await act(ada, 'template.import', {
      content:
        'version: 1\nkind: template\nname: Broken\ntheme: {}\nlayouts: []\n',
    })
    expect(res.status).toBe(400)
    expect(await TemplateModel.countDocuments({ name: 'Broken' })).toBe(0)
  })
})
