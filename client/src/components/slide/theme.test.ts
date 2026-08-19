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

describe('the colour a link is drawn in (TMPL-8)', () => {
  it('takes what the template states', () => {
    // An imported design carries the colour its deck drew links in. Without
    // it every link took the box's colour, and a box carries one colour — so
    // a deck whose links were red showed them in the body's black.
    expect(themeColors({ link: '#ff5252' }).link).toBe('#ff5252')
  })

  it('falls back to the accent, which already means “this one is different”', () => {
    expect(themeColors({ accent: '#38bdf8' }).link).toBe('#38bdf8')
  })
})
