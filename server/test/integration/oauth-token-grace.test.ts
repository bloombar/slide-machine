/**
 * Rework round 2's must-fix 2, isolated with a positive `REFRESH_GRACE_SECONDS`
 * (docs/plans/OAUTH_CONSENT_SECURITY.md).
 *
 * `oauth-mcp.test.ts` runs with the shared test env, which pins
 * `REFRESH_GRACE_SECONDS=0` (rotated-out tokens must die immediately, by
 * design — see its own comment and `auth.test.ts`'s session-level
 * equivalent). That is exactly the one value under which must-fix 2's bug is
 * unreachable: with a zero grace window, "the token's own expiry already
 * precedes the grace window" and "the token has already expired" are the
 * same condition, so the buggy branch and the early-return branch can never
 * be told apart by a test running under that config. This file mocks
 * `config/env` with a real, positive grace window instead — following the
 * pattern `vitest.config.ts` itself documents ("tests that need live mode
 * mock the env module themselves") — so the two conditions can actually
 * diverge.
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

const { testEnv } = vi.hoisted(() => ({
  testEnv: {
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-chars!!',
    REFRESH_GRACE_SECONDS: 120,
    // Short-circuits `mailerAvailable()` in lib/mailer.ts (the only other
    // module in this call graph that reads `env`) before it looks at any
    // other field.
    MAIL_PROVIDER: 'none' as const,
  },
}))
vi.mock('../../src/config/env', () => ({ env: testEnv }))

import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { OAuthTokenModel } from '../../src/models/oauth-token'
import { UserModel } from '../../src/models/user'
import { SCOPES } from '../../src/oauth/scopes'
import { issueTokens, rotateTokens, hashToken } from '../../src/oauth/store'

const MONGODB_URI =
  process.env.MONGODB_TEST_URI ?? 'mongodb://localhost:27017/slide-machine-test'

let userId = ''

beforeAll(async () => {
  await connectMongo(MONGODB_URI)
})
afterAll(async () => {
  await disconnectMongo()
})
beforeEach(async () => {
  await Promise.all([OAuthTokenModel.deleteMany({}), UserModel.deleteMany({})])
  const user = await UserModel.create({
    email: 'grace-edge@example.test',
    displayName: 'Grace Edge',
    passwordHash: 'x',
  })
  userId = user._id.toString()
})

describe('a token rotated within its own last moments, under a real grace window', () => {
  it('is marked superseded even though there is nothing to shorten', async () => {
    const tokens = await issueTokens({
      clientId: 'client-a',
      userId,
      scopes: [SCOPES.read],
    })

    // The token's own life is shorter than the (real, positive) grace
    // window — must-fix 2's exact condition: `usableUntil > graceEnd` is
    // false, so nothing needs shortening, but the token has still been
    // rotated and must still be marked as such.
    const soon = new Date(Date.now() + 500)
    await OAuthTokenModel.updateOne(
      { tokenHash: hashToken(tokens.refreshToken) },
      { $set: { expiresAt: soon, usableUntil: soon } },
    )

    const rotated = await rotateTokens(tokens.refreshToken, 'client-a')
    expect(rotated).not.toBeNull()

    const row = await OAuthTokenModel.findOne({
      tokenHash: hashToken(tokens.refreshToken),
    })
    expect(row!.supersededAt).toBeTruthy()
    // Confirms the branch under test really was the no-op one: `usableUntil`
    // was not moved, because it already preceded the grace window.
    expect(row!.usableUntil!.getTime()).toBe(soon.getTime())

    // Past its own short natural life, then replayed — detection needs
    // `supersededAt` (asserted above) to have been set to catch this.
    await new Promise(resolve => setTimeout(resolve, 600))
    const replay = await rotateTokens(tokens.refreshToken, 'client-a')
    expect(replay).toBeNull()

    // The whole connection is gone, not just this one exchange refused —
    // `revokeConnection`'s reuse teardown (finding 3).
    const afterReplay = await OAuthTokenModel.countDocuments({
      userId,
      clientId: 'client-a',
    })
    expect(afterReplay).toBe(0)
  })
})
