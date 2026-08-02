/**
 * Unit tests for `userHasCapacity`, the check the audio socket uses. It
 * answers rather than throws, because a WebSocket has no error response to map
 * a 402 onto — and it errs toward allowing, since refusing to transcribe a
 * lecture is a worse failure than an uncounted minute.
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
  capFor: (tier: string, metric: string) =>
    metric === 'imageLookups' ? null : tier === 'pro' ? 1000 : 10,
  usedThisPeriod: async () => used,
}))

const { userHasCapacity } = await import('./meter-hooks')
const { UserModel } = await import('../models/user')

beforeEach(() => {
  userExists = true
  found.planTier = 'free'
  used = 0
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
