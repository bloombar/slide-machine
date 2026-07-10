/**
 * Unit tests for token primitives: JWT roundtrip, tamper and expiry
 * rejection, and refresh-token hashing properties.
 */
import { describe, it, expect } from 'vitest'
import {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
} from './tokens'

describe('access tokens', () => {
  it('signs and verifies, recovering the user id', async () => {
    const token = await signAccessToken('user-123')
    expect(await verifyAccessToken(token)).toEqual({ userId: 'user-123' })
  })

  it('rejects tampered tokens', async () => {
    const token = await signAccessToken('user-123')
    const [h, p, s] = token.split('.')
    const forged = `${h}.${Buffer.from(
      JSON.stringify({ sub: 'user-456', exp: 9999999999 }),
    ).toString('base64url')}.${s}`
    void p
    await expect(verifyAccessToken(forged)).rejects.toThrow()
  })

  it('rejects expired tokens', async () => {
    const token = await signAccessToken('user-123', -10)
    await expect(verifyAccessToken(token)).rejects.toThrow()
  })
})

describe('refresh tokens', () => {
  it('generates unique high-entropy tokens', () => {
    const a = generateRefreshToken()
    expect(a).not.toBe(generateRefreshToken())
    expect(a.length).toBeGreaterThanOrEqual(43) // 32 bytes base64url
  })

  it('hashes deterministically', () => {
    const raw = generateRefreshToken()
    expect(hashRefreshToken(raw)).toBe(hashRefreshToken(raw))
    expect(hashRefreshToken(raw)).not.toBe(hashRefreshToken(`${raw}x`))
  })
})
