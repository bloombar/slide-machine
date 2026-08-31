/**
 * Integration tests for the two mailed flows (AUTH-3 / AUTH-4): confirming an
 * address, and recovering a password.
 *
 * The raw token never leaves the server except in a message, and only its
 * hash is stored — so these tests read the token out of the sent mail, which
 * is exactly what a user does. `sendMail` is stubbed to capture it.
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
import { AuthTokenModel } from '../../src/models/auth-token'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import * as mailer from '../../src/lib/mailer'
import { resetAuthMailRateLimit } from '../../src/routes/auth'

const server = createApp().listen(0)
afterAll(() => server.close())

/** Every message the server tried to send during a test. */
let sent: { to: string; subject: string; text: string }[] = []

/** The token out of the most recent message — what the user clicks. */
const tokenFromMail = (): string => {
  const last = sent.at(-1)
  if (!last) throw new Error('no mail was sent')
  const match = last.text.match(/[?&]token=([^\s&]+)/)
  if (!match) throw new Error(`no token in mail: ${last.text}`)
  return decodeURIComponent(match[1]!)
}

/**
 * Registers, then waits for the verification mail the registration started.
 *
 * Registration hands the message off without awaiting it, so the 201 can beat
 * the send — the account existing is what the response promises, and the mail
 * follows. Every test below reads the mail, so the wait belongs here rather
 * than repeated at each call site. Skipped when the server has no way to send,
 * since then no message is coming and waiting would only time out.
 */
const register = async (email: string, password = 'longenough1') => {
  const before = sent.length
  const res = await request(server)
    .post('/api/auth/register')
    .send({ email, password, displayName: email.split('@')[0] })
  if (res.status === 201 && mailer.mailerAvailable()) {
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(before))
  }
  return res
}

const login = (email: string, password: string) =>
  request(server).post('/api/auth/login').send({ email, password })

const act = (token: string, name: string, input: object = {}) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(input)

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await UserModel.init()
  await AuthTokenModel.init()
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
    AuthTokenModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  sent = []
  resetAuthMailRateLimit()
  vi.spyOn(mailer, 'mailerAvailable').mockReturnValue(true)
  vi.spyOn(mailer, 'sendMail').mockImplementation(async mail => {
    sent.push({ to: mail.to, subject: mail.subject, text: mail.text })
  })
})

describe('email verification (AUTH-3)', () => {
  it('mails a link when an account is created', async () => {
    const res = await register('ada@example.com')
    expect(res.status).toBe(201)
    // A brand-new account has proved nothing yet
    expect(res.body.user.emailVerified).toBe(false)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.to).toBe('ada@example.com')
    expect(sent[0]!.text).toContain('/verify-email?token=')
  })

  it('confirms the address when the link is used', async () => {
    await register('ada@example.com')
    const res = await request(server)
      .post('/api/auth/verify-email')
      .send({ token: tokenFromMail() })
    expect(res.status).toBe(200)
    expect(res.body.emailVerified).toBe(true)
  })

  it('refuses the same link a second time', async () => {
    await register('ada@example.com')
    const token = tokenFromMail()
    await request(server).post('/api/auth/verify-email').send({ token })
    const again = await request(server)
      .post('/api/auth/verify-email')
      .send({ token })
    expect(again.status).toBe(400)
    expect(again.body.error.code).toBe('invalid_token')
  })

  it('refuses a token that was never issued', async () => {
    const res = await request(server)
      .post('/api/auth/verify-email')
      .send({ token: 'not-a-real-token' })
    expect(res.status).toBe(400)
  })

  it('refuses a verification token presented as a password reset', async () => {
    await register('ada@example.com')
    const res = await request(server)
      .post('/api/auth/reset-password')
      .send({ token: tokenFromMail(), password: 'brandnewpass1' })
    // Purpose is inside the hash, so a link only ever does its own job
    expect(res.status).toBe(400)
  })

  it('sends another link on request, and retires the first', async () => {
    const registered = await register('ada@example.com')
    const first = tokenFromMail()
    const resend = await request(server)
      .post('/api/auth/verify-email/resend')
      .set('Authorization', `Bearer ${registered.body.accessToken}`)
    expect(resend.status).toBe(200)
    expect(resend.body.sent).toBe(true)

    // Asking for a new link must not leave the old one live
    const stale = await request(server)
      .post('/api/auth/verify-email')
      .send({ token: first })
    expect(stale.status).toBe(400)

    const fresh = await request(server)
      .post('/api/auth/verify-email')
      .send({ token: tokenFromMail() })
    expect(fresh.status).toBe(200)
  })

  it('says there is nothing to send once the address is confirmed', async () => {
    const registered = await register('ada@example.com')
    await request(server)
      .post('/api/auth/verify-email')
      .send({ token: tokenFromMail() })
    const resend = await request(server)
      .post('/api/auth/verify-email/resend')
      .set('Authorization', `Bearer ${registered.body.accessToken}`)
    expect(resend.body).toEqual({ sent: false, alreadyVerified: true })
  })

  it('still creates the account when the server cannot send mail', async () => {
    vi.spyOn(mailer, 'mailerAvailable').mockReturnValue(false)
    const res = await register('ada@example.com')
    // Sign-up must not depend on a deployment detail
    expect(res.status).toBe(201)
    expect(sent).toHaveLength(0)
  })
})

