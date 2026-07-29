/**
 * Unit tests for the admin settings diff (ADMIN-5): what counts as a
 * change, and how the recorded values survive the audit log's JSON.
 */
import { describe, it, expect } from 'vitest'
import { diffSettings } from './settings-diff'

describe('diffSettings', () => {
  it('finds nothing between identical snapshots', () => {
    const snapshot = { visibility: 'public', freedom: 3, language: undefined }
    expect(diffSettings(snapshot, { ...snapshot })).toEqual({})
  })

  it('records only the fields that changed', () => {
    expect(
      diffSettings(
        { visibility: 'public', freedom: 3 },
        { visibility: 'restricted', freedom: 3 },
      ),
    ).toEqual({ visibility: { from: 'public', to: 'restricted' } })
  })

  it('records setting and clearing with null on the absent side', () => {
    expect(diffSettings<{ language?: string }>({}, { language: 'fr' })).toEqual(
      { language: { from: null, to: 'fr' } },
    )
    expect(diffSettings<{ language?: string }>({ language: 'fr' }, {})).toEqual(
      { language: { from: 'fr', to: null } },
    )
  })

  it('survives JSON, which would otherwise drop an undefined side', () => {
    const changes = diffSettings<{ language?: string }>({ language: 'fr' }, {})
    expect(JSON.parse(JSON.stringify(changes))).toEqual({
      language: { from: 'fr', to: null },
    })
  })

  it('distinguishes false, 0, and the empty string from unset', () => {
    expect(diffSettings<{ enabled?: boolean }>({}, { enabled: false })).toEqual(
      { enabled: { from: null, to: false } },
    )
    expect(diffSettings<{ count?: number }>({}, { count: 0 })).toEqual({
      count: { from: null, to: 0 },
    })
    expect(diffSettings<{ bio?: string }>({}, { bio: '' })).toEqual({
      bio: { from: null, to: '' },
    })
  })

  it('truncates a long string so it cannot inflate the log', () => {
    const long = 'x'.repeat(500)
    const { bio } = diffSettings({ bio: '' }, { bio: long })
    expect(bio!.to).toBe(`${'x'.repeat(200)}…`)
    expect(String(bio!.to)).toHaveLength(201)
  })
})
