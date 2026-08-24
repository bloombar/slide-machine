/**
 * The token store, and the connected-assistants list built on it
 * (docs/MCP.md §5.3).
 *
 * Revocation is most of what OAuth buys a user over handing an assistant their
 * password — "disconnect one, stay signed in everywhere else". These tests
 * hold that promise to the letter: one account's disconnect must not touch
 * another's, and cutting an assistant must cut every token it holds rather
 * than the one it last used.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { OAuthTokenModel } from '../../src/models/oauth-token'
import { OAuthClientModel } from '../../src/models/oauth-client'
import { UserModel } from '../../src/models/user'
import {
  connectionsFor,
  disconnect,
  issueTokens,
  revokeToken,
  rotateTokens,
  verifyToken,
} from '../../src/oauth/store'
import { runAction } from '../../src/actions/dispatch'
import { mcpConnections, mcpDisconnect } from '../../src/actions/mcp'
import { SCOPES } from '../../src/oauth/scopes'

// Real accounts, not fabricated ids: the `self` policy these actions declare
// loads the user document, so a made-up id is refused — which is the guard
// working, and worth exercising rather than sidestepping.
let userId = ''
let otherId = ''
const ctx = (id: string) => ({ userId: id, requestId: 'req-1' })

const makeUser = async (email: string): Promise<string> => {
  const user = await UserModel.create({
    email,
    displayName: email.split('@')[0],
    passwordHash: 'x',
  })
  return user._id.toString()
}

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await OAuthTokenModel.init()
})
afterAll(async () => {
  await disconnectMongo()
})
beforeEach(async () => {
  await Promise.all([
    OAuthTokenModel.deleteMany({}),
    OAuthClientModel.deleteMany({}),
    UserModel.deleteMany({}),
  ])
  userId = await makeUser('owner@example.test')
  otherId = await makeUser('other@example.test')
})

describe('issuing and verifying', () => {
  it('mints a pair that verifies back to the account and the assistant', async () => {
    const tokens = await issueTokens({
      clientId: 'client-a',
      userId,
      scopes: [SCOPES.read],
    })
    const verified = await verifyToken(tokens.accessToken)

    expect(verified).toMatchObject({
      userId,
      clientId: 'client-a',
      scopes: [SCOPES.read],
    })
  })

  it('stores no token that could be replayed from the database', async () => {
    // A leaked collection must not yield working credentials — the same rule
    // session refresh tokens already follow.
    const tokens = await issueTokens({
      clientId: 'client-a',
      userId,
      scopes: [SCOPES.read],
    })
    const rows = await OAuthTokenModel.find({})
    const stored = JSON.stringify(rows.map(r => r.tokenHash))

    expect(stored).not.toContain(tokens.accessToken)
    expect(stored).not.toContain(tokens.refreshToken)
  })

  it('refuses a token that never existed', async () => {
    expect(await verifyToken('invented')).toBeNull()
  })

  it('refuses an expired token even before the sweep removes it', async () => {
    // Mongo's TTL monitor runs about once a minute, so an expired row is
    // routinely still present when its token is presented.
    const tokens = await issueTokens({
      clientId: 'client-a',
      userId,
      scopes: [SCOPES.read],
    })
    await OAuthTokenModel.updateMany(
      {},
      { expiresAt: new Date(Date.now() - 1) },
    )

    expect(await verifyToken(tokens.accessToken)).toBeNull()
  })

  it('will not let a refresh token be used as an access token', async () => {
    const tokens = await issueTokens({
      clientId: 'client-a',
      userId,
      scopes: [SCOPES.read],
    })
    expect(await verifyToken(tokens.refreshToken)).toBeNull()
  })
})

describe('rotation', () => {
  it('issues a new pair and burns the old refresh token', async () => {
    const first = await issueTokens({
      clientId: 'client-a',
      userId,
      scopes: [SCOPES.write],
    })
    const second = await rotateTokens(first.refreshToken, 'client-a')

    expect(second).not.toBeNull()
    expect(await rotateTokens(first.refreshToken, 'client-a')).toBeNull()
  })

  it('refuses a refresh token presented by a different assistant', async () => {
    const tokens = await issueTokens({
      clientId: 'client-a',
      userId,
      scopes: [SCOPES.read],
    })
    expect(await rotateTokens(tokens.refreshToken, 'client-b')).toBeNull()
  })

  it('lets a client ask for less than it holds', async () => {
    const tokens = await issueTokens({
      clientId: 'client-a',
      userId,
      scopes: [SCOPES.read, SCOPES.write],
    })
    const rotated = await rotateTokens(tokens.refreshToken, 'client-a', [
      SCOPES.read,
    ])
    const verified = await verifyToken(rotated!.accessToken)

    expect(verified?.scopes).toEqual([SCOPES.read])
  })

  it('never lets a client ask for more than it holds', async () => {
    // The grant is what the user approved; a refresh must not widen it.
    const tokens = await issueTokens({
      clientId: 'client-a',
      userId,
      scopes: [SCOPES.read],
    })
    const rotated = await rotateTokens(tokens.refreshToken, 'client-a', [
      SCOPES.write,
    ])
    const verified = await verifyToken(rotated!.accessToken)

    expect(verified?.scopes).toEqual([])
  })
})

describe('taking it back', () => {
  it('forgets one token, and says nothing about one it never knew', async () => {
    const tokens = await issueTokens({
      clientId: 'client-a',
      userId,
      scopes: [SCOPES.read],
    })
    await revokeToken(tokens.accessToken)
    expect(await verifyToken(tokens.accessToken)).toBeNull()

    // RFC 7009: revoking an unknown token is a success, not a probe.
    await expect(revokeToken('invented')).resolves.toBeUndefined()
  })

  it('cuts every token one assistant holds, not just the last one used', async () => {
    const first = await issueTokens({
      clientId: 'client-a',
      userId,
      scopes: [SCOPES.read],
    })
    const second = await issueTokens({
      clientId: 'client-a',
      userId,
      scopes: [SCOPES.read],
    })

    expect(await disconnect(userId, 'client-a')).toBe(4)
    expect(await verifyToken(first.accessToken)).toBeNull()
    expect(await verifyToken(second.accessToken)).toBeNull()
  })

  it('leaves other assistants, and other accounts, alone', async () => {
    // "Disconnect one; stay signed in everywhere else" is the promise.
    const kept = await issueTokens({
      clientId: 'client-b',
      userId,
      scopes: [SCOPES.read],
    })
    const someoneElse = await issueTokens({
      clientId: 'client-a',
      userId: otherId,
      scopes: [SCOPES.read],
    })
    await issueTokens({ clientId: 'client-a', userId, scopes: [SCOPES.read] })

    await disconnect(userId, 'client-a')

    expect(await verifyToken(kept.accessToken)).not.toBeNull()
    expect(await verifyToken(someoneElse.accessToken)).not.toBeNull()
  })
})

describe('the connected-assistants list', () => {
  it('shows one row per assistant, however often it has refreshed', async () => {
    await issueTokens({ clientId: 'client-a', userId, scopes: [SCOPES.read] })
    await issueTokens({ clientId: 'client-a', userId, scopes: [SCOPES.write] })
    await issueTokens({ clientId: 'client-b', userId, scopes: [SCOPES.read] })

    const connections = await connectionsFor(userId)
    expect(connections.map(c => c.clientId).sort()).toEqual([
      'client-a',
      'client-b',
    ])
    // A connection that has been re-granted shows everything it holds.
    const a = connections.find(c => c.clientId === 'client-a')!
    expect(a.scopes.sort()).toEqual([SCOPES.read, SCOPES.write].sort())
  })

  it('leaves out an assistant whose tokens have expired', async () => {
    await issueTokens({ clientId: 'client-a', userId, scopes: [SCOPES.read] })
    await OAuthTokenModel.updateMany(
      {},
      { expiresAt: new Date(Date.now() - 1) },
    )

    expect(await connectionsFor(userId)).toEqual([])
  })

  it('names the assistant, and says what it may do in plain words', async () => {
    await OAuthClientModel.create({
      clientId: 'client-a',
      clientName: 'Claude',
      redirectUris: ['https://claude.test/cb'],
      metadata: {},
    })
    await issueTokens({ clientId: 'client-a', userId, scopes: [SCOPES.write] })

    const [connection] = await runAction(mcpConnections, ctx(userId), {})
    expect(connection).toMatchObject({
      clientId: 'client-a',
      clientName: 'Claude',
    })
    expect(connection!.permissions[0]).toContain('Create and change')
  })

  it('falls back to a label when an assistant registered without a name', async () => {
    await issueTokens({ clientId: 'client-a', userId, scopes: [SCOPES.read] })
    const [connection] = await runAction(mcpConnections, ctx(userId), {})
    expect(connection?.clientName).toBe('An unnamed assistant')
  })

  it('shows an account with no assistants an empty list, not an error', async () => {
    expect(await runAction(mcpConnections, ctx(userId), {})).toEqual([])
  })
})

describe('disconnecting through the action layer', () => {
  it('cuts the assistant and reports how many tokens went', async () => {
    await issueTokens({ clientId: 'client-a', userId, scopes: [SCOPES.read] })

    const result = await runAction(mcpDisconnect, ctx(userId), {
      clientId: 'client-a',
    })
    expect(result).toEqual({ disconnected: 2 })
    expect(await connectionsFor(userId)).toEqual([])
  })

  it('cannot reach into another account’s connections', async () => {
    // The action is self-scoped, so this is not a matter of care: the id it
    // deletes by is the caller's own, never one supplied in the input.
    const theirs = await issueTokens({
      clientId: 'client-a',
      userId: otherId,
      scopes: [SCOPES.read],
    })

    await runAction(mcpDisconnect, ctx(userId), { clientId: 'client-a' })
    expect(await verifyToken(theirs.accessToken)).not.toBeNull()
  })

  it('is harmless when the assistant was never connected', async () => {
    const result = await runAction(mcpDisconnect, ctx(userId), {
      clientId: 'never-seen',
    })
    expect(result).toEqual({ disconnected: 0 })
  })
})
