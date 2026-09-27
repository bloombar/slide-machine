/**
 * Unit tests for the vote-tally patch (TMPL-27 round 3).
 */
import { describe, it, expect } from 'vitest'
import type { Template, VoteResult } from '@slide-machine/shared'
import { patchTemplateVote } from './templateVotes'

const template = (over: Partial<Template> = {}): Template =>
  ({
    id: 't1',
    permalinkSlug: 't1',
    ownerId: 'system',
    name: 'Shipped',
    theme: {},
    layouts: [],
    visibility: 'public',
    myRole: null,
    voteScore: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }) as Template

const result = (over: Partial<VoteResult> = {}): VoteResult => ({
  up: 1,
  down: 0,
  voteScore: 1,
  myVote: 1,
  ...over,
})

describe('patchTemplateVote', () => {
  it('replaces the matching template’s votes with the settled result', () => {
    const list = [template({ id: 't1' }), template({ id: 't2' })]
    const patched = patchTemplateVote(list, 't1', result({ up: 3, down: 1 }))
    expect(patched[0]?.votes).toEqual({ up: 3, down: 1, myVote: 1 })
  })

  it('leaves every other template untouched, by reference', () => {
    const other = template({ id: 't2' })
    const patched = patchTemplateVote(
      [template({ id: 't1' }), other],
      't1',
      result(),
    )
    expect(patched[1]).toBe(other)
  })

  it('leaves the list itself alone when no template matches the id', () => {
    const list = [template({ id: 't1' })]
    const patched = patchTemplateVote(list, 'unknown', result())
    expect(patched[0]?.votes).toBeUndefined()
  })
})
