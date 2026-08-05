/**
 * Integration tests for the style-template actions (TMPL-1 library, TMPL-4
 * custom templates) against a real MongoDB. Covers the library a user sees,
 * duplicating as the way a template is created, editing and deleting one you
 * authored, the read-only built-ins, ownership, and the fact that a template
 * stored in the database is interchangeable with one shipped as a file
 * everywhere a template is resolved.
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
import { listBuiltinTemplates } from '../../src/templates/builtin'
import { deleteUserCascade } from '../../src/lib/cascade'

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

/** The first template the deployment ships; never named literally, so this
 * suite keeps passing if the starter set is replaced. */
const builtinId = (): string => listBuiltinTemplates()[0]!.id

let ada: string
let bob: string

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
    TemplateModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  bob = await registerUser('bob@example.com')
})

describe('template.list (TMPL-1)', () => {
  it('offers the built-in library to a signed-in user', async () => {
    const res = await act(ada, 'template.list')
    expect(res.status).toBe(200)
    const ids = res.body.map((t: { id: string }) => t.id)
    for (const builtin of listBuiltinTemplates()) {
      expect(ids).toContain(builtin.id)
    }
  })

  it('every template carries a whiteboard layout (TMPL-7)', async () => {
    const res = await act(ada, 'template.list')
    for (const template of res.body as { layouts: { type: string }[] }[]) {
      expect(template.layouts.some(l => l.type === 'whiteboard')).toBe(true)
    }
  })

  it("lists the caller's own templates ahead of the built-ins", async () => {
    await act(ada, 'template.duplicate', {
      templateId: builtinId(),
      name: 'Ada Style',
    })
    const res = await act(ada, 'template.list')
    expect(res.body[0].name).toBe('Ada Style')
    expect(res.body[0].ownerId).not.toBe('system')
  })

  it("does not show one user's templates to another", async () => {
    await act(ada, 'template.duplicate', {
      templateId: builtinId(),
      name: 'Ada Style',
    })
    const res = await act(bob, 'template.list')
    expect(res.body.map((t: { name: string }) => t.name)).not.toContain(
      'Ada Style',
    )
  })
})

describe('template.duplicate (TMPL-4)', () => {
  it('copies a built-in into the caller library, theme and layouts intact', async () => {
    const source = listBuiltinTemplates()[0]!
    const res = await act(ada, 'template.duplicate', {
      templateId: source.id,
      name: 'My Style',
    })
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('My Style')
    expect(res.body.theme).toEqual(source.theme)
    expect(res.body.layouts).toHaveLength(source.layouts.length)
    // Its own template, private until shared
    expect(res.body.visibility).toBe('private')
  })

  it('keeps the source name when none is given', async () => {
    const source = listBuiltinTemplates()[0]!
    const res = await act(ada, 'template.duplicate', { templateId: source.id })
    expect(res.body.name).toBe(source.name)
  })

  it('can duplicate a template the caller already authored', async () => {
    const first = await act(ada, 'template.duplicate', {
      templateId: builtinId(),
      name: 'One',
    })
    const second = await act(ada, 'template.duplicate', {
      templateId: first.body.id,
      name: 'Two',
    })
    expect(second.status).toBe(200)
    expect(second.body.id).not.toBe(first.body.id)
  })

  it("refuses someone else's private template as a source", async () => {
    const ownd = await act(ada, 'template.duplicate', {
      templateId: builtinId(),
      name: 'Ada Style',
    })
    expect(
      (await act(bob, 'template.duplicate', { templateId: ownd.body.id }))
        .status,
    ).toBe(403)
  })

  it('rejects an unknown template', async () => {
    expect(
      (await act(ada, 'template.duplicate', { templateId: 'nope' })).status,
    ).toBe(400)
  })

  it('requires authentication', async () => {
    const res = await request(server)
      .post('/api/actions/template.duplicate')
      .send({ templateId: builtinId() })
    expect(res.status).toBe(401)
  })
})

