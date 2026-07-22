/**
 * Symmetric encryption for connected-account secrets at rest (SPEC P-9).
 * A stored Google refresh token is encrypted with AES-256-GCM using
 * CONNECTED_ACCOUNT_TOKEN_ENC_KEY (a base64 32-byte key), so a database dump
 * never exposes usable tokens. Output packs iv, auth tag, and ciphertext as
 * dot-separated base64.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { env } from '../config/env'

const ALGO = 'aes-256-gcm'

/** The 32-byte key, or a clear error if it is missing/misconfigured. */
const key = (): Buffer => {
  const raw = env.CONNECTED_ACCOUNT_TOKEN_ENC_KEY
  if (!raw) {
    throw new Error('CONNECTED_ACCOUNT_TOKEN_ENC_KEY is not set')
  }
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) {
    throw new Error(
      'CONNECTED_ACCOUNT_TOKEN_ENC_KEY must decode to 32 bytes (base64)',
    )
  }
  return buf
}

/** Encrypts a secret to "iv.tag.ciphertext" (all base64). */
export const encryptToken = (plaintext: string): string => {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, key(), iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  return [
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join('.')
}

/** Reverses encryptToken; throws on a malformed or tampered value. */
export const decryptToken = (packed: string): string => {
  const [ivB64, tagB64, ctB64] = packed.split('.')
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error('malformed encrypted token')
  }
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}
