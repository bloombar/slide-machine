import { describe, expect, it } from 'vitest'
import { themeColors } from './theme'

describe('themeColors', () => {
  it('resolves whiteboard pen/highlighter colors from the theme', () => {
    const colors = themeColors({
      text: '#111111',
      accent: '#3366ff',
      penColor: '#222222',
      highlighterColor: '#ffee00',
    })
    expect(colors.penColor).toBe('#222222')
    expect(colors.highlighterColor).toBe('#ffee00')
  })

  it('falls back pen→text and highlighter→accent when unset', () => {
    const colors = themeColors({ text: '#101010', accent: '#20a020' })
    expect(colors.penColor).toBe('#101010') // text
    expect(colors.highlighterColor).toBe('#20a020') // accent
  })
})