describe('template.update (TMPL-4)', () => {
  const own = async () =>
    (
      await act(ada, 'template.duplicate', {
        templateId: builtinId(),
        name: 'Mine',
      })
    ).body

  it('renames, rethemes and retunes a layout', async () => {
    const template = await own()
    const layouts = template.layouts.map(
      (l: { type: string; label: string }) =>
        l.type === 'content'
          ? { ...l, label: 'Main', purpose: 'Body text' }
          : l,
    )
    const res = await act(ada, 'template.update', {
      templateId: template.id,
      name: 'Renamed',
      theme: { ...template.theme, accent: '#123456' },
      layouts,
    })
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('Renamed')
    expect(res.body.theme.accent).toBe('#123456')
    expect(
      res.body.layouts.find((l: { type: string }) => l.type === 'content')
        .label,
    ).toBe('Main')
  })

  it('refuses to save a template without a whiteboard layout (TMPL-7)', async () => {
    const template = await own()
    const res = await act(ada, 'template.update', {
      templateId: template.id,
      name: template.name,
      theme: template.theme,
      layouts: template.layouts.filter(
        (l: { type: string }) => l.type !== 'whiteboard',
      ),
    })
    expect(res.status).toBe(400)
  })

  it('refuses to edit a built-in', async () => {
    const source = listBuiltinTemplates()[0]!
    const res = await act(ada, 'template.update', {
      templateId: source.id,
      name: 'Hijacked',
      theme: source.theme,
      layouts: source.layouts,
    })
    expect(res.status).toBe(400)
  })

  it("refuses to edit someone else's template", async () => {
    const template = await own()
    const res = await act(bob, 'template.update', {
      templateId: template.id,
      name: 'Theirs',
      theme: template.theme,
      layouts: template.layouts,
    })
    expect(res.status).toBe(403)
  })
})

describe('arrangement (TMPL-4 positioning)', () => {
  const own = async () =>
    (await act(ada, 'template.duplicate', { templateId: builtinId() })).body

  /** The same layout with its slots positioned. */
  const arrange = (template: {
    layouts: { type: string; slots: { name: string }[] }[]
  }) =>
    template.layouts.map(l =>
      l.type === 'content'
        ? {
            ...l,
            elementPositions: Object.fromEntries(
              l.slots.map((s, i) => [
                s.name,
                { x: 10, y: 10 + i * 30, w: 80, h: 25 },
              ]),
            ),
          }
        : l,
    )

  it('saves where each slot sits, and gives it back', async () => {
    const template = await own()
    const res = await act(ada, 'template.update', {
      templateId: template.id,
      name: template.name,
      theme: template.theme,
      layouts: arrange(template),
    })
    expect(res.status).toBe(200)
    const content = res.body.layouts.find(
      (l: { type: string }) => l.type === 'content',
    )
    expect(content.elementPositions.title).toEqual({
      x: 10,
      y: 10,
      w: 80,
      h: 25,
    })
  })

  it('refuses a box that runs off the slide', async () => {
    const template = await own()
    const layouts = template.layouts.map((l: { type: string }) =>
      l.type === 'content'
        ? { ...l, elementPositions: { title: { x: 60, y: 10, w: 80, h: 20 } } }
        : l,
    )
    const res = await act(ada, 'template.update', {
      templateId: template.id,
      name: template.name,
      theme: template.theme,
      layouts,
    })
    expect(res.status).toBe(400)
  })

  it('refuses a box for a slot the layout does not have', async () => {
    const template = await own()
    const layouts = template.layouts.map((l: { type: string }) =>
      l.type === 'content'
        ? { ...l, elementPositions: { nope: { x: 0, y: 0, w: 10, h: 10 } } }
        : l,
    )
    const res = await act(ada, 'template.update', {
      templateId: template.id,
      name: template.name,
      theme: template.theme,
      layouts,
    })
    expect(res.status).toBe(400)
  })

  it('reaches the viewer, so a lecture is drawn from the arrangement', async () => {
    const template = await own()
    await act(ada, 'template.update', {
      templateId: template.id,
      name: template.name,
      theme: template.theme,
      layouts: arrange(template),
    })
    const project = await act(ada, 'project.create', { title: 'Physics' })
    await act(ada, 'project.switchTemplate', {
      projectId: project.body.id,
      templateId: template.id,
    })
    const deck = await act(ada, 'deck.create', { projectId: project.body.id })
    const view = await act(ada, 'deck.get', { deckId: deck.body.id })
    const content = view.body.template.layouts.find(
      (l: { type: string }) => l.type === 'content',
    )
    expect(Object.keys(content.elementPositions).length).toBeGreaterThan(0)
  })
})

