/**
 * Integration tests for the deck access-control system (SHARE-1):
 * general access (restricted/public), people-with-access management by
 * email with per-person roles, editor-aware content actions, and the
 * public profile route with its no-existence-leak guarantee.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { Types } from 'mongoose'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { RefreshTokenModel } from '../../src/models/refresh-token'

// One long-lived server per file: supertest's default per-request
// ephemeral servers intermittently lost requests to localhost port
// churn on macOS (bare 404s with no Express headers)
const server = createApp().listen(0)
afterAll(() => server.close())

const registerUser = async (email: string): Promise<string> => {
  const res = await request(server)
    .post('/api/auth/register')
    .send({ email, password: 'longenough1', displayName: email.split('@')[0] })
  if (res.status !== 201) {
    throw new Error(
      `registration failed: ${res.status} ${JSON.stringify(res.body)}`,
    )
  }
  return res.body.accessToken as string
}

const act = (token: string, name: string, input: object = {}) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(input)

const getDeck = (slug: string, token?: string) => {
  const req = request(server).get(`/api/decks/${slug}`)
  return token ? req.set('Authorization', `Bearer ${token}`) : req
}

const getProfile = (id: string, token?: string) => {
  const req = request(server).get(`/api/users/${id}`)
  return token ? req.set('Authorization', `Bearer ${token}`) : req
}

let ada: string
let byron: string
let deckId: string
let slug: string
let slideId: string

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await Promise.all([UserModel.init(), DeckModel.init()])
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
  byron = await registerUser('byron@example.com')
  const project = await act(ada, 'project.create', { title: 'Physics' })
  const deck = await act(ada, 'deck.create', {
    projectId: project.body.id,
    title: 'Waves',
    templateId: 'classic',
  })
  deckId = deck.body.id as string
  slug = deck.body.permalinkSlug as string
  const slide = await act(ada, 'slide.add', { deckId })
  slideId = slide.body.id as string
})

describe('deck view access', () => {
  it('defaults to public general access with no edit rights', async () => {
    const res = await getDeck(slug)
    expect(res.status).toBe(200)
    expect(res.body.deck.visibility).toBe('public')
    expect(res.body.canEdit).toBe(false)
  })

  it('never exposes share lists to non-owners', async () => {
    await act(ada, 'deck.share', {
      deckId,
      email: 'byron@example.com',
      role: 'viewer',
    })
    const anonymous = await getDeck(slug)
    expect(anonymous.body.deck.viewers).toBeUndefined()
    expect(anonymous.body.deck.editors).toBeUndefined()
    const owner = await getDeck(slug, ada)
    expect(owner.body.deck.viewers).toHaveLength(1)
  })

  it('hides restricted decks from everyone but the owner', async () => {
    await act(ada, 'deck.setAccess', { deckId, visibility: 'restricted' })
    expect((await getDeck(slug)).status).toBe(404)
    expect((await getDeck(slug, byron)).status).toBe(404)
    const owner = await getDeck(slug, ada)
    expect(owner.status).toBe(200)
    expect(owner.body.canEdit).toBe(true)
  })

  it('restricted general access admits only people with access', async () => {
    await act(ada, 'deck.setAccess', { deckId, visibility: 'restricted' })
    expect((await getDeck(slug, byron)).status).toBe(404)

    await act(ada, 'deck.share', {
      deckId,
      email: 'byron@example.com',
      role: 'viewer',
    })
    const res = await getDeck(slug, byron)
    expect(res.status).toBe(200)
    expect(res.body.canEdit).toBe(false)
    expect((await getDeck(slug)).status).toBe(404)
  })

  it('unshare revokes a granted viewer', async () => {
    await act(ada, 'deck.setAccess', { deckId, visibility: 'restricted' })
    await act(ada, 'deck.share', {
      deckId,
      email: 'byron@example.com',
      role: 'viewer',
    })
    const byronId = (await UserModel.findOne({
      email: 'byron@example.com',
    }))!._id!.toString()
    await act(ada, 'deck.unshare', { deckId, userId: byronId, role: 'viewer' })
    expect((await getDeck(slug, byron)).status).toBe(404)
  })
})

describe('deck edit access', () => {
  const grantEditor = async () => {
    await act(ada, 'deck.share', {
      deckId,
      email: 'byron@example.com',
      role: 'editor',
    })
  }

  it('blocks content actions for viewers and strangers', async () => {
    const edit = await act(byron, 'slide.editContent', {
      slideId,
      title: 'Hacked',
    })
    expect(edit.status).toBe(403)
    const rename = await act(byron, 'deck.rename', { deckId, title: 'Nope' })
    expect(rename.status).toBe(403)
  })

  it('lets shared editors edit content, rename, add slides, and speak', async () => {
    await grantEditor()
    expect(
      (await act(byron, 'slide.editContent', { slideId, title: 'Better' }))
        .status,
    ).toBe(200)
    expect(
      (await act(byron, 'deck.rename', { deckId, title: 'Waves II' })).status,
    ).toBe(200)
    expect((await act(byron, 'slide.add', { deckId })).status).toBe(200)
    expect(
      (
        await act(byron, 'session.phrase', {
          deckId,
          phrase: 'Sound waves travel through air',
        })
      ).status,
    ).toBe(200)
    // Editors can always view, even a restricted deck
    await act(ada, 'deck.setAccess', { deckId, visibility: 'restricted' })
    const view = await getDeck(slug, byron)
    expect(view.status).toBe(200)
    expect(view.body.canEdit).toBe(true)
  })

  it('keeps access management owner-only', async () => {
    await grantEditor()
    expect(
      (
        await act(byron, 'deck.setAccess', {
          deckId,
          visibility: 'restricted',
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await act(byron, 'deck.share', {
          deckId,
          email: 'ada@example.com',
          role: 'editor',
        })
      ).status,
    ).toBe(403)
    expect((await act(byron, 'deck.shares', { deckId })).status).toBe(403)
  })

  it('promoting a viewer to editor drops the viewer entry', async () => {
    await act(ada, 'deck.share', {
      deckId,
      email: 'byron@example.com',
      role: 'viewer',
    })
    const shares = await act(ada, 'deck.share', {
      deckId,
      email: 'byron@example.com',
      role: 'editor',
    })
    expect(shares.body).toHaveLength(1)
    expect(shares.body[0].role).toBe('editor')
  })

  it('rejects unknown emails and self-shares', async () => {
    expect(
      (
        await act(ada, 'deck.share', {
          deckId,
          email: 'nobody@example.com',
          role: 'viewer',
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await act(ada, 'deck.share', {
          deckId,
          email: 'ada@example.com',
          role: 'viewer',
        })
      ).status,
    ).toBe(400)
  })
})

describe('public profiles', () => {
  const adaId = async () =>
    (await UserModel.findOne({ email: 'ada@example.com' }))!._id!.toString()

  it('shows public lectures grouped by project, hiding restricted ones', async () => {
    // A second, private deck should not appear for strangers
    const project = await act(ada, 'project.create', { title: 'Chemistry' })
    const hidden = await act(ada, 'deck.create', {
      projectId: project.body.id,
      title: 'Secret',
      templateId: 'classic',
    })
    await act(ada, 'deck.setAccess', {
      deckId: hidden.body.id,
      visibility: 'restricted',
    })

    const res = await getProfile(await adaId())
    expect(res.status).toBe(200)
    expect(res.body.user.displayName).toBe('ada')
    expect(res.body.user.email).toBeUndefined()
    expect(res.body.projects).toHaveLength(1)
    expect(res.body.projects[0].project.title).toBe('Physics')
    expect(res.body.projects[0].decks[0].title).toBe('Waves')
    // Empty projects (all decks hidden) are omitted entirely
    expect(
      res.body.projects.some(
        (p: { project: { title: string } }) => p.project.title === 'Chemistry',
      ),
    ).toBe(false)
  })

  it('includes lectures shared with the requesting viewer', async () => {
    await act(ada, 'deck.setAccess', { deckId, visibility: 'restricted' })
    await act(ada, 'deck.share', {
      deckId,
      email: 'byron@example.com',
      role: 'viewer',
    })
    const stranger = await getProfile(await adaId())
    expect(stranger.body.projects).toHaveLength(0)
    const shared = await getProfile(await adaId(), byron)
    expect(shared.body.projects[0].decks[0].title).toBe('Waves')
  })

  it('a private profile is indistinguishable from a missing one', async () => {
    await act(ada, 'user.setProfileVisibility', {
      profileVisibility: 'private',
    })
    const missing = await getProfile(new Types.ObjectId().toString(), byron)
    const priv = await getProfile(await adaId(), byron)
    expect(priv.status).toBe(missing.status)
    expect(priv.body).toEqual(missing.body)
    expect(priv.status).toBe(404)
    // The owner still sees their own profile
    expect((await getProfile(await adaId(), ada)).status).toBe(200)
  })
})
