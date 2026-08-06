/**
 * The mailed one-time tokens (AUTH-3/AUTH-4). An integration test rather than
 * a unit one because every guarantee that matters here — single use, expiry,
 * purpose separation — lives in the query, not in the code around it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { AuthTokenModel } from '../../src/models/auth-token'
import {
  consumeAuthToken,
  issueAuthToken,
  revokeAuthTokens,
} from '../../src/auth/one-time-tokens'

const userId = '507f1f77bcf86cd799439011'

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
})

afterAll(async () => {
  await disconnectMongo()
})

beforeEach(async () => {
  await AuthTokenModel.deleteMany({})
})

describe('issuing', () => {
  it('hands back a token that redeems to its user', async () => {
    const raw = await issueAuthToken(userId, 'verify-email')
    expect(await consumeAuthToken(raw, 'verify-email')).toBe(userId)
  })

  it('stores only a hash, never the token itself', async () => {
    const raw = await issueAuthToken(userId, 'verify-email')
    const stored = await AuthTokenModel.findOne({ userId })
    // A database leak must not hand anyone a working link
    expect(stored!.tokenHash).not.toContain(raw)
    expect(JSON.stringify(stored!.toObject())).not.toContain(raw)
  })

  it('retires an earlier token for the same purpose', async () => {
    const first = await issueAuthToken(userId, 'verify-email')
    await issueAuthToken(userId, 'verify-email')
    // Asking for a new link should stop the old one working
    expect(await consumeAuthToken(first, 'verify-email')).toBeNull()
  })

  it('leaves a token for the other purpose alone', async () => {
    const verify = await issueAuthToken(userId, 'verify-email')
    await issueAuthToken(userId, 'password-reset')
    expect(await consumeAuthToken(verify, 'verify-email')).toBe(userId)
  })
})

describe('redeeming', () => {
  it('works once and only once', async () => {
    const raw = await issueAuthToken(userId, 'password-reset')
    expect(await consumeAuthToken(raw, 'password-reset')).toBe(userId)
    expect(await consumeAuthToken(raw, 'password-reset')).toBeNull()
  })

  it('refuses a token issued for something else', async () => {
    const raw = await issueAuthToken(userId, 'verify-email')
    // Purpose is inside the hash, so a verification link cannot reset a
    // password however it is presented
    expect(await consumeAuthToken(raw, 'password-reset')).toBeNull()
  })

  it('refuses one that has expired', async () => {
    const raw = await issueAuthToken(userId, 'verify-email')
    await AuthTokenModel.updateOne(
      { userId },
      { expiresAt: new Date(Date.now() - 1000) },
    )
    // Checked in the query: the TTL sweep only runs about once a minute
    expect(await consumeAuthToken(raw, 'verify-email')).toBeNull()
  })

  it('refuses an unknown token, and an empty one', async () => {
    expect(await consumeAuthToken('nonsense', 'verify-email')).toBeNull()
    expect(await consumeAuthToken('', 'verify-email')).toBeNull()
  })
})

describe('revoking', () => {
  it('drops every token for one purpose', async () => {
    const raw = await issueAuthToken(userId, 'verify-email')
    await revokeAuthTokens(userId, 'verify-email')
    expect(await consumeAuthToken(raw, 'verify-email')).toBeNull()
  })

  it('leaves the other purpose alone', async () => {
    const reset = await issueAuthToken(userId, 'password-reset')
    await revokeAuthTokens(userId, 'verify-email')
    expect(await consumeAuthToken(reset, 'password-reset')).toBe(userId)
  })
})
