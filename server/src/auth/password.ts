/**
 * Password hashing (SPEC P-4) using argon2id — OWASP's first-choice KDF.
 * Wrapped behind this seam so the library can be swapped (e.g. bcryptjs)
 * without touching callers.
 */
import argon2 from 'argon2'

export const hashPassword = (password: string): Promise<string> =>
  argon2.hash(password, { type: argon2.argon2id })

export const verifyPassword = async (
  hash: string,
  password: string,
): Promise<boolean> => {
  try {
    return await argon2.verify(hash, password)
  } catch {
    return false
  }
}
