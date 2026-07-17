/**
 * Unit tests for slide attribution normalization: new rows hold a
 * structured credit object; legacy rows (pre-IMG-5) hold a plain string,
 * and must degrade to no-credit rather than crash a read.
 */
import { describe, it, expect } from 'vitest'
import { toAttributionDto } from './slide'

describe('toAttributionDto', () => {
  it('passes a structured credit through', () => {
    const credit = {
      title: 'Photosynthesis',
      creator: 'Jane Doe',
      sourceName: 'Wikimedia Commons',
      license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    }
    expect(toAttributionDto(credit)).toMatchObject(credit)
  })

  it('drops a legacy string credit (the crash case)', () => {
    expect(toAttributionDto('Jane Doe (Wikimedia Commons)')).toBeUndefined()
  })

  it('treats null/undefined as no credit', () => {
    expect(toAttributionDto(null)).toBeUndefined()
    expect(toAttributionDto(undefined)).toBeUndefined()
  })
})
