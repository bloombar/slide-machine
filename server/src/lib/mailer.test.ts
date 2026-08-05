/**
 * Unit tests for the mailer: which transports count as usable, what the SMTP
 * transport is built with, and that header values from an untrusted form
 * cannot carry a line break into the message. Nodemailer itself is mocked —
 * these tests are about what the app hands it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const sendMailMock = vi.fn()
// Typed parameter, so the assertions below can read what it was called with.
const createTransportMock = vi.fn((_options: Record<string, unknown>) => ({
  sendMail: sendMailMock,
}))
vi.mock('nodemailer', () => ({ createTransport: createTransportMock }))

// A mutable stand-in for the validated env, so each test can flip one switch.
const envState = {
  MAIL_PROVIDER: 'smtp' as 'smtp' | 'log' | 'none',
  MAIL_FROM: undefined as string | undefined,
  SMTP_HOST: undefined as string | undefined,
  SMTP_PORT: undefined as number | undefined,
  SMTP_USER: undefined as string | undefined,
  SMTP_PASSWORD: undefined as string | undefined,
}
vi.mock('../config/env', () => ({ env: envState }))

const {
  mailerAvailable,
  mailFrom,
  sendMail,
  resetMailer,
  MailUnavailableError,
} = await import('./mailer')

const message = {
  to: 'feedback@example.com',
  subject: 'Hello',
  text: 'A message',
}

beforeEach(() => {
  envState.MAIL_PROVIDER = 'smtp'
  envState.MAIL_FROM = undefined
  envState.SMTP_HOST = 'smtp.example.com'
  envState.SMTP_PORT = undefined
  envState.SMTP_USER = 'app@example.com'
  envState.SMTP_PASSWORD = 'secret'
  createTransportMock.mockClear()
  sendMailMock.mockClear()
  sendMailMock.mockResolvedValue(undefined)
  resetMailer()
})

describe('mailerAvailable', () => {
  it('is true for SMTP with a host and a sender', () => {
    expect(mailerAvailable()).toBe(true)
  })

  it('is false for SMTP without a host', () => {
    envState.SMTP_HOST = undefined
    expect(mailerAvailable()).toBe(false)
  })

  // A relay that will not say who the mail is from cannot send it either.
  it('is false for SMTP with nothing to send as', () => {
    envState.SMTP_USER = undefined
    expect(mailerAvailable()).toBe(false)
  })

  it('is true for the log transport, which needs no configuration', () => {
    envState.MAIL_PROVIDER = 'log'
    envState.SMTP_HOST = undefined
    envState.SMTP_USER = undefined
    expect(mailerAvailable()).toBe(true)
  })

  it('is false when mail is turned off', () => {
    envState.MAIL_PROVIDER = 'none'
    expect(mailerAvailable()).toBe(false)
  })
})

describe('mailFrom', () => {
  it('prefers the configured sender over the SMTP account', () => {
    envState.MAIL_FROM = 'noreply@example.com'
    expect(mailFrom()).toBe('noreply@example.com')
  })

  it('falls back to the SMTP account, which most relays require anyway', () => {
    expect(mailFrom()).toBe('app@example.com')
  })
})

describe('sendMail', () => {
  it('refuses when the server cannot send', async () => {
    envState.MAIL_PROVIDER = 'none'
    await expect(sendMail(message)).rejects.toBeInstanceOf(MailUnavailableError)
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it('relays through SMTP with the configured sender', async () => {
    await sendMail({ ...message, replyTo: 'ada@example.com' })
    expect(sendMailMock).toHaveBeenCalledWith({
      from: 'app@example.com',
      to: 'feedback@example.com',
      subject: 'Hello',
      text: 'A message',
      replyTo: 'ada@example.com',
    })
  })

  it('leaves reply-to off when there is nowhere to reply', async () => {
    await sendMail(message)
    expect(sendMailMock.mock.calls[0]![0]).not.toHaveProperty('replyTo')
  })

  // Submission ports upgrade with STARTTLS; 465 is implicit TLS from the
  // first byte, and getting that backwards fails the connection outright.
  it('defaults to port 587 with STARTTLS', async () => {
    await sendMail(message)
    expect(createTransportMock).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'app@example.com', pass: 'secret' },
    })
  })

  it('uses implicit TLS on port 465', async () => {
    envState.SMTP_PORT = 465
    await sendMail(message)
    expect(createTransportMock.mock.calls[0]![0]).toMatchObject({
      port: 465,
      secure: true,
    })
  })

  it('sends unauthenticated when the relay wants no credentials', async () => {
    envState.SMTP_USER = undefined
    envState.MAIL_FROM = 'noreply@example.com'
    await sendMail(message)
    expect(createTransportMock.mock.calls[0]![0]).toMatchObject({
      auth: undefined,
    })
  })

  it('builds the transport once and reuses it', async () => {
    await sendMail(message)
    await sendMail(message)
    expect(createTransportMock).toHaveBeenCalledTimes(1)
    expect(sendMailMock).toHaveBeenCalledTimes(2)
  })

  // The subject and reply-to can come straight from an unauthenticated form.
  it('strips line breaks from header values', async () => {
    await sendMail({
      ...message,
      subject: 'Hello\r\nBcc: victim@example.com',
      replyTo: 'ada@example.com\nBcc: victim@example.com',
    })
    expect(sendMailMock.mock.calls[0]![0]).toMatchObject({
      subject: 'Hello Bcc: victim@example.com',
      replyTo: 'ada@example.com Bcc: victim@example.com',
    })
  })

  it('writes the whole message to the log instead of relaying it', async () => {
    envState.MAIL_PROVIDER = 'log'
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    await sendMail(message)
    expect(sendMailMock).not.toHaveBeenCalled()
    expect(info.mock.calls[0]![0]).toContain('feedback@example.com')
    expect(info.mock.calls[0]![0]).toContain('A message')
    info.mockRestore()
  })
})
