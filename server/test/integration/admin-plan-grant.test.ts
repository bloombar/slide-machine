/**
 * Integration tests for complimentary plan grants (ADMIN-9) against a real
 * MongoDB and the in-memory billing adapter: the audited endpoints an admin
 * uses, what a grant actually changes for the account, and — the case the
 * whole design exists for — what happens when it ends.
 *
 * The interesting tests are the endings. A grant must lapse without anything
 * having to run, must return the account to what it is paying for *at that
 * moment* rather than to a snapshot taken when the grant was issued, and must
 * never be able to take away a plan someone has since bought.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import type { PlanTier } from '@slide-machine/shared'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { createApp } from '../../src/app'
import { UserModel } from '../../src/models/user'
import { SubscriptionModel } from '../../src/models/subscription'
import { RefreshTokenModel } from '../../src/models/refresh-token'
import { AdminActionLogModel } from '../../src/models/admin-action-log'
import { SettingsChangeLogModel } from '../../src/models/settings-change-log'

const ADMIN_EMAIL = 'admin@example.com'

const server = createApp().listen(0)

beforeAll(async () => {
  process.env.ADMIN_EMAILS = ADMIN_EMAIL
  await connectMongo(env.MONGODB_URI)
  await UserModel.init()
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

const idOf = async (email: string): Promise<string> =>
  (await UserModel.findOne({ email }))!._id.toString()

const act = (token: string, name: string, input: object = {}) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(input)

const grant = (token: string, userId: string, body: unknown) =>
  request(server)
    .put(`/api/admin/users/${userId}/plan-grant`)
    .set('Authorization', `Bearer ${token}`)
    .send(body as object)

const revoke = (token: string, userId: string) =>
  request(server)
    .delete(`/api/admin/users/${userId}/plan-grant`)
    .set('Authorization', `Bearer ${token}`)

const adminUser = (token: string, userId: string) =>
  request(server)
    .get(`/api/admin/users/${userId}`)
    .set('Authorization', `Bearer ${token}`)

/** An ISO instant `days` from now — an expiry that is unambiguously future. */
const inDays = (days: number): string =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

/** Writes a grant straight onto the account, for the states an endpoint
 * cannot produce — chiefly one that has already lapsed. */
const storeGrant = async (
  userId: string,
  tier: PlanTier,
  expiresAt: Date,
): Promise<void> => {
  await UserModel.updateOne(
    { _id: userId },
    {
      $set: {
        planGrant: {
          tier,
          expiresAt,
          grantedAt: new Date(expiresAt.getTime() - 86_400_000),
          grantedBy: userId,
          grantedByEmail: ADMIN_EMAIL,
        },
      },
    },
  )
}

const auditEntries = () => AdminActionLogModel.find().sort({ createdAt: 1 })

let admin: string
let ada: string
let adaId: string

beforeEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    SubscriptionModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
    AdminActionLogModel.deleteMany({}),
    SettingsChangeLogModel.deleteMany({}),
  ])
  admin = await registerUser(ADMIN_EMAIL)
  ada = await registerUser('ada@example.com')
  adaId = await idOf('ada@example.com')
})

describe('gating', () => {
  it('401s anonymous and 403s a non-admin', async () => {
    const body = { tier: 'pro', expiresAt: inDays(30) }

    const anon = await request(server)
      .put(`/api/admin/users/${adaId}/plan-grant`)
      .send(body)
    expect(anon.status).toBe(401)

    const forbidden = await grant(ada, adaId, body)
    expect(forbidden.status).toBe(403)

    expect((await UserModel.findById(adaId))!.planGrant).toBeFalsy()
    expect(await AdminActionLogModel.countDocuments()).toBe(0)
  })

  // "Admins are not moderated" (ADMIN-1) keeps an operator from being locked
  // out of their own console; a grant only ever hands something over, so it is
  // allowed — and the audit entry, not a refusal, is what keeps it honest.
  it('grants a plan to an allowlisted account, flagged in the log', async () => {
    const adminId = await idOf(ADMIN_EMAIL)

    const res = await grant(admin, adminId, {
      tier: 'max',
      expiresAt: inDays(30),
    })

    expect(res.status).toBe(204)
    expect((await UserModel.findById(adminId))!.planGrant?.tier).toBe('max')

    const entry = (await AdminActionLogModel.findOne({
      action: 'user.plan_grant',
    }))!
    expect(entry.details).toMatchObject({ targetIsAdmin: true, self: true })
  })

  // The same flags on an ordinary grant, so a reader does not have to know
  // that their absence would have meant "not an admin".
  it('records an ordinary grant as neither admin-targeted nor self-dealt', async () => {
    await grant(admin, adaId, { tier: 'pro', expiresAt: inDays(30) })

    const entry = (await AdminActionLogModel.findOne({
      action: 'user.plan_grant',
    }))!
    expect(entry.details).toMatchObject({ targetIsAdmin: false, self: false })
  })
})

