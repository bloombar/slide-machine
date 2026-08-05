/**
 * Integration tests for POST /api/feedback against the assembled app and a
 * real MongoDB: the route as it is actually mounted, the real mailer on its
 * log transport (MAIL_PROVIDER=log in the test env), and a real access token
 * for the signed-in case.
 *
 * The message is read back out of the log line the transport writes, which
 * is the closest a hermetic test gets to reading the inbox.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from 'vitest'
import request from 'supertest'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { signAccessToken } from '../../src/auth/tokens'
import { resetFeedbackRateLimit } from '../../src/routes/feedback'

const server = createApp().listen(0)

const submission = {
  kind: 'bug',
  subject: 'Slides stop advancing',
  message: 'After ten minutes the deck freezes.',
}

/** Everything the log transport wrote during a test, joined. */
let logged: string[]
let info: ReturnType<typeof vi.spyOn>

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await UserModel.init()
})

afterAll(async () => {
  await disconnectMongo()
  server.close()
})

beforeEach(async () => {
  await UserModel.deleteMany({})
  // Each case starts with its own window; the limiter outlives a request.
  resetFeedbackRateLimit()
  logged = []
  info = vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(' '))
  })
})

afterEach(() => info.mockRestore())

describe('POST /api/feedback', () => {
  it('accepts an anonymous message and mails it on', async () => {
    const res = await request(server).post('/api/feedback').send(submission)

    expect(res.status).toBe(202)
    expect(res.body).toEqual({ sent: true })
    const mail = logged.join('\n')
    expect(mail).toContain('feedback@example.test')
    expect(mail).toContain('[Slide Machine] Bug report: Slides stop advancing')
    expect(mail).toContain('After ten minutes the deck freezes.')
    expect(mail).toContain('Account: not signed in')
  })

  it('attributes a message sent with a valid token', async () => {
    const user = await UserModel.create({
      email: 'ada@example.com',
      displayName: 'Ada',
      passwordHash: 'x',
    })
    const token = await signAccessToken(String(user._id))

    const res = await request(server)
      .post('/api/feedback')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...submission, page: '/app/projects/p1' })

    expect(res.status).toBe(202)
    const mail = logged.join('\n')
    expect(mail).toContain(`Account: Ada <ada@example.com> (id ${user._id})`)
    expect(mail).toContain('reply-to=ada@example.com')
    expect(mail).toContain('Page: /app/projects/p1')
  })

  it('rejects a message with nothing in it', async () => {
    const res = await request(server)
      .post('/api/feedback')
      .send({ ...submission, message: '' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('invalid_input')
    expect(logged).toEqual([])
  })

  // An open endpoint that sends mail is a relay unless it is bounded.
  it('stops a caller sending more than the limit', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect(
        (await request(server).post('/api/feedback').send(submission)).status,
      ).toBe(202)
    }
    const res = await request(server).post('/api/feedback').send(submission)
    expect(res.status).toBe(429)
    expect(res.body.error.code).toBe('too_many_requests')
  })
})

describe('GET /api/config', () => {
  it('tells the client the form can be offered', async () => {
    const res = await request(server).get('/api/config')
    expect(res.body.feedbackEnabled).toBe(true)
  })
})
