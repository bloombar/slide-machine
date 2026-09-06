/**
 * Unit tests for the unconfirmed-account gate (AUTH-3), and for the waiver
 * the share actions use where the deployment cannot send mail at all
 * (SHARE-3).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const findByIdMock = vi.fn()
vi.mock('../models/user', () => ({ UserModel: { findById: findByIdMock } }))

const mailerAvailableMock = vi.fn(() => true)
vi.mock('../lib/mailer', () => ({ mailerAvailable: mailerAvailableMock }))

const { requireVerifiedEmail, requireVerifiedEmailWhenMailable } =
  await import('./verified')

/** UserModel.findById(...).catch(...) — a promise is all the code needs. */
const account = (emailVerified: boolean) => {
  findByIdMock.mockResolvedValue(emailVerified ? { emailVerified } : {})
}

beforeEach(() => {
  findByIdMock.mockReset()
  mailerAvailableMock.mockReset()
  mailerAvailableMock.mockReturnValue(true)
})

describe('requireVerifiedEmail', () => {
  it('admits a confirmed account', async () => {
    account(true)
    await expect(requireVerifiedEmail('u1')).resolves.toBeUndefined()
  })

  it('refuses an unconfirmed one, whatever the mail setup', async () => {
    account(false)
    mailerAvailableMock.mockReturnValue(false)
    await expect(requireVerifiedEmail('u1')).rejects.toThrow(
      /confirm your email/i,
    )
  })
})

describe('requireVerifiedEmailWhenMailable', () => {
  it('refuses an unconfirmed account where mail can be sent', async () => {
    account(false)
    await expect(requireVerifiedEmailWhenMailable('u1')).rejects.toThrow()
  })

  // With no relay there is no confirmation link to send, so the gate would
  // be a permanent refusal rather than a step the user can take — and no
  // relay to protect from an unproven account either.
  it('waives the check where the server cannot send mail at all', async () => {
    account(false)
    mailerAvailableMock.mockReturnValue(false)
    await expect(
      requireVerifiedEmailWhenMailable('u1'),
    ).resolves.toBeUndefined()
    expect(findByIdMock).not.toHaveBeenCalled()
  })
})
