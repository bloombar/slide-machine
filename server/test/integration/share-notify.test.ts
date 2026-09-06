/**
 * Integration tests for share notifications and invitations (SHARE-3).
 *
 * Two halves, one flow: everyone a lecture or project is shared with gets an
 * email carrying the link, and an address with no account gets one too — held
 * as an invitation that becomes real access the moment they register with it.
 *
 * `sendMail` is stubbed, so what is asserted is the message the app tried to
 * send, exactly as the AUTH-3/AUTH-4 tests do.
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
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { ProjectModel } from '../../src/models/project'
import { DeckModel } from '../../src/models/deck'
import { SlideModel } from '../../src/models/slide'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import { BannedEmailModel } from '../../src/models/banned-email'
import * as mailer from '../../src/lib/mailer'
import { resetShareMailLimit } from '../../src/lib/share-emails'
import { loginWithGoogle } from '../../src/auth/service'

const server = createApp().listen(0)
afterAll(() => server.close())

/** Every message the server tried to send during a test. */
let sent: { to: string; subject: string; text: string }[] = []

/** Messages that are share notifications, not the verification mail. */
const shareMail = () => sent.filter(m => m.subject.includes('shared a'))

/** The verification token out of the message registration mailed. */
const verificationTokenFor = async (email: string): Promise<string> => {
  await vi.waitFor(() =>
    expect(
      sent.some(m => m.to === email && m.text.includes('verify-email')),
    ).toBe(true),
  )
  // The verification message specifically: a share notification to the same
  // address may well have arrived after it.
  const mail = sent
    .filter(m => m.to === email && m.text.includes('verify-email'))
    .at(-1)!
  return decodeURIComponent(mail.text.match(/verify-email\?token=(\S+)/)![1]!)
}

/**
 * Registers and confirms the address the way a person does — through the
 * mailed link. Confirmation is what claims an invitation (SHARE-3), so a
 * test that set `emailVerified` in the database directly would prove
 * nothing about the flow.
 */
const registerUser = async (email: string): Promise<string> => {
  const res = await request(server)
    .post('/api/auth/register')
    .send({ email, password: 'longenough1', displayName: email.split('@')[0] })
  if (res.status !== 201) {
    throw new Error(`registration failed: ${res.status}`)
  }
  await request(server)
    .post('/api/auth/verify-email')
    .send({ token: await verificationTokenFor(email) })
  return res.body.accessToken as string
}

/** Registers without confirming the address — no invitation is claimed. */
const registerUnverified = async (email: string): Promise<string> => {
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

const getDeck = (slug: string, token?: string) => {
  const req = request(server).get(`/api/decks/${slug}`)
  return token ? req.set('Authorization', `Bearer ${token}`) : req
}

let ada: string
let projectId: string
let deckId: string
let slug: string

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await Promise.all([UserModel.init(), DeckModel.init()])
})

afterAll(async () => {
  vi.restoreAllMocks()
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
  await BannedEmailModel.deleteMany({})
  sent = []
  resetShareMailLimit()
  vi.spyOn(mailer, 'mailerAvailable').mockReturnValue(true)
  vi.spyOn(mailer, 'sendMail').mockImplementation(async mail => {
    sent.push({ to: mail.to, subject: mail.subject, text: mail.text })
  })
  ada = await registerUser('ada@example.com')
  const project = await act(ada, 'project.create', { title: 'Physics' })
  projectId = project.body.id as string
  const deck = await act(ada, 'deck.create', {
    projectId,
    title: 'Waves',
    templateId: 'classic',
  })
  deckId = deck.body.id as string
  slug = deck.body.permalinkSlug as string
  await act(ada, 'deck.setAccess', { deckId, visibility: 'restricted' })
})

