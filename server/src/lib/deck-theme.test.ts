/**
 * Unit tests for the export theme resolver: named colors are read from the
 * template theme, and missing keys fall back to the neutral default.
 */
import { describe, it, expect } from 'vitest'
import { resolveTemplateTheme, DEFAULT_THEME } from './deck-theme'

describe('resolveTemplateTheme', () => {
  it('reads background/text/accent/muted from a template theme', () => {
    expect(
      resolveTemplateTheme({
        background: '#fefce8',
        text: '#1c1917',
        accent: '#b45309',
        muted: '#78716c',
        surface: '#ffffff', // ignored — not an export color
      }),
    ).toEqual({
      background: '#fefce8',
      text: '#1c1917',
      accent: '#b45309',
      muted: '#78716c',
    })
  })

  it('falls back to the default for missing or non-string keys', () => {
    expect(resolveTemplateTheme({ accent: '#123456', text: 42 })).toEqual({
      background: DEFAULT_THEME.background,
      text: DEFAULT_THEME.text,
      accent: '#123456',
      muted: DEFAULT_THEME.muted,
    })
  })

  it('returns the default theme when there is no theme', () => {
    expect(resolveTemplateTheme(undefined)).toEqual(DEFAULT_THEME)
  })
})
