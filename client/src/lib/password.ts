/**
 * Generates strong, human-legible random passwords for admin-initiated
 * resets. Uses the Web Crypto API for unbiased randomness and guarantees
 * at least one character from each class so the result always satisfies
 * common strength rules.
 */

// Ambiguous glyphs (O/0, I/l/1) are omitted so an admin can read the
// password aloud or copy it without confusion.
const LOWER = 'abcdefghijkmnpqrstuvwxyz'
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITS = '23456789'
const SYMBOLS = '!@#$%^&*-_=+'
const ALL = LOWER + UPPER + DIGITS + SYMBOLS

/** Returns a uniformly random integer in [0, max) using crypto, avoiding
 * the modulo bias of `getRandomValues() % max`. */
function randomInt(max: number): number {
  // Largest multiple of `max` that fits in a Uint32; values at or above
  // it are rejected so every bucket is equally likely.
  const limit = Math.floor(0x100000000 / max) * max
  const buf = new Uint32Array(1)
  let value: number
  do {
    crypto.getRandomValues(buf)
    value = buf[0] ?? 0
  } while (value >= limit)
  return value % max
}

/** Picks one random character from `chars`. */
function pick(chars: string): string {
  return chars.charAt(randomInt(chars.length))
}

/** Fisher–Yates shuffle so the guaranteed-class characters aren't always
 * at the front. */
function shuffle(chars: string[]): string[] {
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    const tmp = chars[i]!
    chars[i] = chars[j]!
    chars[j] = tmp
  }
  return chars
}

/**
 * Generates a random password of the given length (default 16, minimum
 * 8) containing at least one lowercase letter, uppercase letter, digit,
 * and symbol.
 */
export function generatePassword(length = 16): string {
  const size = Math.max(8, length)
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)]
  while (chars.length < size) {
    chars.push(pick(ALL))
  }
  return shuffle(chars).join('')
}
