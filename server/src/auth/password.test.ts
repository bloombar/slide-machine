/**
 * Unit tests for password hashing: roundtrip, rejection, and salting.
 */
import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from './password'

describe('password hashing', () => {
  it('verifies the original password against its hash', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(
      true,
    )
  })

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('right-password')
    expect(await verifyPassword(hash, 'wrong-password')).toBe(false)
  })

  it('rejects garbage hashes without throwing', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false)
  })

  it('salts hashes (same password, different hashes)', async () => {
    const [a, b] = await Promise.all([
      hashPassword('same'),
      hashPassword('same'),
    ])
    expect(a).not.toBe(b)
  })
})