describe('granting a plan', () => {
  it('puts the account on the tier without charging it', async () => {
    const res = await grant(admin, adaId, {
      tier: 'pro',
      expiresAt: inDays(30),
      note: 'Pilot department',
    })
    expect(res.status).toBe(204)

    const summary = await act(ada, 'billing.summary')
    expect(summary.body.tier).toBe('pro')
    expect(summary.body.planGrant.tier).toBe('pro')
    expect(summary.body.planGrant.revertsTo).toBe('free')
    // Entitlement, not a purchase: nothing was subscribed and nothing is due.
    expect(summary.body.status).toBeNull()
    expect(summary.body.canManageBilling).toBe(false)
    expect(await SubscriptionModel.countDocuments()).toBe(0)
    // The account's own billing tier is untouched — the grant sits beside it.
    expect((await UserModel.findById(adaId))!.planTier).toBe('free')
  })

  it('meters the account against the granted tier', async () => {
    const free = await act(ada, 'user.usage')
    const freeTokens = free.body.metrics.find(
      (m: { metric: string }) => m.metric === 'aiTokens',
    ).cap

    await grant(admin, adaId, { tier: 'pro', expiresAt: inDays(30) })

    const granted = await act(ada, 'user.usage')
    expect(granted.body.tier).toBe('pro')
    const proTokens = granted.body.metrics.find(
      (m: { metric: string }) => m.metric === 'aiTokens',
    ).cap
    expect(proTokens).toBeGreaterThan(freeTokens)
  })

  it('reads a bare date as the end of that day', async () => {
    // Picking today has to leave the account comped for the rest of it,
    // rather than expiring at midnight this morning.
    const today = new Date().toISOString().slice(0, 10)

    const res = await grant(admin, adaId, { tier: 'pro', expiresAt: today })

    expect(res.status).toBe(204)
    const stored = (await UserModel.findById(adaId))!.planGrant!
    expect(stored.expiresAt.toISOString()).toBe(`${today}T23:59:59.999Z`)
    expect((await act(ada, 'billing.summary')).body.tier).toBe('pro')
  })

  it('records the grant in the audit log, and nowhere else', async () => {
    await grant(admin, adaId, {
      tier: 'pro',
      expiresAt: inDays(30),
      note: 'Pilot department',
    })

    const [entry, ...rest] = await auditEntries()
    expect(rest).toHaveLength(0)
    expect(entry!.action).toBe('user.plan_grant')
    expect(entry!.actorEmail).toBe(ADMIN_EMAIL)
    expect(entry!.targetId).toBe(adaId)
    expect(entry!.details).toMatchObject({
      email: 'ada@example.com',
      tier: 'pro',
      revertsTo: 'free',
      note: 'Pilot department',
    })
    // A plan is billing state, not a profile setting: it stays out of the
    // settings change log, which tracks what an account *is* (ADMIN-8).
    expect(await SettingsChangeLogModel.countDocuments()).toBe(0)
  })

  it('replaces a standing grant rather than stacking one', async () => {
    await grant(admin, adaId, { tier: 'pro', expiresAt: inDays(30) })
    const res = await grant(admin, adaId, {
      tier: 'max',
      expiresAt: inDays(60),
    })
    expect(res.status).toBe(204)

    expect((await act(ada, 'billing.summary')).body.tier).toBe('max')
    const entries = await auditEntries()
    expect(entries).toHaveLength(2)
    expect(entries[1]!.details).toMatchObject({
      tier: 'max',
      replaced: { tier: 'pro' },
    })
  })
})

