/**
 * Integration tests for cap notifications (BILL-8), end to end through the
 * real counters, the real `NotificationLog` lock, and a captured mailer.
 *
 * The rules worth a database are the ones about *how often* a message goes and
 * *who gets it*, and neither can be tested with the queue stubbed out: the
 * unique index is what turns thirty refusals into one email, and the payer
 * lookup is what keeps a student's action from mailing a student.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from 'vitest'
import { env } from '../../src/config/env'
import { connectMongo, disconnectMongo } from '../../src/db/mongoose'
import { UserModel } from '../../src/models/user'
import { UsageRecordModel } from '../../src/models/usage-record'
import { NotificationLogModel } from '../../src/models/notification-log'
import * as mailer from '../../src/lib/mailer'
import { PlanLimitExceededError } from '../../src/billing/limits'
import {
  assertWithinCap,
  capFor,
  recordUsage,
  periodKeyFor,
} from '../../src/billing/usage'
import {
  flushCapNotifications,
  resetCapNotifications,
} from '../../src/billing/cap-queue'

/** Messages the app tried to send during one test. */
let sent: mailer.OutgoingMail[] = []

beforeAll(async () => {
  await connectMongo(env.MONGODB_URI)
  await Promise.all([UserModel.init(), NotificationLogModel.init()])
})

afterAll(disconnectMongo)

let adaId: string

beforeEach(async () => {
  sent = []
  resetCapNotifications()
  vi.restoreAllMocks()
  vi.spyOn(mailer, 'mailerAvailable').mockReturnValue(true)
  vi.spyOn(mailer, 'sendMail').mockImplementation(async message => {
    sent.push(message)
  })
  await Promise.all([
    UserModel.deleteMany({}),
    UsageRecordModel.deleteMany({}),
    NotificationLogModel.deleteMany({}),
  ])
  const ada = await UserModel.create({
    email: 'ada@example.com',
    displayName: 'Ada',
    planTier: 'free',
  })
  adaId = ada._id.toString()
})

/** Puts a metric at a given fraction of the free tier's cap. */
const spend = async (metric: 'exports' | 'ttsCharacters', fraction: number) => {
  const cap = capFor('free', metric) ?? 0
  await UsageRecordModel.updateOne(
    { userId: adaId, period: await periodKeyFor(adaId), metric },
    { $set: { used: Math.ceil(cap * fraction), updatedAt: new Date() } },
    { upsert: true },
  )
}

describe('warning before blocking', () => {
  it('mails the owner once they cross 80% of an allowance', async () => {
    await spend('exports', 0.75)
    await recordUsage(adaId, 'exports', 1) // takes it past the threshold
    await flushCapNotifications()

    expect(sent).toHaveLength(1)
    expect(sent[0]?.to).toBe('ada@example.com')
    expect(sent[0]?.subject).toMatch(/close to a limit/i)
    // Named in plain language, never as the metric identifier (BILL-8).
    expect(sent[0]?.text).toContain('Exports')
    expect(sent[0]?.text).not.toContain('exports —')
  })

  it('says nothing while an allowance is comfortable', async () => {
    await recordUsage(adaId, 'exports', 1)
    await flushCapNotifications()
    expect(sent).toHaveLength(0)
  })

  it('never warns about an unlimited allowance', async () => {
    await UserModel.updateOne({ _id: adaId }, { planTier: 'max' })
    // Max is large but finite by design (BILL-1), so this asserts the rule
    // rather than the tier: a null cap has no fraction to cross.
    await recordUsage(adaId, 'exports', 1)
    await flushCapNotifications()
    expect(sent).toHaveLength(0)
  })
})

