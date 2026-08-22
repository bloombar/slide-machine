/**
 * Integration tests for the admin surface on one account's usage: the read
 * (GET /api/admin/users/:id/usage) — the same summary the account's own
 * footer badge reads (BILL-4), opened to the allowlist because the
 * self-service `user.usage` action deliberately takes no target — and the
 * reset (POST .../usage/reset, ADMIN-10), which hands the current period's
 * allowances back. MongoDB is real; the counters are driven directly.
 *
 * The reset's interesting cases are all about what it must *not* touch: past
 * periods, the storage gauge, and the cost ledger are what the deployment
 * actually spent, and a reset that rewrote them would make an operator's
 * favour indistinguishable from usage that never happened.
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
import { AdminActionLogModel } from '../../src/models/admin-action-log'
import {
  NotificationLogModel,
  claimNotification,
} from '../../src/models/notification-log'
import {
  adjustGauge,
  capFor,
  periodKeyFor,
  recordUsage,
} from '../../src/billing/usage'

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

const reset = (token: string, userId: string) =>
  request(server)
    .post(`/api/admin/users/${userId}/usage/reset`)
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
    AdminActionLogModel.deleteMany({}),
    NotificationLogModel.deleteMany({}),
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

describe('resetting the period’s allowances (ADMIN-10)', () => {
  it('401s anonymous and 403s a non-admin', async () => {
    await recordUsage(adaId, 'aiTokens', 1000)

    const anon = await request(server).post(
      `/api/admin/users/${adaId}/usage/reset`,
    )
    expect(anon.status).toBe(401)

    const nonAdmin = await reset(ada, adaId)
    expect(nonAdmin.status).toBe(403)

    // Neither got as far as the counters, and neither is in the audit log.
    const body = (await usage(admin, adaId)).body as UsageSummaryResponse
    expect(body.metrics.find(m => m.metric === 'aiTokens')?.used).toBe(1000)
    expect(await AdminActionLogModel.countDocuments()).toBe(0)
  })

  it('404s an unknown, malformed, or deleted account', async () => {
    expect((await reset(admin, new Types.ObjectId().toString())).status).toBe(
      404,
    )
    expect((await reset(admin, 'not-an-id')).status).toBe(404)

    // A tombstoned account is restored, not adjusted (ADMIN-6).
    await UserModel.updateOne(
      { _id: adaId },
      { $set: { deletedAt: new Date() } },
    )
    expect((await reset(admin, adaId)).status).toBe(404)
  })

  it('zeroes this period’s counters and reports what they were', async () => {
    await recordUsage(adaId, 'aiTokens', 1000)
    await recordUsage(adaId, 'exports', 3)

    const res = await reset(admin, adaId)

    expect(res.status).toBe(200)
    expect(res.body.period).toBe(await periodKeyFor(adaId))
    // The "before" is the whole point: an account that had spent nothing and
    // one whose counters were wiped both read zero afterwards.
    expect(res.body.cleared).toEqual({ aiTokens: 1000, exports: 3 })

    const body = (await usage(admin, adaId)).body as UsageSummaryResponse
    expect(body.metrics.find(m => m.metric === 'aiTokens')?.used).toBe(0)
    expect(body.metrics.find(m => m.metric === 'exports')?.used).toBe(0)
    // The account can spend against its caps again, which is the point.
    expect(body.metrics.find(m => m.metric === 'aiTokens')?.fraction).toBe(0)
  })

  it('says nothing was cleared when the account had spent nothing', async () => {
    const res = await reset(admin, adaId)

    expect(res.status).toBe(200)
    expect(res.body.cleared).toEqual({})
  })

  it('leaves past periods and the storage gauge alone', async () => {
    await UsageRecordModel.create({
      userId: new Types.ObjectId(adaId),
      period: '2020-01',
      metric: 'aiTokens',
      used: 500,
    })
    await recordUsage(adaId, 'aiTokens', 1000)
    await adjustGauge(adaId, 'audioStorageMb', 40)

    const res = await reset(admin, adaId)

    // Retained audio still occupies a disk; no reset makes that untrue.
    expect(res.body.cleared).toEqual({ aiTokens: 1000 })
    const all = (await usage(admin, adaId, 'all')).body as UsageSummaryResponse
    expect(all.metrics.find(m => m.metric === 'audioStorageMb')?.used).toBe(40)
    // What the account actually consumed in closed periods still stands, so
    // lifetime totals and the cost reports read the same as before.
    expect(all.metrics.find(m => m.metric === 'aiTokens')?.used).toBe(500)
  })

  it('audits it with the period and what was cleared', async () => {
    await recordUsage(adaId, 'aiTokens', 1000)

    await reset(admin, adaId)

    const entry = (await AdminActionLogModel.findOne({
      action: 'user.usage_reset',
    }))!
    expect(entry.actorEmail).toBe(ADMIN_EMAIL)
    expect(entry.targetType).toBe('user')
    expect(entry.targetId).toBe(adaId)
    expect(entry.details).toMatchObject({
      email: 'ada@example.com',
      period: await periodKeyFor(adaId),
      cleared: { aiTokens: 1000 },
      targetIsAdmin: false,
      self: false,
    })
  })

  it('lets the account be warned again about a cap it already hit', async () => {
    const period = await periodKeyFor(adaId)
    await claimNotification(adaId, 'aiTokens', period, 'reached')
    await claimNotification(adaId, 'audioStorageMb', period, 'approaching')
    await recordUsage(adaId, 'aiTokens', 1000)

    await reset(admin, adaId)

    // The claim row means "already told about this metric this period", which
    // stops being true once the allowance behind it is given back (BILL-8).
    expect(
      await NotificationLogModel.countDocuments({ metric: 'aiTokens' }),
    ).toBe(0)
    // The gauge was not reset, so nothing it was told has changed.
    expect(
      await NotificationLogModel.countDocuments({ metric: 'audioStorageMb' }),
    ).toBe(1)
  })

  it('allows it against an allowlisted account, and says so in the log', async () => {
    const adminId = (await UserModel.findOne({ email: ADMIN_EMAIL }))!._id
    await recordUsage(adminId.toString(), 'aiTokens', 1000)

    // Unlike moderation, this only ever hands an allowance back, so an admin
    // is not locked out of it — the audit entry is what keeps it visible.
    const res = await reset(admin, adminId.toString())

    expect(res.status).toBe(200)
    expect(res.body.cleared).toEqual({ aiTokens: 1000 })
    const entry = (await AdminActionLogModel.findOne({
      action: 'user.usage_reset',
    }))!
    expect(entry.details).toMatchObject({ targetIsAdmin: true, self: true })
  })
})
