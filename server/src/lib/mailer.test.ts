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
  MAIL_FROM_NAME: undefined as string | undefined,
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
  envState.MAIL_FROM_NAME = undefined
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
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
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

  // Every timeout matters on its own: a relay can refuse the TCP connection,
  // accept it and never greet, or greet and then stall mid-message.
  it('bounds every stage of the connection', async () => {
    await sendMail(message)
    const options = createTransportMock.mock.calls[0]![0]
    for (const key of [
      'connectionTimeout',
      'greetingTimeout',
      'socketTimeout',
    ]) {
      expect(options[key]).toBeTypeOf('number')
      expect(options[key]).toBeLessThanOrEqual(30_000)
    }
  })

  it('sends the bare address when no display name is configured', async () => {
    await sendMail(message)
    expect(sendMailMock.mock.calls[0]![0]!.from).toBe('app@example.com')
  })

  // Nodemailer does the quoting and any encoding; it is handed the parts.
  it('names the sender when a display name is configured', async () => {
    envState.MAIL_FROM_NAME = 'The Slide Machine'
    envState.MAIL_FROM = 'noreply@example.com'
    await sendMail(message)
    expect(sendMailMock.mock.calls[0]![0]!.from).toEqual({
      name: 'The Slide Machine',
      address: 'noreply@example.com',
    })
  })

  it('ignores a display name that is only whitespace', async () => {
    envState.MAIL_FROM_NAME = '   '
    await sendMail(message)
    expect(sendMailMock.mock.calls[0]![0]!.from).toBe('app@example.com')
  })

  // Set from the environment rather than a form, so this is defence in depth
  // — but a From header is a header like any other.
  it('strips line breaks from the display name', async () => {
    envState.MAIL_FROM_NAME = 'Slide\r\nBcc: victim@example.com'
    await sendMail(message)
    expect(sendMailMock.mock.calls[0]![0]!.from).toEqual({
      name: 'Slide Bcc: victim@example.com',
      address: 'app@example.com',
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

  // The log transport needs no sender, and a checkout with none configured
  // should not have "undefined" written into its diagnostics.
  it('leaves the sender out of the log when there is none', async () => {
    envState.MAIL_PROVIDER = 'log'
    envState.SMTP_USER = undefined
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    await sendMail(message)
    expect(info.mock.calls[0]![0]).not.toContain('undefined')
    expect(info.mock.calls[0]![0]).toContain('[mail] to=feedback@example.com')
    info.mockRestore()
  })

  // Reading the log is how a developer checks what a configured server would
  // have delivered, so the sender has to read the way an inbox would show it.
  it('shows the named sender in the log transport', async () => {
    envState.MAIL_PROVIDER = 'log'
    envState.MAIL_FROM_NAME = 'The Slide Machine'
    envState.MAIL_FROM = 'noreply@example.com'
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    await sendMail(message)
    expect(info.mock.calls[0]![0]).toContain(
      '"The Slide Machine" <noreply@example.com>',
    )
    info.mockRestore()
  })
})
