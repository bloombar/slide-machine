/**
 * A short, friendly handle for greetings: the display name as-is, unless
 * it looks like an email address — then just the part before the @
 * (falling back to the account email's local part).
 */
import type { SafeUser } from '@slide-machine/shared'

const localPart = (value: string): string => value.split('@')[0] ?? value

/** The same rule for a name on its own, where no account is at hand —
 * a public byline, which never carries an email to fall back to. */
export const displayHandle = (displayName: string): string => {
  const name = displayName.trim()
  return name.includes('@') ? localPart(name) : name
}

export const userHandle = (user: SafeUser): string => {
  const name = user.displayName.trim()
  if (name && !name.includes('@')) return name
  return localPart(name || user.email)
}
