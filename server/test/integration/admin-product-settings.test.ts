/**
 * Integration tests for the admin settings override on the product path
 * (ADMIN-5) against a real MongoDB: an allowlisted admin opens another
 * user's project or lecture in the ordinary UI and changes its settings
 * through the same actions its owner uses. What is checked here is that
 * the change lands, that the audit log records exactly what moved, that
 * a plain non-editor is still refused, that an admin's own content is
 * off limits, and that the override stops at settings — slides and
 * refine runs stay read-only.
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
import { AdminActionLogModel } from '../../src/models/admin-action-log'

const ADMIN_EMAIL = 'admin@example.com'

const server = createApp().listen(0)

const registerUser = async (email: string): Promise<string> => {
  const res = await request(server)
    .post('/api/auth/register')
    .send({ email, password: 'longenough1', displayName: email.split('@')[0] })
  if (res.status !== 201) {
    throw new Error(
      `registration failed: ${res.status} ${JSON.stringify(res.body)}`,
    )
  }
  // These accounts are ordinary users of a running app, so their address is
  // confirmed: an unconfirmed one keeps its projects restricted (AUTH-3).
  await UserModel.updateOne({ email }, { emailVerified: true })
  return res.body.accessToken as string
}

const act = (token: string, name: string, input: object = {}) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(input)

/** Every audit entry written so far, oldest first. */
const auditEntries = () => AdminActionLogModel.find().sort({ createdAt: 1 })

let ada: string
let admin: string
let stranger: string
let projectId: string
let deckId: string

beforeAll(async () => {
  process.env.ADMIN_EMAILS = ADMIN_EMAIL
  await connectMongo(env.MONGODB_URI)
  await Promise.all([UserModel.init(), DeckModel.init()])
})

afterAll(async () => {
  delete process.env.ADMIN_EMAILS
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
    AdminActionLogModel.deleteMany({}),
  ])
  ada = await registerUser('ada@example.com')
  admin = await registerUser(ADMIN_EMAIL)
  stranger = await registerUser('stranger@example.com')
  const project = await act(ada, 'project.create', { title: 'Physics' })
  projectId = project.body.id as string
  const deck = await act(ada, 'deck.create', { projectId, title: 'Waves' })
  deckId = deck.body.id as string
})

describe("an admin editing another user's project", () => {
  it('saves the settings and audits what changed', async () => {
    const res = await act(admin, 'project.update', {
      projectId,
      generationFreedom: 5,
      language: 'fr',
    })
    expect(res.status).toBe(200)

    const stored = await ProjectModel.findById(projectId)
    expect(stored?.generationFreedom).toBe(5)
    expect(stored?.language).toBe('fr')

    const [entry, ...rest] = await auditEntries()
    expect(rest).toHaveLength(0)
    expect(entry?.action).toBe('project.settings_update')
    expect(entry?.actorEmail).toBe(ADMIN_EMAIL)
    expect(entry?.targetType).toBe('project')
    expect(entry?.targetId).toBe(projectId)
    expect(entry?.details).toMatchObject({
      title: 'Physics',
      changes: {
        generationFreedom: { from: null, to: 5 },
        language: { from: null, to: 'fr' },
      },
    })
  })

  it('records a visibility change made from the sharing tab', async () => {
    const res = await act(admin, 'project.setAccess', {
      projectId,
      visibility: 'restricted',
    })
    expect(res.status).toBe(200)

    const [entry] = await auditEntries()
    expect(entry?.details).toMatchObject({
      changes: { visibility: { from: 'public', to: 'restricted' } },
    })
  })

  it('writes no entry when the admin saves the value already stored', async () => {
    await act(ada, 'project.update', { projectId, generationFreedom: 4 })
    const res = await act(admin, 'project.update', {
      projectId,
      generationFreedom: 4,
    })
    expect(res.status).toBe(200)
    expect(await AdminActionLogModel.countDocuments()).toBe(0)
  })

  it('audits nothing when the owner edits their own project', async () => {
    await act(ada, 'project.update', { projectId, language: 'fr' })
    expect(await AdminActionLogModel.countDocuments()).toBe(0)
  })

  it('refuses a non-admin who is not an editor, and changes nothing', async () => {
    const res = await act(stranger, 'project.update', {
      projectId,
      generationFreedom: 5,
    })
    expect(res.status).toBe(403)
    expect((await ProjectModel.findById(projectId))?.generationFreedom).toBe(
      undefined,
    )
    expect(await AdminActionLogModel.countDocuments()).toBe(0)
  })

  it('refuses a project owned by another allowlisted account', async () => {
    // Admins moderate but are not moderated (ADMIN-1)
    const second = await registerUser('admin2@example.com')
    process.env.ADMIN_EMAILS = `${ADMIN_EMAIL},admin2@example.com`
    const theirs = await act(second, 'project.create', { title: 'Ops' })
    const res = await act(admin, 'project.update', {
      projectId: theirs.body.id as string,
      generationFreedom: 5,
    })
    process.env.ADMIN_EMAILS = ADMIN_EMAIL

    expect(res.status).toBe(403)
    expect(await AdminActionLogModel.countDocuments()).toBe(0)
  })
})

