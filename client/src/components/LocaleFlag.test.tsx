/**
 * Unit tests for the locale flag glyphs (SHARE-2): every supported locale has
 * artwork, each glyph says which locale it is for, and none of them announce
 * themselves — the control around a flag carries the name.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { LOCALES } from '@slide-machine/shared'
import LocaleFlag from './LocaleFlag'

const flagOf = (container: HTMLElement) =>
  container.querySelector('svg[data-locale]')

describe('LocaleFlag', () => {
  it.each(LOCALES)('draws a flag for %s', locale => {
    const { container } = render(<LocaleFlag locale={locale} />)
    const svg = flagOf(container)
    expect(svg?.getAttribute('data-locale')).toBe(locale)
    // Artwork, not an empty box
    expect(svg?.querySelectorAll('rect, path, polygon').length).toBeGreaterThan(
      0,
    )
  })

  it('is decorative, so assistive tech reads the control instead', () => {
    const { container } = render(<LocaleFlag locale="fr" />)
    expect(flagOf(container)?.getAttribute('aria-hidden')).toBe('true')
  })

  it('takes its size from the caller but keeps the 3:2 artwork', () => {
    const { container } = render(<LocaleFlag locale="zh" className="h-6 w-9" />)
    const svg = flagOf(container)
    expect(svg?.getAttribute('viewBox')).toBe('0 0 60 40')
    expect(svg?.getAttribute('class')).toContain('h-6 w-9')
  })

  it('gives the Chinese flag its five stars', () => {
    const { container } = render(<LocaleFlag locale="zh" />)
    expect(flagOf(container)?.querySelectorAll('polygon')).toHaveLength(5)
  })
})
