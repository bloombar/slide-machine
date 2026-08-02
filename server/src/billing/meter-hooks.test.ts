/**
 * Unit tests for the two cap checks callers outside the action pipeline use.
 *
 * `assertUserCapacity` throws (→ 402) and is what a route or a mid-action
 * service calls; `userHasCapacity` answers instead, because the audio socket
 * has no error response to map a 402 onto — and it errs toward allowing, since
 * refusing to transcribe a lecture is a worse failure than an uncounted minute.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const found = { planTier: 'free' as string | undefined }
let userExists = true
let used = 0

vi.mock('../models/user', () => ({
  UserModel: {
    findById: vi.fn(() => ({
      select: async () => (userExists ? found : null),
    })),
  },
}))
vi.mock('./usage', () => ({
  assertWithinCap: vi.fn(),
  capFor: vi.fn((tier: string, metric: string) =>
    metric === 'imageLookups' ? null : tier === 'pro' ? 1000 : 10,
  ),
  usedThisPeriod: async () => used,
}))

const { userHasCapacity, assertUserCapacity } = await import('./meter-hooks')
const { UserModel } = await import('../models/user')
const { assertWithinCap, capFor } = await import('./usage')

beforeEach(() => {
  userExists = true
  found.planTier = 'free'
  used = 0
  vi.mocked(assertWithinCap).mockClear()
})

describe('assertUserCapacity', () => {
  it('checks the metric against the user’s own tier', async () => {
    found.planTier = 'pro'
    await assertUserCapacity('u1', 'exports', 'Out of exports.')
    expect(assertWithinCap).toHaveBeenCalledWith(
      'u1',
      'pro',
      'exports',
      'Out of exports.',
    )
  })

  it('says "not included" rather than "used up" when the cap is 0', async () => {
    // A tier with a 0 cap never had the capability, so telling the user they
    // have spent it all would be a lie. No shipped tier does this, but a
    // deployment can switch a service off (BILL-3).
    vi.mocked(capFor).mockReturnValueOnce(0)
    await assertUserCapacity('u1', 'aiImages', 'Out of images.')
    expect(assertWithinCap).toHaveBeenCalledWith(
      'u1',
      'free',
      'aiImages',
      'This feature is not included in your current plan.',
    )
  })

  it('lets a deleted account through rather than answering 402', async () => {
    // Their request is about to fail on its own; a payment-required response
    // would be a confusing way to say "this account is gone".
    userExists = false
    await assertUserCapacity('ghost', 'exports', 'Out of exports.')
    expect(assertWithinCap).not.toHaveBeenCalled()
  })
})

describe('userHasCapacity', () => {
  it('allows a user under their cap', async () => {
    used = 9
    expect(await userHasCapacity('u1', 'sttMinutes')).toBe(true)
  })

  it('refuses once usage reaches the cap', async () => {
    used = 10
    expect(await userHasCapacity('u1', 'sttMinutes')).toBe(false)
  })

  it('reads the cap for the user’s own tier', async () => {
    used = 500
    found.planTier = 'pro'
    expect(await userHasCapacity('u1', 'sttMinutes')).toBe(true)
  })

  it('always allows an unlimited cap', async () => {
    used = 10 ** 9
    expect(await userHasCapacity('u1', 'imageLookups')).toBe(true)
  })

  it('allows an unknown user rather than refusing to transcribe', async () => {
    userExists = false
    used = 10 ** 9
    expect(await userHasCapacity('ghost', 'sttMinutes')).toBe(true)
  })

  it('allows when the lookup itself fails', async () => {
    // A malformed id (the socket's user comes straight from a token) or an
    // unreachable database must not sever a live lecture.
    vi.mocked(UserModel.findById).mockImplementationOnce(() => {
      throw new Error('CastError: not an ObjectId')
    })

    expect(await userHasCapacity('not-an-id', 'sttMinutes')).toBe(true)
  })
})
