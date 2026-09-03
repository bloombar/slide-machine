/**
 * Unit tests for `attributionForDeck` (SPEC BILL-7).
 *
 * The pure half of attribution: what a caller holding a deck already knows,
 * shaped into the context the ledger reads. The database-backed half
 * (`entityFromInput`) is covered by cost-attribution.test.ts, which needs real
 * documents to resolve.
 */
import { describe, it, expect } from 'vitest'
import { Types } from 'mongoose'
import { attributionForDeck } from './attribution-resolve'

const deck = {
  _id: new Types.ObjectId(),
  title: 'Standing waves',
  projectId: new Types.ObjectId(),
}

describe('attributionForDeck', () => {
  it('names the payer, the lecture, and the project', () => {
    const attribution = attributionForDeck('payer-1', deck)
    expect(attribution.userId).toBe('payer-1')
    expect(attribution.deckId).toBe(deck._id.toString())
    expect(attribution.deckName).toBe('Standing waves')
    expect(attribution.projectId).toBe(deck.projectId.toString())
  })

  it('carries the language the work was for', () => {
    const attribution = attributionForDeck('payer-1', deck, {
      actorId: 'viewer-1',
      audience: true,
      locale: 'zh',
    })
    expect(attribution.locale).toBe('zh')
    expect(attribution.audience).toBe(true)
    expect(attribution.actorId).toBe('viewer-1')
  })

  it('leaves the language unset when the caller has none', () => {
    // Not 'en'. A row without a language means "this work was not
    // language-specific", and a default would quietly inflate the count of the
    // one language the per-language question is least about.
    expect(attributionForDeck('payer-1', deck).locale).toBeUndefined()
  })

  it('omits the project when the deck does not name one', () => {
    const orphan = { _id: new Types.ObjectId(), title: 'Loose lecture' }
    expect(attributionForDeck('payer-1', orphan)).not.toHaveProperty(
      'projectId',
    )
  })
})