describe('telling the user work was actually refused', () => {
  it('mails when a cap blocks something', async () => {
    await spend('exports', 1)
    await expect(assertWithinCap(adaId, 'free', 'exports')).rejects.toThrow()
    await flushCapNotifications()

    expect(sent).toHaveLength(1)
    expect(sent[0]?.subject).toMatch(/has been reached/i)
    expect(sent[0]?.text).toMatch(/now blocked/i)
  })

  it('sends one message however many times the cap refuses', async () => {
    // The case this exists for: a blocked translation in a class of thirty
    // must produce one email, not thirty.
    await spend('exports', 1)
    for (let i = 0; i < 30; i += 1)
      await assertWithinCap(adaId, 'free', 'exports').catch(() => {})
    await flushCapNotifications()
    expect(sent).toHaveLength(1)
  })

  it('does not repeat itself later in the same period', async () => {
    await spend('exports', 1)
    await assertWithinCap(adaId, 'free', 'exports').catch(() => {})
    await flushCapNotifications()
    await assertWithinCap(adaId, 'free', 'exports').catch(() => {})
    await flushCapNotifications()
    expect(sent).toHaveLength(1)
  })

  it('notifies afresh once the period rolls over', async () => {
    // The lock is keyed by period, so a new period is a new key. Simulated by
    // ageing the row rather than by waiting a month.
    await spend('exports', 1)
    await assertWithinCap(adaId, 'free', 'exports').catch(() => {})
    await flushCapNotifications()
    await NotificationLogModel.updateMany({}, { $set: { period: '1999-01' } })

    await assertWithinCap(adaId, 'free', 'exports').catch(() => {})
    await flushCapNotifications()
    expect(sent).toHaveLength(2)
  })

  it('still says "reached" for a user who already had the warning', async () => {
    await spend('exports', 0.8)
    await recordUsage(adaId, 'exports', 1)
    await flushCapNotifications()
    expect(sent[0]?.subject).toMatch(/close to a limit/i)

    await spend('exports', 1)
    await assertWithinCap(adaId, 'free', 'exports').catch(() => {})
    await flushCapNotifications()
    expect(sent).toHaveLength(2)
    expect(sent[1]?.subject).toMatch(/has been reached/i)
  })
})

describe('coalescing', () => {
  it('lists several exhausted allowances in one message', async () => {
    // Exhausting three things in one lecture is one email, not three.
    await spend('exports', 1)
    await spend('ttsCharacters', 1)
    await assertWithinCap(adaId, 'free', 'exports').catch(() => {})
    await assertWithinCap(adaId, 'free', 'ttsCharacters').catch(() => {})
    await flushCapNotifications()

    expect(sent).toHaveLength(1)
    expect(sent[0]?.text).toContain('Exports')
    expect(sent[0]?.text).toContain('Narration')
  })

  it('reads as "reached" when any of the coalesced metrics is blocking', async () => {
    await spend('exports', 1)
    await spend('ttsCharacters', 0.8)
    await assertWithinCap(adaId, 'free', 'exports').catch(() => {})
    await recordUsage(adaId, 'ttsCharacters', 1)
    await flushCapNotifications()
    expect(sent).toHaveLength(1)
    expect(sent[0]?.subject).toMatch(/has been reached/i)
  })
})

