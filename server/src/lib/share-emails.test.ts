/**
 * Unit tests for the share notification (SHARE-3): what the message says,
 * and the conditions under which one is sent at all. The mailer is mocked —
 * these are about what the app hands it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const sendMailMock = vi.fn()
const mailerAvailableMock = vi.fn(() => true)
vi.mock('./mailer', () => ({
  sendMail: sendMailMock,
  mailerAvailable: mailerAvailableMock,
}))

const findByIdMock = vi.fn()
vi.mock('../models/user', () => ({
  UserModel: { findById: findByIdMock },
}))

// Whether the sharer has confirmed their address gates the send (SHARE-3).
const emailVerifiedMock = vi.fn(async () => true)
vi.mock('../auth/verified', () => ({ emailVerified: emailVerifiedMock }))

const {
  shareEmailSubject,
  shareEmailText,
  sendShareEmail,
  notifyShare,
  resetShareMailLimit,
} = await import('./share-emails')

const notice = {
  to: 'byron@example.com',
  recipientName: 'Byron',
  sharerName: 'Ada',
  kind: 'lecture' as const,
  title: 'Numerical Methods',
  link: 'https://app.example.com/d/numerical-methods',
  role: 'viewer' as const,
  hasAccount: true,
}

beforeEach(() => {
  sendMailMock.mockReset()
  sendMailMock.mockResolvedValue(undefined)
  mailerAvailableMock.mockReturnValue(true)
  findByIdMock.mockReset()
  emailVerifiedMock.mockReset()
  emailVerifiedMock.mockResolvedValue(true)
  resetShareMailLimit()
})

describe('the message', () => {
  it('names the sharer and the lecture in the subject', () => {
    expect(shareEmailSubject(notice)).toBe(
      'Ada shared a lecture with you: Numerical Methods',
    )
  })

  it('carries the link — the point of the message', () => {
    expect(shareEmailText(notice)).toContain(
      'https://app.example.com/d/numerical-methods',
    )
  })

  it('says what a viewer and an editor may do', () => {
    expect(shareEmailText(notice)).toContain('You can view this lecture.')
    expect(shareEmailText({ ...notice, role: 'editor' })).toContain(
      'You can view and edit this lecture.',
    )
  })

  // Someone with no account has to be told that signing up with THIS
  // address is what claims the share; a bare link would strand them.
  it('tells an address with no account how to claim the share', () => {
    const text = shareEmailText({
      ...notice,
      hasAccount: false,
      recipientName: undefined,
    })
    expect(text).toContain('do not have a Slide Machine account')
    // Naming the step that grants it: signing up alone no longer does
    expect(text).toContain('confirm the address')
    expect(text).toContain('byron@example.com')
    expect(text).toContain('https://app.example.com/d/numerical-methods')
  })

  it('leaves the sign-up ending out for an existing account', () => {
    expect(shareEmailText(notice)).not.toContain('do not have a Slide Machine')
  })
})

describe('sendShareEmail', () => {
  it('hands the message to the mailer and reports the send', async () => {
    await expect(sendShareEmail(notice)).resolves.toBe(true)
    expect(sendMailMock).toHaveBeenCalledWith({
      to: 'byron@example.com',
      subject: shareEmailSubject(notice),
      text: shareEmailText(notice),
    })
  })

  it('sends nothing when the server has no mail configured', async () => {
    mailerAvailableMock.mockReturnValue(false)
    await expect(sendShareEmail(notice)).resolves.toBe(false)
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  // The share itself already succeeded by this point: a relay failure must
  // be reported, not raised.
  it('swallows a relay failure', async () => {
    sendMailMock.mockRejectedValue(new Error('relay down'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(sendShareEmail(notice)).resolves.toBe(false)
  })
})

describe('notifyShare', () => {
  const share = {
    to: 'byron@example.com',
    kind: 'lecture' as const,
    title: 'Numerical Methods',
    path: '/d/numerical-methods',
    role: 'viewer' as const,
    hasAccount: false,
  }

  it('builds the absolute link from the app origin', async () => {
    findByIdMock.mockResolvedValue({ displayName: 'Ada' })
    await expect(
      notifyShare(
        { userId: 'u1', origin: 'https://app.example.com' },
        { ...share },
      ),
    ).resolves.toBe(true)
    expect(sendMailMock.mock.calls[0]![0].text).toContain(
      'https://app.example.com/d/numerical-methods',
    )
    expect(sendMailMock.mock.calls[0]![0].subject).toContain('Ada shared')
  })

  it('falls back to "Someone" when the sharer cannot be read', async () => {
    findByIdMock.mockResolvedValue(null)
    await notifyShare(
      { userId: 'u1', origin: 'https://app.example.com' },
      {
        ...share,
      },
    )
    expect(sendMailMock.mock.calls[0]![0].subject).toContain('Someone shared')
  })

  // AUTH-3 lets an unconfirmed account share; what it may not do is make
  // the server mail strangers text it chose.
  it('sends nothing for an unconfirmed sharer', async () => {
    emailVerifiedMock.mockResolvedValue(false)
    await expect(
      notifyShare(
        { userId: 'u1', origin: 'https://app.example.com' },
        { ...share },
      ),
    ).resolves.toBe(false)
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it('stops sending once one account has sent its hourly allowance', async () => {
    findByIdMock.mockResolvedValue({ displayName: 'Ada' })
    const ctx = { userId: 'u1', origin: 'https://app.example.com' }
    const sends = []
    for (let i = 0; i < 61; i += 1) sends.push(await notifyShare(ctx, share))
    expect(sends.filter(Boolean)).toHaveLength(60)
    expect(sends.at(-1)).toBe(false)
    // A different account is unaffected: the window is per sharer.
    await expect(notifyShare({ ...ctx, userId: 'u2' }, share)).resolves.toBe(
      true,
    )
  })

  // Without an origin there is no link to put in the message, and a share
  // notification with no link is not worth sending.
  it('sends nothing when there is no app origin', async () => {
    await expect(notifyShare({ userId: 'u1' }, { ...share })).resolves.toBe(
      false,
    )
    expect(sendMailMock).not.toHaveBeenCalled()
  })
})