describe('who may cause a notification', () => {
  // AUTH-3 lets an unconfirmed account share; what it may not do is make
  // the server send mail carrying text it chose.
  it('shares without mailing when the sharer is unconfirmed', async () => {
    const mallory = await registerUnverified('mallory@example.com')
    const project = await act(mallory, 'project.create', { title: 'Theirs' })
    const deck = await act(mallory, 'deck.create', {
      projectId: project.body.id,
      title: 'Theirs',
      templateId: 'classic',
    })
    sent = []
    const res = await act(mallory, 'deck.share', {
      deckId: deck.body.id,
      email: 'target@example.com',
      role: 'viewer',
    })
    // The share is saved — only the announcement is withheld
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(shareMail()).toHaveLength(0)
  })
})

describe('sharing with someone who has an account', () => {
  it('emails them the link to the lecture', async () => {
    await registerUser('byron@example.com')
    sent = []
    const res = await act(ada, 'deck.share', {
      deckId,
      email: 'byron@example.com',
      role: 'viewer',
    })
    expect(res.status).toBe(200)
    const mail = shareMail()
    expect(mail).toHaveLength(1)
    expect(mail[0]!.to).toBe('byron@example.com')
    expect(mail[0]!.text).toContain(`/d/${slug}`)
    expect(mail[0]!.text).toContain('Waves')
    // They already have an account: nothing to tell them about signing up.
    expect(mail[0]!.text).not.toContain('do not have a Slide Machine')
  })

  it('emails a project share with the project link', async () => {
    await registerUser('byron@example.com')
    sent = []
    await act(ada, 'project.share', {
      projectId,
      email: 'byron@example.com',
      role: 'editor',
    })
    const mail = shareMail()
    expect(mail).toHaveLength(1)
    expect(mail[0]!.text).toContain(`/app/projects/${projectId}`)
    expect(mail[0]!.text).toContain('You can view and edit this project.')
  })
})

describe('sharing with an account that has not confirmed its address', () => {
  // Registering with an address proves nothing about holding it, so a share
  // to an unconfirmed account waits exactly as one to a stranger does —
  // otherwise registering a colleague's address first would collect their
  // shares (SHARE-3).
  it('waits rather than granting, and grants on confirmation', async () => {
    const mary = await registerUnverified('mary@example.com')
    await act(ada, 'deck.share', {
      deckId,
      email: 'mary@example.com',
      role: 'viewer',
    })
    expect((await getDeck(slug, mary)).status).toBe(404)
    const shares = await act(ada, 'deck.shares', { deckId })
    expect(shares.body).toEqual([
      expect.objectContaining({ email: 'mary@example.com', pending: true }),
    ])

    await request(server)
      .post('/api/auth/verify-email')
      .send({ token: await verificationTokenFor('mary@example.com') })
    expect((await getDeck(slug, mary)).status).toBe(200)
  })

  it('tells them the confirmation is what opens it', async () => {
    await registerUnverified('mary@example.com')
    sent = []
    await act(ada, 'deck.share', {
      deckId,
      email: 'mary@example.com',
      role: 'viewer',
    })
    const mail = shareMail()
    expect(mail).toHaveLength(1)
    expect(mail[0]!.text).toContain('has not been confirmed yet')
    // They do have an account, so they are not told to create one
    expect(mail[0]!.text).not.toContain('do not have a Slide Machine account')
  })

  it('still refuses the owner by their own address', async () => {
    const res = await act(ada, 'deck.share', {
      deckId,
      email: 'ada@example.com',
      role: 'viewer',
    })
    expect(res.status).toBe(400)
  })
})

