/**
 * Contract test binding the two halves of a layout together: the slots
 * a template file declares (server/config/templates/*.json — what the
 * AI fills) must be exactly the slots the registered renderer actually
 * renders (what the user sees). Drift in either direction means
 * invisible content or never-filled slots, so it fails here first.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { createElement } from 'react'
import type { LayoutSlot, Slide } from '@slide-machine/shared'
import { getLayoutRenderer } from './index'
import type { ThemeColors } from '../theme'

// Vitest runs with cwd = client/
const templatesDir = path.resolve(process.cwd(), '../server/config/templates')

const colors: ThemeColors = {
  background: '#000',
  surface: '#111',
  text: '#fff',
  muted: '#888',
  accent: '#0ff',
}

/** Fully populated so conditional slots (captions etc.) all render. */
const fullSlide: Slide = {
  id: 's1',
  deckId: 'd1',
  index: 0,
  layoutType: 'content',
  title: 'Title',
  body: 'Body',
  bullets: ['one', 'two'],
  caption: 'Caption',
  imageRef: 'http://img/x.jpg',
}

interface TemplateFile {
  id: string
  layouts: Array<{ type: string; slots: Array<string | { name: string }> }>
}

const slotName = (s: string | { name: string }): string =>
  typeof s === 'string' ? s : s.name

const templateFiles: TemplateFile[] = readdirSync(templatesDir)
  .filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(readFileSync(path.join(templatesDir, f), 'utf8')))

describe('layout renderers match the template files', () => {
  it('found the template files', () => {
    expect(templateFiles.length).toBeGreaterThan(0)
  })

  for (const template of templateFiles) {
    for (const layout of template.layouts) {
      it(`${template.id}/${layout.type}: renderer uses exactly the declared slots`, () => {
        const requested = new Set<string>()
        const spy = (name: LayoutSlot) => {
          requested.add(name)
          return null
        }
        render(
          createElement(getLayoutRenderer(layout.type), {
            slide: { ...fullSlide, layoutType: layout.type as never },
            colors,
            slot: spy,
          }),
        )
        expect([...requested].sort()).toEqual(layout.slots.map(slotName).sort())
      })
    }
  }
})
