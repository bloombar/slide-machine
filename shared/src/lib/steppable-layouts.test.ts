import { describe, expect, it } from 'vitest'
import { steppableLayouts } from './steppable-layouts'
import { WHITEBOARD_LAYOUT_TYPE } from '../types/template'
import type { Layout } from '../types/template'

const layout = (type: string): Layout =>
  ({ type, label: type, slots: [] }) as unknown as Layout

describe('steppableLayouts', () => {
  it('drops the reserved whiteboard layout', () => {
    const layouts = [
      layout('content'),
      layout(WHITEBOARD_LAYOUT_TYPE),
      layout('two-column'),
    ]
    expect(steppableLayouts(layouts).map(l => l.type)).toEqual([
      'content',
      'two-column',
    ])
  })

  it('treats an undefined layout list as empty', () => {
    expect(steppableLayouts(undefined)).toEqual([])
  })
})