describe('what an unconfirmed account may not do (AUTH-3)', () => {
  it('refuses to publish a project publicly, and says why', async () => {
    const registered = await register('ada@example.com')
    const token = registered.body.accessToken as string
    const project = await act(token, 'project.create', { title: 'Bio' })

    const res = await act(token, 'project.setAccess', {
      projectId: project.body.id,
      visibility: 'public',
    })
    expect(res.status).toBe(403)
    // Its own code, so the client can offer to send another link
    expect(res.body.error.code).toBe('email_unverified')
  })

  it('refuses to publish a lecture publicly', async () => {
    const registered = await register('ada@example.com')
    const token = registered.body.accessToken as string
    const project = await act(token, 'project.create', { title: 'Bio' })
    const deck = await act(token, 'deck.create', {
      projectId: project.body.id,
    })
    const res = await act(token, 'deck.setAccess', {
      deckId: deck.body.id,
      visibility: 'public',
    })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('email_unverified')
  })

  it('starts its projects restricted rather than public', async () => {
    const registered = await register('ada@example.com')
    const project = await act(registered.body.accessToken, 'project.create', {
      title: 'Bio',
    })
    // Projects are public by default; for an unconfirmed account that would
    // be publishing without ever asking to
    expect(project.body.visibility).toBe('restricted')
  })

  it('starts them public again once the address is confirmed', async () => {
    const registered = await register('ada@example.com')
    await request(server)
      .post('/api/auth/verify-email')
      .send({ token: tokenFromMail() })
    const project = await act(registered.body.accessToken, 'project.create', {
      title: 'Bio',
    })
    expect(project.body.visibility).toBe('public')
  })

  it('still lets it work privately, and share with named people', async () => {
    const registered = await register('ada@example.com')
    const token = registered.body.accessToken as string
    const project = await act(token, 'project.create', { title: 'Bio' })
    // Everything short of publishing is untouched
    const restricted = await act(token, 'project.setAccess', {
      projectId: project.body.id,
      visibility: 'restricted',
    })
    expect(restricted.status).toBe(200)
    await register('bob@example.com')
    const shared = await act(token, 'project.share', {
      projectId: project.body.id,
      email: 'bob@example.com',
      role: 'viewer',
    })
    expect(shared.status).toBe(200)
  })

  it('publishes once the address is confirmed', async () => {
    const registered = await register('ada@example.com')
    const token = registered.body.accessToken as string
    const project = await act(token, 'project.create', { title: 'Bio' })
    await request(server)
      .post('/api/auth/verify-email')
      .send({ token: tokenFromMail() })

    const res = await act(token, 'project.setAccess', {
      projectId: project.body.id,
      visibility: 'public',
    })
    expect(res.status).toBe(200)
    expect(res.body.visibility).toBe('public')
  })
})

