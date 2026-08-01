/**
 * Unit tests for the template-name lookup: the built-in starter set is
 * translated, an author's own name is left as written, and a built-in
 * still resolves after a language switch.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { i18n } from './index'
import { templateName } from './templateName'

const t = i18n.t.bind(i18n)

afterEach(async () => {
  if (i18n.language !== 'en') await i18n.changeLanguage('en')
})

describe('templateName', () => {
  it('translates the built-in templates', () => {
    expect(templateName(t, { id: 'classic', name: 'Classic' })).toBe('Classic')
    expect(templateName(t, { id: 'midnight', name: 'Midnight' })).toBe(
      'Midnight',
    )
    expect(templateName(t, { id: 'seminar', name: 'Seminar' })).toBe('Seminar')
  })

  it('follows the interface language', async () => {
    await i18n.changeLanguage('fr')
    expect(templateName(t, { id: 'midnight', name: 'Midnight' })).toBe('Minuit')
    await i18n.changeLanguage('es')
    expect(templateName(t, { id: 'seminar', name: 'Seminar' })).toBe(
      'Seminario',
    )
  })

  it("keeps an author's own template name as written", async () => {
    const authored = { id: '66b0f3c2a1', name: 'Chem 204 house style' }
    expect(templateName(t, authored)).toBe('Chem 204 house style')
    // Still theirs in a locale that translates the built-ins
    await i18n.changeLanguage('fr')
    expect(templateName(t, authored)).toBe('Chem 204 house style')
  })
})