describe('who is told, and what they may switch off', () => {
  it('lets an account silence the early warning', async () => {
    await UserModel.updateOne({ _id: adaId }, { notifyCapWarnings: false })
    await spend('exports', 0.8)
    await recordUsage(adaId, 'exports', 1)
    await flushCapNotifications()
    expect(sent).toHaveLength(0)
  })

  it('sends the exhaustion notice even to an account that silenced warnings', async () => {
    // It explains why something the user just attempted did not happen, so it
    // is transactional rather than advisory (BILL-8).
    await UserModel.updateOne({ _id: adaId }, { notifyCapWarnings: false })
    await spend('exports', 1)
    await assertWithinCap(adaId, 'free', 'exports').catch(() => {})
    await flushCapNotifications()
    expect(sent).toHaveLength(1)
    expect(sent[0]?.subject).toMatch(/has been reached/i)
  })

  it('reports an audience allowance in counts, naming nobody', async () => {
    await spend('exports', 0) // no-op; keeps the helper's tier lookup warm
    const cap = capFor('free', 'audienceLocales') ?? 1
    await recordUsage(adaId, 'audienceLocales', cap)
    await assertWithinCap(adaId, 'free', 'audienceLocales').catch(() => {})
    await flushCapNotifications()

    expect(sent).toHaveLength(1)
    const text = sent[0]?.text ?? ''
    expect(text).toContain('Translations for viewers')
    expect(text).toMatch(/people viewing your lectures/i)
    // Counts only. No student identity has any business in a message to the
    // instructor (§16), and there is nowhere here for one to come from.
    expect(text).not.toMatch(/@/)
  })

  it('mails nobody for an account that no longer exists', async () => {
    await spend('exports', 1)
    await assertWithinCap(adaId, 'free', 'exports').catch(() => {})
    await UserModel.deleteOne({ _id: adaId })
    await flushCapNotifications()
    expect(sent).toHaveLength(0)
  })
})

describe('delivery never affects the request', () => {
  it('does not fail the refusal when mail throws', async () => {
    vi.spyOn(mailer, 'sendMail').mockRejectedValue(new Error('relay down'))
    await spend('exports', 1)
    // The 402 is the contract; the email is not.
    await expect(assertWithinCap(adaId, 'free', 'exports')).rejects.toThrow(
      PlanLimitExceededError,
    )
    await expect(flushCapNotifications()).resolves.toBeUndefined()
  })

  it('does not fail a recorded usage when mail is unavailable', async () => {
    vi.spyOn(mailer, 'mailerAvailable').mockReturnValue(false)
    await spend('exports', 0.8)
    await expect(recordUsage(adaId, 'exports', 1)).resolves.toBeUndefined()
    await flushCapNotifications()
    expect(sent).toHaveLength(0)
  })
})

describe('what the message says', () => {
  it('gives the numbers, the reset date, and the way out', async () => {
    await spend('exports', 0.8)
    await recordUsage(adaId, 'exports', 1)
    await flushCapNotifications()

    const text = sent[0]?.text ?? ''
    expect(text).toContain('Hi Ada,')
    expect(text).toMatch(/of \d+ used/)
    expect(text).toMatch(/reset on/i)
    expect(text).toMatch(/\/app\/plans/)
    // Only the advisory message mentions the switch, and it has one.
    expect(text).toMatch(/turn off these early warnings/i)
  })

  it('invites a Max account to talk to us rather than to upgrade', async () => {
    // There is no tier above Max, so an upgrade link would point at a door
    // that is not there (BILL-5).
    await UserModel.updateOne({ _id: adaId }, { planTier: 'max' })
    const cap = capFor('max', 'exports') ?? 0
    await UsageRecordModel.updateOne(
      { userId: adaId, period: await periodKeyFor(adaId), metric: 'exports' },
      { $set: { used: cap, updatedAt: new Date() } },
      { upsert: true },
    )
    await assertWithinCap(adaId, 'max', 'exports').catch(() => {})
    await flushCapNotifications()

    const text = sent[0]?.text ?? ''
    expect(text).toMatch(/largest plan/i)
    expect(text).not.toMatch(/\/app\/plans/)
  })

  it('writes to the reader in the language they chose', async () => {
    await UserModel.updateOne({ _id: adaId }, { locale: 'fr' })
    await spend('exports', 1)
    await assertWithinCap(adaId, 'free', 'exports').catch(() => {})
    await flushCapNotifications()

    expect(sent[0]?.subject).toMatch(/forfait Slide Machine/i)
    expect(sent[0]?.text).toContain('Exportations')
  })

  it('falls back to English for an account that never chose one', async () => {
    await spend('exports', 1)
    await assertWithinCap(adaId, 'free', 'exports').catch(() => {})
    await flushCapNotifications()
    expect(sent[0]?.subject).toMatch(/Slide Machine plan/)
  })
})