describe('template.delete (TMPL-4)', () => {
  it('removes it from the library', async () => {
    const template = (
      await act(ada, 'template.duplicate', {
        templateId: builtinId(),
        name: 'Doomed',
      })
    ).body
    expect(
      (await act(ada, 'template.delete', { templateId: template.id })).status,
    ).toBe(200)
    const list = await act(ada, 'template.list')
    expect(list.body.map((t: { id: string }) => t.id)).not.toContain(
      template.id,
    )
  })

  it('refuses to delete a built-in', async () => {
    expect(
      (await act(ada, 'template.delete', { templateId: builtinId() })).status,
    ).toBe(400)
  })

  it("refuses to delete someone else's", async () => {
    const template = (
      await act(ada, 'template.duplicate', { templateId: builtinId() })
    ).body
    expect(
      (await act(bob, 'template.delete', { templateId: template.id })).status,
    ).toBe(403)
  })

  it('tombstones the templates of a deleted account (P-10)', async () => {
    const template = (
      await act(ada, 'template.duplicate', { templateId: builtinId() })
    ).body
    const adaUser = await UserModel.findOne({ email: 'ada@example.com' })
    await deleteUserCascade(adaUser!._id.toString())
    expect(await TemplateModel.findById(template.id)).toBeNull()
  })
})

describe('a stored template behaves like a built-in', () => {
  it('a project and its lectures can use one', async () => {
    const template = (
      await act(ada, 'template.duplicate', {
        templateId: builtinId(),
        name: 'Course Style',
      })
    ).body
    const project = await act(ada, 'project.create', { title: 'Physics' })
    expect(
      (
        await act(ada, 'project.switchTemplate', {
          projectId: project.body.id,
          templateId: template.id,
        })
      ).status,
    ).toBe(200)

    const deck = await act(ada, 'deck.create', {
      projectId: project.body.id,
      title: 'Waves',
      templateId: template.id,
    })
    expect(deck.status).toBe(200)
    // The viewer resolves it the same way it resolves a built-in
    const view = await act(ada, 'deck.get', { deckId: deck.body.id })
    expect(view.status).toBe(200)
    expect(view.body.template.name).toBe('Course Style')
  })

  it('exports to YAML like a built-in does (EXP-2)', async () => {
    const template = (
      await act(ada, 'template.duplicate', {
        templateId: builtinId(),
        name: 'Exportable',
      })
    ).body
    const res = await act(ada, 'template.export', { templateId: template.id })
    expect(res.status).toBe(200)
    expect(res.body.fileName).toBe('exportable.template.yaml')
    const yaml = Buffer.from(res.body.contentBase64, 'base64').toString('utf8')
    expect(yaml).toContain('Exportable')
  })

  it('a deck whose template was deleted still opens, in the default style', async () => {
    const template = (
      await act(ada, 'template.duplicate', { templateId: builtinId() })
    ).body
    const project = await act(ada, 'project.create', { title: 'Physics' })
    // A lecture takes its project's template, so switch the project first —
    // deck.create does not accept one directly.
    await act(ada, 'project.switchTemplate', {
      projectId: project.body.id,
      templateId: template.id,
    })
    const deck = await act(ada, 'deck.create', { projectId: project.body.id })
    expect(
      (await act(ada, 'deck.get', { deckId: deck.body.id })).body.template.id,
    ).toBe(template.id)

    expect(
      (await act(ada, 'template.delete', { templateId: template.id })).status,
    ).toBe(200)

    // Deleting your own template must not make a lecture unopenable. The deck
    // keeps its templateId, so a restore brings the look back; until then it
    // renders in the deployment default.
    const view = await act(ada, 'deck.get', { deckId: deck.body.id })
    expect(view.status).toBe(200)
    expect(view.body.template.id).toBe(builtinId())
    const stored = await DeckModel.findById(deck.body.id)
    expect(stored!.templateId).toBe(template.id)
  })
})