describe('refusals', () => {
  const cases: Array<[string, unknown, string]> = [
    [
      'an expiry in the past',
      { tier: 'pro', expiresAt: inDays(-1) },
      'invalid_input',
    ],
    ['no expiry at all', { tier: 'pro' }, 'invalid_input'],
    [
      'an expiry that is not a date',
      { tier: 'pro', expiresAt: 'soon' },
      'invalid_input',
    ],
    [
      'a tier that does not exist',
      { tier: 'platinum', expiresAt: inDays(30) },
      'invalid_input',
    ],
    [
      'a field it does not know',
      { tier: 'pro', expiresAt: inDays(30), planTier: 'max' },
      'invalid_input',
    ],
  ]

  for (const [what, body, code] of cases) {
    it(`rejects ${what}`, async () => {
      const res = await grant(admin, adaId, body)

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe(code)
      expect((await UserModel.findById(adaId))!.planGrant).toBeFalsy()
      expect(await AdminActionLogModel.countDocuments()).toBe(0)
    })
  }

  // A grant can only be a gift. Storing one at or below the account's own
  // tier would change nothing while reporting that a plan had been given.
  it('rejects a tier the account already has', async () => {
    await UserModel.updateOne({ _id: adaId }, { $set: { planTier: 'pro' } })

    const same = await grant(admin, adaId, {
      tier: 'pro',
      expiresAt: inDays(30),
    })
    expect(same.status).toBe(400)
    expect(same.body.error.code).toBe('not_an_upgrade')

    const lower = await grant(admin, adaId, {
      tier: 'fresh',
      expiresAt: inDays(30),
    })
    expect(lower.status).toBe(400)
    expect(lower.body.error.code).toBe('not_an_upgrade')
  })

  it('404s an unknown account', async () => {
    const res = await grant(admin, '0'.repeat(24), {
      tier: 'pro',
      expiresAt: inDays(30),
    })
    expect(res.status).toBe(404)
  })
})

describe('the grant ending', () => {
  it('lapses on its own, with nothing having to run', async () => {
    await storeGrant(adaId, 'pro', new Date(Date.now() - 1000))

    // No sweep, no job, no write: the account is simply back on its own plan.
    const summary = await act(ada, 'billing.summary')
    expect(summary.body.tier).toBe('free')
    expect(summary.body.planGrant).toBeUndefined()
    expect((await act(ada, 'user.usage')).body.tier).toBe('free')
  })

  it('reverts to what the account pays for now, not what it paid for then', async () => {
    // Comped Pro while on Free…
    await grant(admin, adaId, { tier: 'pro', expiresAt: inDays(30) })
    // …then the account buys Fresh of its own accord, mid-grant.
    await UserModel.updateOne({ _id: adaId }, { $set: { planTier: 'fresh' } })
    expect((await act(ada, 'billing.summary')).body.tier).toBe('pro')

    await storeGrant(adaId, 'pro', new Date(Date.now() - 1000))

    // Fresh, not the Free it was on when the grant was written.
    expect((await act(ada, 'billing.summary')).body.tier).toBe('fresh')
  })

  it('never takes away a larger plan the account bought meanwhile', async () => {
    await grant(admin, adaId, { tier: 'pro', expiresAt: inDays(30) })
    await UserModel.updateOne({ _id: adaId }, { $set: { planTier: 'max' } })

    const summary = await act(ada, 'billing.summary')
    expect(summary.body.tier).toBe('max')
    // The grant is inert rather than gone: the console still shows it.
    expect(summary.body.planGrant).toBeUndefined()
    expect((await adminUser(admin, adaId)).body.planGrant.inEffect).toBe(false)
  })

  it('ends early when revoked, and says so in the audit log', async () => {
    await grant(admin, adaId, { tier: 'pro', expiresAt: inDays(30) })

    const res = await revoke(admin, adaId)
    expect(res.status).toBe(204)

    expect((await act(ada, 'billing.summary')).body.tier).toBe('free')
    expect((await UserModel.findById(adaId))!.planGrant).toBeFalsy()
    const entries = await auditEntries()
    expect(entries[1]!.action).toBe('user.plan_grant_revoke')
    expect(entries[1]!.details).toMatchObject({
      tier: 'pro',
      wasInEffect: true,
      revertedTo: 'free',
    })
  })

  it('revokes idempotently, logging nothing when there is nothing to end', async () => {
    const res = await revoke(admin, adaId)

    expect(res.status).toBe(204)
    expect(await AdminActionLogModel.countDocuments()).toBe(0)
  })
})

