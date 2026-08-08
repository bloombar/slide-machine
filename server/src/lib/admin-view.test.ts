/**
 * Unit tests for the read shaping behind the admin's soft-delete bypass
 * (ADMIN-6): which of a tombstoned record's children an admin sees, and
 * that a live record's reads are left exactly as they were.
 */
import { describe, it, expect } from 'vitest'
import { asOf, deletedWith, withDeleted } from './admin-view'

const AT = new Date('2026-07-20T09:00:00Z')

describe('deletedWith', () => {
  it('matches live children and those tombstoned in the same cascade', () => {
    expect(deletedWith(AT)).toEqual({
      $or: [{ deletedAt: null }, { deletedAt: { $gte: AT } }],
    })
  })

  it('excludes a child deleted before its parent, as a restore would', () => {
    // The two branches are the whole filter, so a child tombstoned before
    // the cascade matches neither and is not shown.
    const earlier = new Date(AT.getTime() - 1000)
    const matches = (deletedAt: Date | null) =>
      deletedWith(AT).$or.some(branch =>
        branch.deletedAt === null
          ? deletedAt === null
          : deletedAt !== null && deletedAt >= branch.deletedAt.$gte,
      )
    expect(matches(null)).toBe(true)
    expect(matches(AT)).toBe(true)
    expect(matches(earlier)).toBe(false)
  })
})

describe('asOf', () => {
  it('leaves a live record’s reads untouched, so its own deletions stay hidden', () => {
    for (const at of [null, undefined]) {
      expect(asOf(at)).toEqual({ filter: {}, options: {} })
    }
  })

  it('opens a tombstoned record’s reads to its own cascade', () => {
    expect(asOf(AT)).toEqual({
      filter: deletedWith(AT),
      options: withDeleted,
    })
  })
})