describe('password reset (AUTH-4)', () => {
  it('mails a link for an address that has an account', async () => {
    await register('ada@example.com')
    sent = []
    const res = await request(server)
      .post('/api/auth/forgot-password')
      .send({ email: 'ada@example.com' })
    expect(res.status).toBe(204)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.text).toContain('/reset-password?token=')
  })

  it('answers the same way for an address that has none', async () => {
    const res = await request(server)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@example.com' })
    // Any other answer would make this a way to find out who is registered
    expect(res.status).toBe(204)
    expect(sent).toHaveLength(0)
  })

  it('sets the new password and refuses the old one', async () => {
    await register('ada@example.com', 'originalpass1')
    await request(server)
      .post('/api/auth/forgot-password')
      .send({ email: 'ada@example.com' })

    const reset = await request(server)
      .post('/api/auth/reset-password')
      .send({ token: tokenFromMail(), password: 'brandnewpass1' })
    expect(reset.status).toBe(204)

    expect((await login('ada@example.com', 'originalpass1')).status).toBe(401)
    expect((await login('ada@example.com', 'brandnewpass1')).status).toBe(200)
  })

  it('ends every session that was open (AUTH-4)', async () => {
    const registered = await register('ada@example.com', 'originalpass1')
    const cookie = registered.headers['set-cookie']!
    await request(server)
      .post('/api/auth/forgot-password')
      .send({ email: 'ada@example.com' })
    await request(server)
      .post('/api/auth/reset-password')
      .send({ token: tokenFromMail(), password: 'brandnewpass1' })

    // Whoever was signed in — including anyone who should not have been
    const refreshed = await request(server)
      .post('/api/auth/refresh')
      .set('Cookie', cookie)
    expect(refreshed.status).toBe(401)
  })

  it('confirms the address too, since the link proved it', async () => {
    await register('ada@example.com', 'originalpass1')
    await request(server)
      .post('/api/auth/forgot-password')
      .send({ email: 'ada@example.com' })
    await request(server)
      .post('/api/auth/reset-password')
      .send({ token: tokenFromMail(), password: 'brandnewpass1' })

    const signedIn = await login('ada@example.com', 'brandnewpass1')
    expect(signedIn.body.user.emailVerified).toBe(true)
  })

  it('refuses the same reset link twice', async () => {
    await register('ada@example.com', 'originalpass1')
    await request(server)
      .post('/api/auth/forgot-password')
      .send({ email: 'ada@example.com' })
    const token = tokenFromMail()
    await request(server)
      .post('/api/auth/reset-password')
      .send({ token, password: 'brandnewpass1' })
    const again = await request(server)
      .post('/api/auth/reset-password')
      .send({ token, password: 'anotherpass12' })
    expect(again.status).toBe(400)
  })

  it('refuses a password shorter than sign-up allows', async () => {
    await register('ada@example.com', 'originalpass1')
    await request(server)
      .post('/api/auth/forgot-password')
      .send({ email: 'ada@example.com' })
    const res = await request(server)
      .post('/api/auth/reset-password')
      .send({ token: tokenFromMail(), password: 'short' })
    // A reset must not be a back door to a weaker password
    expect(res.status).toBe(400)
  })

  it('stops a caller asking for endless messages', async () => {
    await register('ada@example.com', 'originalpass1')
    // Loose enough for anyone who genuinely mislaid a password, tight
    // enough that scripting this server into a mail relay is pointless
    for (let i = 0; i < 5; i++) {
      const ok = await request(server)
        .post('/api/auth/forgot-password')
        .send({ email: 'ada@example.com' })
      expect(ok.status).toBe(204)
    }
    const tooMany = await request(server)
      .post('/api/auth/forgot-password')
      .send({ email: 'ada@example.com' })
    expect(tooMany.status).toBe(429)
  })

  it('sends nothing for a Google-only account', async () => {
    await UserModel.create({
      email: 'grace@example.com',
      displayName: 'Grace',
      googleId: 'google-123',
      emailVerified: true,
    })
    const res = await request(server)
      .post('/api/auth/forgot-password')
      .send({ email: 'grace@example.com' })
    // Silently: "use Google instead" would confirm the address exists
    expect(res.status).toBe(204)
    expect(sent).toHaveLength(0)
  })
})