describe('the admin views', () => {
  it('shows the effective tier, what it pays for, and the grant', async () => {
    await grant(admin, adaId, {
      tier: 'pro',
      expiresAt: inDays(30),
      note: 'Pilot department',
    })

    const res = await adminUser(admin, adaId)
    expect(res.body.user.planTier).toBe('pro')
    expect(res.body.billingTier).toBe('free')
    expect(res.body.planGrant).toMatchObject({
      tier: 'pro',
      grantedByEmail: ADMIN_EMAIL,
      note: 'Pilot department',
      inEffect: true,
    })
  })

  it('lists the effective tier in the user directory', async () => {
    await grant(admin, adaId, { tier: 'max', expiresAt: inDays(30) })

    const res = await request(server)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${admin}`)
    const row = res.body.users.find(
      (u: { email: string }) => u.email === 'ada@example.com',
    )
    expect(row.planTier).toBe('max')
  })

  // The account is told what it has and until when; who gave it and why are
  // the operator's record (ADMIN-7), not the account's.
  it('keeps the granting admin and the note off the account’s own view', async () => {
    await grant(admin, adaId, {
      tier: 'pro',
      expiresAt: inDays(30),
      note: 'Pilot department',
    })

    const summary = await act(ada, 'billing.summary')
    expect(JSON.stringify(summary.body)).not.toContain('Pilot department')
    expect(JSON.stringify(summary.body)).not.toContain(ADMIN_EMAIL)
  })
})

describe('a subscription arriving during a grant', () => {
  /** A normalized webhook delivery, as the mock adapter accepts it. */
  const deliver = (tier: PlanTier, providerEventId: string) =>
    request(server)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .send(
        JSON.stringify({
          type: 'subscription.active',
          providerEventId,
          occurredAt: new Date().toISOString(),
          subscription: {
            providerSubscriptionId: 'sub_1',
            billingCustomerId: 'cus_1',
            userId: adaId,
            tier,
            status: 'active',
            currentPeriodStart: '2026-08-01T00:00:00.000Z',
            currentPeriodEnd: '2026-09-01T00:00:00.000Z',
            cancelAtPeriodEnd: false,
          },
        }),
      )

  it('records the purchase without disturbing the grant', async () => {
    await grant(admin, adaId, { tier: 'max', expiresAt: inDays(30) })

    expect((await deliver('fresh', 'evt_1')).status).toBe(200)

    const user = (await UserModel.findById(adaId))!
    // The webhook owns planTier; the grant owns nothing but itself.
    expect(user.planTier).toBe('fresh')
    expect(user.planGrant!.tier).toBe('max')
    // And the account keeps the larger of the two while the grant runs.
    expect((await act(ada, 'billing.summary')).body.tier).toBe('max')
  })

  it('leaves the purchase behind when the grant lapses', async () => {
    await grant(admin, adaId, { tier: 'max', expiresAt: inDays(30) })
    await deliver('pro', 'evt_1')
    await storeGrant(adaId, 'max', new Date(Date.now() - 1000))

    const summary = await act(ada, 'billing.summary')
    expect(summary.body.tier).toBe('pro')
    expect(summary.body.status).toBe('active')
  })
})
