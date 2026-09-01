/**
 * Unit tests for the Picker access token (EXP-4).
 *
 * What matters is that the token handed to the browser is minted from the
 * connected account's stored grant — the browser has none of its own — and
 * that a request arriving in mock mode is refused rather than answered with
 * something token-shaped that Google would reject.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { accessTokenFor, googleLive } = vi.hoisted(() => ({
  accessTokenFor: vi.fn(),
  googleLive: vi.fn(),
}))
vi.mock('../auth/google-connect', () => ({ accessTokenFor }))
vi.mock('../lib/token-crypto', () => ({
  decryptToken: (t: string) => `plain-${t}`,
}))
vi.mock('../lib/export-mode', () => ({ googleLive }))

import { drivePickerToken } from './drive-picker'
import type { ActionContext } from './context'

const ctx: ActionContext = {
  userId: '507f1f77bcf86cd799439011',
  requestId: 'test-request',
}

/** What the policy resolves: a signed-in user with a stored Google grant. */
const access = {
  userId: ctx.userId!,
  googleUser: { googleQuizRefreshToken: 'stored-token' },
} as never

beforeEach(() => {
  accessTokenFor.mockReset()
  googleLive.mockReset()
})

describe('drive.pickerToken', () => {
  it('mints a token from the stored refresh token', async () => {
    googleLive.mockReturnValue(true)
    accessTokenFor.mockResolvedValue('ya29.fresh')

    const res = await drivePickerToken.execute(ctx, {}, access)

    expect(res).toEqual({ accessToken: 'ya29.fresh' })
    // Decrypted first: the stored value is ciphertext, and handing that to
    // Google would fail in a way no message here could explain.
    expect(accessTokenFor).toHaveBeenCalledWith('plain-stored-token')
  })

  it('refuses in mock mode, where the Picker is not the chooser', async () => {
    googleLive.mockReturnValue(false)

    await expect(drivePickerToken.execute(ctx, {}, access)).rejects.toThrow(
      /not used in mock mode/i,
    )
    expect(accessTokenFor).not.toHaveBeenCalled()
  })

  it('lets a dead grant surface as itself', async () => {
    // accessTokenFor already turns a revoked grant into the reconnect error
    // the UI knows how to offer; swallowing it here would hide the one thing
    // the instructor could act on.
    googleLive.mockReturnValue(true)
    accessTokenFor.mockRejectedValue(new Error('google_reconnect'))

    await expect(drivePickerToken.execute(ctx, {}, access)).rejects.toThrow(
      'google_reconnect',
    )
  })
})
