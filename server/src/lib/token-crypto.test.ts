/**
 * Unit tests for connected-account token encryption (P-9): round-trip,
 * per-call randomness, tamper/format rejection, and key misconfiguration.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { testEnv, validKey } = vi.hoisted(() => {
  const validKey = Buffer.alloc(32, 7).toString('base64')
  return {
    validKey,
    testEnv: {
      CONNECTED_ACCOUNT_TOKEN_ENC_KEY: validKey as string | undefined,
    },
  }
})
vi.mock('../config/env', () => ({ env: testEnv }))

import { encryptToken, decryptToken } from './token-crypto'

beforeEach(() => {
  testEnv.CONNECTED_ACCOUNT_TOKEN_ENC_KEY = validKey
})

describe('token-crypto', () => {
  it('round-trips a secret', () => {
    const packed = encryptToken('refresh-token-value')
    expect(packed).not.toContain('refresh-token-value')
    expect(decryptToken(packed)).toBe('refresh-token-value')
  })

  it('produces different ciphertext each time (random iv)', () => {
    expect(encryptToken('x')).not.toBe(encryptToken('x'))
  })

  it('rejects a tampered ciphertext', () => {
    const [iv, tag, ct] = encryptToken('secret').split('.')
    const flipped = ct!.slice(0, -2) + (ct!.endsWith('A') ? 'B' : 'A') + '='
    expect(() => decryptToken(`${iv}.${tag}.${flipped}`)).toThrow()
  })

  it('rejects a malformed value', () => {
    expect(() => decryptToken('not-packed')).toThrow(/malformed/)
  })

  it('throws when the key is missing', () => {
    testEnv.CONNECTED_ACCOUNT_TOKEN_ENC_KEY = undefined
    expect(() => encryptToken('x')).toThrow(/not set/)
  })

  it('throws when the key is not 32 bytes', () => {
    testEnv.CONNECTED_ACCOUNT_TOKEN_ENC_KEY =
      Buffer.alloc(16).toString('base64')
    expect(() => encryptToken('x')).toThrow(/32 bytes/)
  })
})