describe("an admin editing another user's lecture", () => {
  it('saves a generation setting and audits it with the lecture context', async () => {
    const res = await act(admin, 'deck.setLanguage', { deckId, language: 'es' })
    expect(res.status).toBe(200)
    expect((await DeckModel.findById(deckId))?.language).toBe('es')

    const [entry] = await auditEntries()
    expect(entry?.action).toBe('deck.settings_update')
    expect(entry?.targetId).toBe(deckId)
    expect(entry?.details).toMatchObject({
      title: 'Waves',
      changes: { language: { from: null, to: 'es' } },
    })
  })

  it('saves the refine settings the console used to hold', async () => {
    const res = await act(admin, 'deck.setRefineSettings', {
      deckId,
      slidesEnabled: false,
      slidesLevel: 4,
    })
    expect(res.status).toBe(200)

    const stored = await DeckModel.findById(deckId)
    expect(stored?.refineSlidesEnabled).toBe(false)
    expect(stored?.refineSlidesLevel).toBe(4)

    const [entry] = await auditEntries()
    expect(entry?.details).toMatchObject({
      changes: {
        refineSlidesEnabled: { from: null, to: false },
        refineSlidesLevel: { from: null, to: 4 },
      },
    })
  })

  it('records detaching a lecture from its project, and re-attaching it', async () => {
    // Pinning the visibility it already inherits is still a real change:
    // the lecture stops following its project.
    const detach = await act(admin, 'deck.setAccess', {
      deckId,
      visibility: 'restricted',
    })
    expect(detach.status).toBe(200)
    let entries = await auditEntries()
    expect(entries[0]?.details).toMatchObject({
      changes: { accessInherited: { from: true, to: false } },
    })

    const reattach = await act(admin, 'deck.resetAccess', { deckId })
    expect(reattach.status).toBe(200)
    entries = await auditEntries()
    expect(entries).toHaveLength(2)
    expect(entries[1]?.details).toMatchObject({
      changes: { accessInherited: { from: false, to: true } },
    })
    expect((await DeckModel.findById(deckId))?.accessOverride).toBeUndefined()
  })

  it('audits a renamed lecture and a switched template', async () => {
    await act(admin, 'deck.rename', { deckId, title: 'Sound waves' })
    await act(admin, 'deck.switchTemplate', { deckId, templateId: 'midnight' })

    const entries = await auditEntries()
    expect(entries).toHaveLength(2)
    expect(entries[0]?.details).toMatchObject({
      changes: { title: { from: 'Waves', to: 'Sound waves' } },
    })
    expect(entries[1]?.details).toMatchObject({
      changes: { templateId: { from: 'classic', to: 'midnight' } },
    })
  })

  it('leaves the slides and the refine run to the owner', async () => {
    const slide = await act(admin, 'slide.add', { deckId })
    expect(slide.status).toBe(403)
    const refine = await act(admin, 'deck.refine', {
      deckId,
      refineSlides: { level: 2 },
    })
    expect(refine.status).toBe(403)
    expect(await AdminActionLogModel.countDocuments()).toBe(0)
  })

  it('refuses a non-admin who is not an editor', async () => {
    const res = await act(stranger, 'deck.setLanguage', {
      deckId,
      language: 'es',
    })
    expect(res.status).toBe(403)
    expect((await DeckModel.findById(deckId))?.language).toBe(undefined)
    expect(await AdminActionLogModel.countDocuments()).toBe(0)
  })
})
