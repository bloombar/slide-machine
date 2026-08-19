/**
 * Integration tests for the admin view of one account's usage
 * (GET /api/admin/users/:id/usage): the same summary the account's own footer
 * badge reads (BILL-4), opened to the allowlist because the self-service
 * `user.usage` action deliberately takes no target. MongoDB is real; the
 * counters are driven directly.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { Types } from 'mongoose'
import type { UsageSummaryResponse } from '@slide-machine/shared'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { UsageRecordModel } from '../../src/models/usage-record'
import { SubscriptionModel } from '../../src/models/subscription'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import { adjustGauge, capFor, recordUsage } from '../../src/billing/usage'

const ADMIN_EMAIL = 'admin@example.com'

const server = createApp().listen(0)

beforeAll(async () => {
  process.env.ADMIN_EMAILS = ADMIN_EMAIL
  await connectMongo(env.MONGODB_URI)
  await Promise.all([UserModel.init(), UsageRecordModel.init()])
})

afterAll(async () => {
  delete process.env.ADMIN_EMAILS
  await disconnectMongo()
  server.close()
})

const registerUser = async (email: string): Promise<string> => {
  const res = await request(server)
    .post('/api/auth/register')
    .send({ email, password: 'longenough1', displayName: email.split('@')[0] })
  return res.body.accessToken as string
}

const usage = (token: string, userId: string, window?: string) =>
  request(server)
    .get(`/api/admin/users/${userId}/usage${window ? `?window=${window}` : ''}`)
    .set('Authorization', `Bearer ${token}`)

let admin: string
let ada: string
let adaId: string

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    UsageRecordModel.deleteMany({}),
    SubscriptionModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
  ])
  admin = await registerUser(ADMIN_EMAIL)
  ada = await registerUser('ada@example.com')
  adaId = (await UserModel.findOne({
    email: 'ada@example.com',
  }))!._id.toString()
})

describe('gating', () => {
  it('401s anonymous and 403s a non-admin', async () => {
    const anon = await request(server).get(`/api/admin/users/${adaId}/usage`)
    expect(anon.status).toBe(401)

    const nonAdmin = await usage(ada, adaId)
    expect(nonAdmin.status).toBe(403)
  })

  it('404s an unknown or malformed user id', async () => {
    const unknown = await usage(admin, new Types.ObjectId().toString())
    expect(unknown.status).toBe(404)

    const malformed = await usage(admin, 'not-an-id')
    expect(malformed.status).toBe(404)
  })

  it('rejects a window it does not know', async () => {
    const res = await usage(admin, adaId, 'last-week')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('invalid_input')
  })
})

describe('current period (the default)', () => {
  it("reports the target account's usage, not the caller's", async () => {
    await recordUsage(adaId, 'aiTokens', 1000)

    const res = await usage(admin, adaId)
    const body = res.body as UsageSummaryResponse

    expect(res.status).toBe(200)
    expect(body.tier).toBe('free')
    // The full badge shape: every metered resource, ordered for the meters.
    expect(body.metrics).toHaveLength(13)
    expect(body.metrics.find(m => m.metric === 'aiTokens')).toMatchObject({
      used: 1000,
      cap: capFor('free', 'aiTokens'),
      unit: 'tokens',
      allowance: 'instructor',
      gauge: false,
    })
    expect(new Date(body.resetAt).getTime()).toBeGreaterThan(Date.now())
  })

  it("reads the target's effective tier, grant included", async () => {
    // A complimentary grant raises what the account may spend (ADMIN-9), so
    // the admin view must price its meters against the granted tier — the
    // same answer every cap check uses.
    await UserModel.updateOne(
      { _id: adaId },
      {
        $set: {
          planGrant: {
            tier: 'pro',
            expiresAt: new Date(Date.now() + 86_400_000),
            grantedAt: new Date(),
            grantedBy: new Types.ObjectId(),
            grantedByEmail: ADMIN_EMAIL,
          },
        },
      },
    )

    const body = (await usage(admin, adaId)).body as UsageSummaryResponse

    expect(body.tier).toBe('pro')
    expect(body.metrics.find(m => m.metric === 'aiTokens')?.cap).toBe(
      capFor('pro', 'aiTokens'),
    )
  })
})

describe('all time', () => {
  it('totals every period, not just the current one', async () => {
    // A counter from a long-closed period, written directly — the metering
    // path can only ever write into the current one.
    await UsageRecordModel.create({
      userId: new Types.ObjectId(adaId),
      period: '2020-01',
      metric: 'aiTokens',
      used: 500,
    })
    await recordUsage(adaId, 'aiTokens', 1000)

    const period = (await usage(admin, adaId)).body as UsageSummaryResponse
    const all = (await usage(admin, adaId, 'all')).body as UsageSummaryResponse

    expect(period.metrics.find(m => m.metric === 'aiTokens')?.used).toBe(1000)
    expect(all.metrics.find(m => m.metric === 'aiTokens')?.used).toBe(1500)
    expect(all.period).toBe('all')
  })

  it('drops per-period caps on flows but keeps the storage gauge’s', async () => {
    await recordUsage(adaId, 'aiTokens', 1000)
    await adjustGauge(adaId, 'audioStorageMb', 40)

    const body = (await usage(admin, adaId, 'all')).body as UsageSummaryResponse

    // A monthly allowance is no bound on a lifetime total; drawing one would
    // read as a massive overrun.
    const tokens = body.metrics.find(m => m.metric === 'aiTokens')
    expect(tokens).toMatchObject({ used: 1000, cap: null, fraction: null })

    // The gauge measures what is held right now, which no window changes.
    const storage = body.metrics.find(m => m.metric === 'audioStorageMb')
    expect(storage).toMatchObject({
      used: 40,
      cap: capFor('free', 'audioStorageMb'),
      gauge: true,
    })
    expect(storage?.fraction).not.toBeNull()
  })
})
