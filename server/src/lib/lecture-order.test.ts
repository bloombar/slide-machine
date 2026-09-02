/**
 * Unit tests for applying a project's stored lecture order (PROJ-4).
 * Pure function, no DB — deck.list's own use of it is covered against a
 * real project/deck set in test/integration/project-reorder-lectures.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { orderByLectureOrder } from './lecture-order'

const idOf = (d: { id: string }) => d.id

describe('orderByLectureOrder', () => {
  it('is a no-op when there is no stored order (never arranged)', () => {
    const docs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(orderByLectureOrder(docs, idOf, undefined)).toEqual(docs)
  })

  it('is a no-op for an empty order too', () => {
    const docs = [{ id: 'a' }, { id: 'b' }]
    expect(orderByLectureOrder(docs, idOf, [])).toEqual(docs)
  })

  it('applies the stored order when every doc is in it', () => {
    const docs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const ordered = orderByLectureOrder(docs, idOf, ['c', 'a', 'b'])
    expect(ordered.map(idOf)).toEqual(['c', 'a', 'b'])
  })

  it('puts a doc missing from the order first, ahead of every ranked one', () => {
    // 'd' was created after the order was set — appears first, where a
    // newly recorded lecture has always appeared (SPEC PROJ-4).
    const docs = [{ id: 'd' }, { id: 'a' }, { id: 'b' }, { id: 'c' }]
    const ordered = orderByLectureOrder(docs, idOf, ['c', 'a', 'b'])
    expect(ordered.map(idOf)).toEqual(['d', 'c', 'a', 'b'])
  })

  it('keeps several unranked docs in their incoming (newest-first) order', () => {
    const docs = [{ id: 'new2' }, { id: 'new1' }, { id: 'a' }]
    const ordered = orderByLectureOrder(docs, idOf, ['a'])
    expect(ordered.map(idOf)).toEqual(['new2', 'new1', 'a'])
  })

  it('skips an id in the order for a doc no longer present, without crashing', () => {
    // 'x' was soft-deleted; its id is still in the stored order (P-10 —
    // never edited on delete) but is not among the live docs passed in.
    const docs = [{ id: 'a' }, { id: 'b' }]
    const ordered = orderByLectureOrder(docs, idOf, ['x', 'b', 'a'])
    expect(ordered.map(idOf)).toEqual(['b', 'a'])
  })
})
