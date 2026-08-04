/**
 * Unit tests for the greeting handle.
 */
import { describe, it, expect } from 'vitest'
import type { SafeUser } from '@slide-machine/shared'
import { displayHandle, userHandle } from './handle'

const user = (displayName: string, email = 'ada@example.com'): SafeUser =>
  ({ displayName, email }) as SafeUser

describe('userHandle', () => {
  it('uses the display name when it is a normal name', () => {
    expect(userHandle(user('Ada Lovelace'))).toBe('Ada Lovelace')
  })

  it('strips the domain when the display name is an email address', () => {
    expect(userHandle(user('foo.barstein@onepotcooking.com'))).toBe(
      'foo.barstein',
    )
  })

  it('falls back to the email local part when the display name is blank', () => {
    expect(userHandle(user('  '))).toBe('ada')
  })
})

describe('displayHandle', () => {
  it('applies the same rule to a bare name, with no account behind it', () => {
    expect(displayHandle('Ada Lovelace')).toBe('Ada Lovelace')
    expect(displayHandle('  Ada  ')).toBe('Ada')
    expect(displayHandle('ada@example.com')).toBe('ada')
  })
})
