/**
 * Unit tests for the admin settings change list (ADMIN-5): which fields
 * count as changed, and how each value reads in the confirm dialog.
 */
import { describe, it, expect } from 'vitest'
import { describeChanges, formatValue } from './admin-changes'

interface Draft {
  visibility: 'public' | 'restricted'
  freedom?: number
  enabled?: boolean
  ignored?: string
}

const labels = {
  visibility: {
    label: 'Visibility',
    format: (value: unknown) => (value === 'public' ? 'Public' : 'Private'),
  },
  freedom: 'AI freedom',
  enabled: 'Refine slides',
}

describe('formatValue', () => {
  it('reads an unset value as inherited', () => {
    expect(formatValue(undefined)).toBe('Default (inherited)')
    expect(formatValue(null)).toBe('Default (inherited)')
  })

  it('reads booleans as Yes/No and everything else as itself', () => {
    expect(formatValue(true)).toBe('Yes')
    expect(formatValue(false)).toBe('No')
    expect(formatValue(0)).toBe('0')
    expect(formatValue('')).toBe('')
  })
})

describe('describeChanges', () => {
  const current: Draft = { visibility: 'public', freedom: 3, ignored: 'a' }

  it('finds nothing when the draft matches', () => {
    expect(describeChanges(current, { ...current }, labels)).toEqual([])
  })

  it('describes each changed field with its own formatter', () => {
    const draft: Draft = { ...current, visibility: 'restricted' }
    expect(describeChanges(current, draft, labels)).toEqual([
      {
        field: 'visibility',
        label: 'Visibility',
        from: 'Public',
        to: 'Private',
      },
    ])
  })

  it('treats clearing a value as a change', () => {
    const draft: Draft = { ...current, freedom: undefined }
    expect(describeChanges(current, draft, labels)).toEqual([
      {
        field: 'freedom',
        label: 'AI freedom',
        from: '3',
        to: 'Default (inherited)',
      },
    ])
  })

  it('distinguishes false from unset', () => {
    const draft: Draft = { ...current, enabled: false }
    expect(describeChanges(current, draft, labels)).toEqual([
      {
        field: 'enabled',
        label: 'Refine slides',
        from: 'Default (inherited)',
        to: 'No',
      },
    ])
  })

  it('ignores fields the page does not offer for editing', () => {
    const draft: Draft = { ...current, ignored: 'b' }
    expect(describeChanges(current, draft, labels)).toEqual([])
  })
})
