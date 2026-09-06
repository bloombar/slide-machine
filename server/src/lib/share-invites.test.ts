/**
 * Unit tests for the invitation list (SHARE-3): the pure list operations.
 * Claiming touches the database and is covered by the integration suite.
 */
import { describe, it, expect } from 'vitest'
import { normalizeEmail, removeInvite, upsertInvite } from './share-invites'

describe('normalizeEmail', () => {
  it('stores addresses the way accounts store them', () => {
    expect(normalizeEmail('  Byron@Example.COM ')).toBe('byron@example.com')
  })
})

describe('upsertInvite', () => {
  it('records an invitation with its role', () => {
    const invites = upsertInvite(undefined, 'byron@example.com', 'viewer')
    expect(invites).toHaveLength(1)
    expect(invites[0]!.email).toBe('byron@example.com')
    expect(invites[0]!.role).toBe('viewer')
  })

  // One role per person, exactly as a granted share has one role: inviting
  // the same address again replaces the invitation rather than stacking.
  it('replaces an invitation for the same address', () => {
    const first = upsertInvite([], 'byron@example.com', 'viewer')
    const second = upsertInvite(first, 'BYRON@example.com', 'editor')
    expect(second).toHaveLength(1)
    expect(second[0]!.role).toBe('editor')
  })

  it("leaves other people's invitations alone", () => {
    const invites = upsertInvite(
      upsertInvite([], 'byron@example.com', 'viewer'),
      'mary@example.com',
      'editor',
    )
    expect(invites.map(i => i.email)).toEqual([
      'byron@example.com',
      'mary@example.com',
    ])
  })
})

describe('removeInvite', () => {
  it('withdraws the invitation for one address, whatever its case', () => {
    const invites = upsertInvite([], 'byron@example.com', 'viewer')
    expect(removeInvite(invites, ' Byron@Example.com ')).toEqual([])
  })

  it('is a no-op for an address that was never invited', () => {
    const invites = upsertInvite([], 'byron@example.com', 'viewer')
    expect(removeInvite(invites, 'mary@example.com')).toHaveLength(1)
  })
})