describe('sharing with an address that has no account', () => {
  it('emails the link and says how to claim it', async () => {
    const res = await act(ada, 'deck.share', {
      deckId,
      email: 'Mary@example.com',
      role: 'viewer',
    })
    expect(res.status).toBe(200)
    const mail = shareMail()
    expect(mail).toHaveLength(1)
    expect(mail[0]!.to).toBe('mary@example.com')
    expect(mail[0]!.text).toContain(`/d/${slug}`)
    expect(mail[0]!.text).toContain('do not have a Slide Machine account')
  })

  it('lists the address as a pending invitation', async () => {
    await act(ada, 'deck.share', {
      deckId,
      email: 'mary@example.com',
      role: 'editor',
    })
    const shares = await act(ada, 'deck.shares', { deckId })
    expect(shares.body).toEqual([
      expect.objectContaining({
        email: 'mary@example.com',
        role: 'editor',
        pending: true,
        userId: '',
      }),
    ])
  })

  // The invitation is a promise of access, not access: nobody holds it, so
  // it must not open the lecture to anyone before it is claimed.
  it('grants nobody access before the invitation is claimed', async () => {
    await act(ada, 'deck.share', {
      deckId,
      email: 'mary@example.com',
      role: 'viewer',
    })
    const stranger = await registerUser('stranger@example.com')
    expect((await getDeck(slug, stranger)).status).toBe(404)
    expect((await getDeck(slug)).status).toBe(404)
  })

  it('grants the access when that address registers', async () => {
    await act(ada, 'deck.share', {
      deckId,
      email: 'mary@example.com',
      role: 'viewer',
    })
    const mary = await registerUser('mary@example.com')
    const res = await getDeck(slug, mary)
    expect(res.status).toBe(200)
    expect(res.body.canEdit).toBe(false)
    // Claimed, so the share list now shows a person rather than an invite.
    const shares = await act(ada, 'deck.shares', { deckId })
    expect(shares.body).toEqual([
      expect.objectContaining({ email: 'mary@example.com', role: 'viewer' }),
    ])
    expect(shares.body[0].pending).toBeUndefined()
  })

  it('grants an invited editor edit access on registering', async () => {
    await act(ada, 'deck.share', {
      deckId,
      email: 'mary@example.com',
      role: 'editor',
    })
    const mary = await registerUser('mary@example.com')
    expect((await getDeck(slug, mary)).body.canEdit).toBe(true)
  })

  it('claims a project invitation too, cascading to its lectures', async () => {
    const other = await act(ada, 'project.create', { title: 'Chemistry' })
    const otherProject = other.body.id as string
    await act(ada, 'project.setAccess', {
      projectId: otherProject,
      visibility: 'restricted',
    })
    const deck = await act(ada, 'deck.create', {
      projectId: otherProject,
      title: 'Bonds',
      templateId: 'classic',
    })
    await act(ada, 'project.share', {
      projectId: otherProject,
      email: 'mary@example.com',
      role: 'viewer',
    })
    const mary = await registerUser('mary@example.com')
    const res = await getDeck(deck.body.permalinkSlug as string, mary)
    expect(res.status).toBe(200)
  })

  it('withdraws an invitation by address', async () => {
    await act(ada, 'deck.share', {
      deckId,
      email: 'mary@example.com',
      role: 'viewer',
    })
    const res = await act(ada, 'deck.unshare', {
      deckId,
      email: 'mary@example.com',
      role: 'viewer',
    })
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
    // Withdrawn before it was claimed: registering brings no access with it.
    const mary = await registerUser('mary@example.com')
    expect((await getDeck(slug, mary)).status).toBe(404)
  })

  // Registration alone is not proof of an address: confirming it is.
  it('holds the invitation until the address is confirmed', async () => {
    await act(ada, 'deck.share', {
      deckId,
      email: 'mary@example.com',
      role: 'viewer',
    })
    const unconfirmed = await registerUnverified('mary@example.com')
    expect((await getDeck(slug, unconfirmed)).status).toBe(404)
    // Confirming through the mailed link is what grants it
    await request(server)
      .post('/api/auth/verify-email')
      .send({ token: await verificationTokenFor('mary@example.com') })
    expect((await getDeck(slug, unconfirmed)).status).toBe(200)
  })

  // Google returns only verified addresses, so there is nothing further to
  // prove — the claim happens as the account is created.
  it('claims on a first Google sign-in', async () => {
    await act(ada, 'deck.share', {
      deckId,
      email: 'mary@example.com',
      role: 'editor',
    })
    const { user } = await loginWithGoogle({
      googleId: 'google-mary',
      email: 'mary@example.com',
      emailVerified: true,
      name: 'Mary',
    })
    const deck = await DeckModel.findById(deckId)
    expect(deck!.accessOverride!.editors).toContain(user.id)
    expect(deck!.accessOverride!.invites).toEqual([])
  })

  // Both of these addresses look free and are not: neither can ever
  // register, so an invitation would strand the share and mail them anyway.
  it('refuses a banned address', async () => {
    const adaId = (await UserModel.findOne({ email: 'ada@example.com' }))!._id
    await BannedEmailModel.create({
      email: 'banned@example.com',
      bannedBy: adaId,
    })
    const res = await act(ada, 'deck.share', {
      deckId,
      email: 'banned@example.com',
      role: 'viewer',
    })
    expect(res.status).toBe(400)
    expect(shareMail()).toHaveLength(0)
  })

  it('refuses an address still held by a deleted account', async () => {
    await registerUser('gone@example.com')
    await UserModel.updateOne(
      { email: 'gone@example.com' },
      {
        deletedAt: new Date(),
      },
    )
    sent = []
    const res = await act(ada, 'deck.share', {
      deckId,
      email: 'gone@example.com',
      role: 'viewer',
    })
    expect(res.status).toBe(400)
    expect(shareMail()).toHaveLength(0)
  })

  // A recovery proves the address as surely as the confirmation link does,
  // and it is the one path where no confirmation link is left to click.
  it('claims when a password reset proves the address', async () => {
    await act(ada, 'deck.share', {
      deckId,
      email: 'mary@example.com',
      role: 'viewer',
    })
    const mary = await registerUnverified('mary@example.com')
    await request(server)
      .post('/api/auth/forgot-password')
      .send({ email: 'mary@example.com' })
    const reset = sent
      .filter(m => m.to === 'mary@example.com')
      .at(-1)!
      .text.match(/reset-password\?token=(\S+)/)![1]!
    await request(server)
      .post('/api/auth/reset-password')
      .send({ token: decodeURIComponent(reset), password: 'newpassw0rd1' })
    expect((await getDeck(slug, mary)).status).toBe(200)
  })

  // Google verifies the address, so signing in that way proves an account
  // that never confirmed it — and claims what was waiting.
  it('claims when an unconfirmed account signs in with Google', async () => {
    await act(ada, 'deck.share', {
      deckId,
      email: 'mary@example.com',
      role: 'viewer',
    })
    await registerUnverified('mary@example.com')
    const { user } = await loginWithGoogle({
      googleId: 'google-mary-link',
      email: 'mary@example.com',
      emailVerified: true,
      name: 'Mary',
    })
    const deck = await DeckModel.findById(deckId)
    expect(deck!.accessOverride!.viewers).toContain(user.id)
  })

  // A lecture that pins its own access copies the project's people; the
  // invitations it also promised must come across with them.
  it('carries a project invitation into a lecture that pins its access', async () => {
    const other = await act(ada, 'project.create', { title: 'Chemistry' })
    const otherProject = other.body.id as string
    await act(ada, 'project.setAccess', {
      projectId: otherProject,
      visibility: 'restricted',
    })
    const created = await act(ada, 'deck.create', {
      projectId: otherProject,
      title: 'Bonds',
      templateId: 'classic',
    })
    await act(ada, 'project.share', {
      projectId: otherProject,
      email: 'mary@example.com',
      role: 'viewer',
    })
    // Sharing the lecture with someone else detaches it (copy-on-write)
    await registerUser('byron@example.com')
    await act(ada, 'deck.share', {
      deckId: created.body.id,
      email: 'byron@example.com',
      role: 'viewer',
    })
    const shares = await act(ada, 'deck.shares', { deckId: created.body.id })
    expect(shares.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: 'mary@example.com', pending: true }),
      ]),
    )
    // And claiming it still opens the detached lecture
    const mary = await registerUser('mary@example.com')
    expect(
      (await getDeck(created.body.permalinkSlug as string, mary)).status,
    ).toBe(200)
  })

  it('replaces an invitation rather than stacking roles', async () => {
    await act(ada, 'deck.share', {
      deckId,
      email: 'mary@example.com',
      role: 'viewer',
    })
    const res = await act(ada, 'deck.share', {
      deckId,
      email: 'mary@example.com',
      role: 'editor',
    })
    expect(res.body).toHaveLength(1)
    expect(res.body[0].role).toBe('editor')
  })
})
