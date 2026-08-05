/**
 * Unit tests for POST /api/feedback: what reaches the mailer, who the
 * message is attributed to, and every way the endpoint refuses — an
 * unconfigured server, a malformed body, and a caller sending too often.
 *
 * The mailer, the token verifier and the user model are all mocked: this is
 * about the composition and the guards, not about delivery.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const envState = {
  MAIL_PROVIDER: 'smtp' as 'smtp' | 'log' | 'none',
  FEEDBACK_EMAIL: 'feedback@example.com' as string | undefined,
}
vi.mock('../config/env', () => ({ env: envState }))

const sendMail = vi.fn()
const mailerAvailable = vi.fn(() => true)
class MailUnavailableError extends Error {}
vi.mock('../lib/mailer', () => ({
  sendMail: (...args: unknown[]) => sendMail(...args),
  mailerAvailable: () => mailerAvailable(),
  MailUnavailableError,
}))

const verifyAccessToken = vi.fn()
vi.mock('../auth/tokens', () => ({
  verifyAccessToken: (...args: unknown[]) => verifyAccessToken(...args),
}))

const findById = vi.fn()
vi.mock('../models/user', () => ({
  UserModel: { findById: (...args: unknown[]) => findById(...args) },
}))

const { feedbackRouter, feedbackEnabled, resetFeedbackRateLimit } =
  await import('./feedback')
const { errorHandler } = await import('../middleware/error')

const app = express()
  .use(express.json())
  .use('/api', feedbackRouter)
  .use(errorHandler)

/** A well-formed submission; each test overrides what it is about. */
const submission = {
  kind: 'bug',
  subject: 'Slides stop advancing',
  message: 'After ten minutes the deck freezes.',
}

const post = (body: object = submission, token?: string) => {
  const req = request(app).post('/api/feedback')
  return token
    ? req.set('Authorization', `Bearer ${token}`).send(body)
    : req.send(body)
}

/** The one argument the mailer was handed. */
const sentMail = () => sendMail.mock.calls[0]![0] as Record<string, string>

beforeEach(() => {
  envState.MAIL_PROVIDER = 'smtp'
  envState.FEEDBACK_EMAIL = 'feedback@example.com'
  mailerAvailable.mockReturnValue(true)
  sendMail.mockReset()
  sendMail.mockResolvedValue(undefined)
  verifyAccessToken.mockReset()
  findById.mockReset()
  resetFeedbackRateLimit()
})

describe('feedbackEnabled', () => {
  it('needs both a working transport and an address to send to', () => {
    expect(feedbackEnabled()).toBe(true)
    envState.FEEDBACK_EMAIL = undefined
    expect(feedbackEnabled()).toBe(false)
    envState.FEEDBACK_EMAIL = 'feedback@example.com'
    mailerAvailable.mockReturnValue(false)
    expect(feedbackEnabled()).toBe(false)
  })
})

describe('POST /api/feedback', () => {
  it('sends the message to the configured address', async () => {
    const res = await post()
    expect(res.status).toBe(202)
    expect(res.body).toEqual({ sent: true })
    expect(sentMail()).toMatchObject({
      to: 'feedback@example.com',
      subject: '[Slide Machine] Bug report: Slides stop advancing',
    })
    expect(sentMail().text).toContain('After ten minutes the deck freezes.')
  })

  it('names the kind in the subject', async () => {
    await post({ ...submission, kind: 'feature' })
    expect(sentMail().subject).toBe(
      '[Slide Machine] Feature request: Slides stop advancing',
    )
  })

  // An anonymous sender is the point of a public form: someone who cannot
  // sign in is exactly who needs to reach us.
  it('accepts a message from a visitor who is not signed in', async () => {
    await post()
    expect(sentMail().text).toContain('Account: not signed in')
    expect(sentMail().replyTo).toBeUndefined()
  })

  it('replies to an address the sender typed', async () => {
    await post({ ...submission, email: 'ada@example.com' })
    expect(sentMail().replyTo).toBe('ada@example.com')
    expect(sentMail().text).toContain('Reply-to address given: ada@example.com')
  })

  it('treats a blank email as no address rather than a bad one', async () => {
    const res = await post({ ...submission, email: '   ' })
    expect(res.status).toBe(202)
    expect(sentMail().replyTo).toBeUndefined()
  })

  it('attributes a signed-in sender from their token', async () => {
    verifyAccessToken.mockResolvedValue({ userId: 'u1' })
    findById.mockReturnValue({
      select: () => ({ email: 'ada@example.com', displayName: 'Ada' }),
    })
    await post(submission, 'good-token')
    expect(sentMail().text).toContain('Account: Ada <ada@example.com> (id u1)')
    expect(sentMail().replyTo).toBe('ada@example.com')
  })

  // The account address is the one the server can vouch for; anything typed
  // into the form is a claim, and is recorded as one.
  it('prefers the account address over a typed one', async () => {
    verifyAccessToken.mockResolvedValue({ userId: 'u1' })
    findById.mockReturnValue({
      select: () => ({ email: 'ada@example.com', displayName: 'Ada' }),
    })
    await post({ ...submission, email: 'someone@else.example' }, 'good-token')
    expect(sentMail().replyTo).toBe('ada@example.com')
    expect(sentMail().text).toContain(
      'Reply-to address given: someone@else.example',
    )
  })

  // A stale token is not a reason to lose someone's bug report.
  it('falls back to anonymous when the token does not verify', async () => {
    verifyAccessToken.mockRejectedValue(new Error('expired'))
    const res = await post(submission, 'stale-token')
    expect(res.status).toBe(202)
    expect(sentMail().text).toContain('Account: not signed in')
  })

  it('carries the page the sender was on', async () => {
    await post({ ...submission, page: '/app/projects/p1' })
    expect(sentMail().text).toContain('Page: /app/projects/p1')
  })

  it('rejects a message with nothing in it', async () => {
    const res = await post({ ...submission, message: '   ' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('invalid_input')
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('rejects an unknown kind', async () => {
    const res = await post({ ...submission, kind: 'complaint' })
    expect(res.status).toBe(400)
  })

  it('rejects an email address that is not one', async () => {
    const res = await post({ ...submission, email: 'not-an-address' })
    expect(res.status).toBe(400)
    expect(res.body.error.details.join()).toContain('email')
  })

  it('rejects a message longer than the cap', async () => {
    const res = await post({ ...submission, message: 'x'.repeat(5001) })
    expect(res.status).toBe(400)
  })

  it('refuses when the server has no address to send to', async () => {
    envState.FEEDBACK_EMAIL = undefined
    const res = await post()
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('feedback_unavailable')
    expect(sendMail).not.toHaveBeenCalled()
  })

  // The submission is gone when the request ends, so a failed send has to
  // leave a copy somewhere a person can still find it.
  it('logs the message when it cannot be delivered', async () => {
    sendMail.mockRejectedValue(new Error('relay refused'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await post()
    expect(res.status).toBe(503)
    expect(
      error.mock.calls.some(call => String(call[0]).includes('freezes')),
    ).toBe(true)
    error.mockRestore()
  })

  it('limits how often one caller may send', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await post()).status).toBe(202)
    }
    const res = await post()
    expect(res.status).toBe(429)
    expect(res.body.error.code).toBe('too_many_requests')
    expect(sendMail).toHaveBeenCalledTimes(5)
  })
})
