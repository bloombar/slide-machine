/**
 * Unit tests for the document lang/dir sync.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { applyDocumentLocale } from './document'

afterEach(() => {
  document.documentElement.lang = 'en'
  document.documentElement.dir = ''
})

describe('applyDocumentLocale', () => {
  it('sets lang and dir from the locale', () => {
    applyDocumentLocale('ru')
    expect(document.documentElement.lang).toBe('ru')
    expect(document.documentElement.dir).toBe('ltr')
  })

  it('re-applies on a switch rather than accumulating', () => {
    applyDocumentLocale('fr')
    applyDocumentLocale('zh')
    expect(document.documentElement.lang).toBe('zh')
    expect(document.documentElement.dir).toBe('ltr')
  })
})
