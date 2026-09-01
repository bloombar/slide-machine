/**
 * Integration tests for the account-level default design (TMPL-24) against a
 * real MongoDB: the deployment's default an account starts on, the choice
 * that replaces it, and the cascade down to projects and the lectures in
 * them.
 *
 * The cascade is inheritance at creation, not a live link: each level copies
 * the level above once and keeps its own copy, so changing an account's
 * default never reaches back into work that already exists. Every assertion
 * here is about which of those two it is.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { TemplateModel } from '../../src/models/template'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import {
  defaultTemplateId,
  listBuiltinTemplates,
} from '../../src/templates/builtin'

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

/** A built-in that is NOT the deployment's default, so "inherited the
 * account's choice" cannot be confused with "fell back to the default".
 * Never named literally: the starter set is a deployment's to replace. */
const otherBuiltinId = (): string =>
  listBuiltinTemplates().find(t => t.id !== defaultTemplateId())!.id

let ada: string

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
    TemplateModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
})

describe('the account default design (TMPL-24)', () => {
  it('ships this deployment as NYU Elegant', () => {
    // The one place the id is named. It is the deployment's answer, not the
    // code's: an env var chooses it and the template set has to hold it.
    expect(defaultTemplateId()).toBe('nyu-elegant')
  })

  it('stores nothing until the account chooses', async () => {
    const me = await act(ada, 'user.setLanguage', { language: null })
    expect(me.status).toBe(200)
    expect(me.body.templateId).toBeUndefined()
  })

  it('starts a new project on the deployment default', async () => {
    const project = await act(ada, 'project.create', { title: 'Untouched' })
    expect(project.status).toBe(200)
    expect(project.body.templateId).toBe(defaultTemplateId())
  })

  it('starts a new project on the account choice once one is made', async () => {
    const chosen = otherBuiltinId()
    const saved = await act(ada, 'user.setTemplate', { templateId: chosen })
    expect(saved.status).toBe(200)
    expect(saved.body.templateId).toBe(chosen)

    const project = await act(ada, 'project.create', { title: 'Chosen' })
    expect(project.body.templateId).toBe(chosen)
  })

  it('gives the automatic default project the account choice too', async () => {
    // The project a user never asked for — spun up titleless the first time
    // they start a lecture with no project of their own — goes through the
    // same action, so it inherits the same way a named one does.
    const chosen = otherBuiltinId()
    await act(ada, 'user.setTemplate', { templateId: chosen })

    const auto = await act(ada, 'project.create', {})
    expect(auto.status).toBe(200)
    expect(auto.body.title).toBe('')
    expect(auto.body.templateId).toBe(chosen)

    // And the first lecture started in it wears the same design.
    const deck = await act(ada, 'deck.create', { projectId: auto.body.id })
    expect(deck.body.templateId).toBe(chosen)
  })

  it('passes the project default on to the lectures created in it', async () => {
    const chosen = otherBuiltinId()
    await act(ada, 'user.setTemplate', { templateId: chosen })
    const project = await act(ada, 'project.create', { title: 'Course' })
    const deck = await act(ada, 'deck.create', {
      projectId: project.body.id,
      title: 'Week 1',
    })
    expect(deck.status).toBe(200)
    expect(deck.body.templateId).toBe(chosen)
  })

  it('leaves projects that already exist alone when the account changes', async () => {
    const before = await act(ada, 'project.create', { title: 'Earlier' })
    await act(ada, 'user.setTemplate', { templateId: otherBuiltinId() })

    const reread = await act(ada, 'project.get', { projectId: before.body.id })
    expect(reread.body.templateId).toBe(defaultTemplateId())
  })

  it('lets a project override the account default without changing it', async () => {
    const chosen = otherBuiltinId()
    const project = await act(ada, 'project.create', { title: 'Course' })
    await act(ada, 'project.switchTemplate', {
      projectId: project.body.id,
      templateId: chosen,
    })

    const deck = await act(ada, 'deck.create', {
      projectId: project.body.id,
      title: 'Week 1',
    })
    expect(deck.body.templateId).toBe(chosen)

    // The account still holds nothing: a project-level choice is that
    // project's, and the next project starts from the deployment default.
    const next = await act(ada, 'project.create', { title: 'Another' })
    expect(next.body.templateId).toBe(defaultTemplateId())
  })

  it('lets a lecture override its project without changing the project', async () => {
    const project = await act(ada, 'project.create', { title: 'Course' })
    const deck = await act(ada, 'deck.create', {
      projectId: project.body.id,
      title: 'Week 1',
    })
    const chosen = otherBuiltinId()
    const switched = await act(ada, 'deck.switchTemplate', {
      deckId: deck.body.id,
      templateId: chosen,
    })
    expect(switched.body.templateId).toBe(chosen)

    const reread = await act(ada, 'project.get', { projectId: project.body.id })
    expect(reread.body.templateId).toBe(defaultTemplateId())

    // And the next lecture still starts from the project, not its sibling.
    const sibling = await act(ada, 'deck.create', {
      projectId: project.body.id,
      title: 'Week 2',
    })
    expect(sibling.body.templateId).toBe(defaultTemplateId())
  })

  it('clears the choice back to the deployment default', async () => {
    await act(ada, 'user.setTemplate', { templateId: otherBuiltinId() })
    const cleared = await act(ada, 'user.setTemplate', { templateId: null })
    expect(cleared.status).toBe(200)
    expect(cleared.body.templateId).toBeUndefined()

    const project = await act(ada, 'project.create', { title: 'After' })
    expect(project.body.templateId).toBe(defaultTemplateId())
  })

  it('refuses a template that does not exist', async () => {
    const res = await act(ada, 'user.setTemplate', { templateId: 'no-such' })
    expect(res.status).toBe(400)

    const project = await act(ada, 'project.create', { title: 'After' })
    expect(project.body.templateId).toBe(defaultTemplateId())
  })

  it('falls back when the chosen template is deleted before a project starts', async () => {
    // A template can be deleted after it was chosen (TMPL-4), and a stale
    // reference must not be handed to new work.
    const copy = await act(ada, 'template.duplicate', {
      templateId: otherBuiltinId(),
    })
    await act(ada, 'user.setTemplate', { templateId: copy.body.id })
    await act(ada, 'template.delete', { templateId: copy.body.id })

    const project = await act(ada, 'project.create', { title: 'After' })
    expect(project.body.templateId).toBe(defaultTemplateId())
  })

  it('is one account only: another user keeps the deployment default', async () => {
    await act(ada, 'user.setTemplate', { templateId: otherBuiltinId() })
    const bob = await registerUser('bob@example.com')
    const project = await act(bob, 'project.create', { title: "Bob's" })
    expect(project.body.templateId).toBe(defaultTemplateId())
  })
})
