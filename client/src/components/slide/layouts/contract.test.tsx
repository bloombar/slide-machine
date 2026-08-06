/**
 * Contract test binding the two halves of a layout together: the slots a
 * template declares (what the AI fills) must be exactly the slots its tree
 * shows (what the user sees). Drift in either direction means invisible
 * content or never-filled slots, so it fails here first.
 *
 * It used to compare a template file against a hand-written renderer
 * component. Layouts are data now, so the comparison is between a template's
 * declared slots and the tree that draws them — a tighter check, since it
 * covers layouts an author built as well as the ones we ship.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { createElement } from 'react'
import type { Layout, LayoutNode, Slide } from '@slide-machine/shared'
import {
  WHITEBOARD_LAYOUT_TYPE,
  defaultLayoutTree,
} from '@slide-machine/shared'
import { rendererFor } from './index'
import { DEFAULT_TEXT_STYLES, type ThemeColors } from '../theme'

// Vitest runs with cwd = client/
const templatesDir = path.resolve(process.cwd(), '../server/config/templates')

const metrics = { marginX: 0.06, marginY: 0.06, gap: 0.03, padding: 0.02 }

const colors: ThemeColors = {
  background: '#000',
  surface: '#111',
  text: '#fff',
  muted: '#888',
  accent: '#0ff',
  penColor: '#000',
  highlighterColor: '#ff0',
}

/** Fully populated, so a slot is never skipped for being empty. */
const fullSlide: Slide = {
  id: 's1',
  deckId: 'd1',
  index: 0,
  layoutType: 'content',
  slots: {
    title: { kind: 'text', value: 'Title' },
    body: { kind: 'text', value: 'Body' },
    bullets: { kind: 'bullets', items: ['one', 'two'] },
    caption: { kind: 'text', value: 'Caption' },
    image: { kind: 'image', ref: 'http://img/x.jpg' },
    columns: { kind: 'text', value: 'Columns' },
  },
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

/** Every slot named anywhere in a tree. */
const treeSlots = (node: LayoutNode, into = new Set<string>()): Set<string> => {
  if (node.slot) into.add(node.slot)
  for (const child of node.children ?? []) treeSlots(child, into)
  return into
}

describe('layout trees match the template files', () => {
  it('found the template files', () => {
    expect(templateFiles.length).toBeGreaterThan(0)
  })

  for (const template of templateFiles) {
    for (const file of template.layouts) {
      const declared = file.slots.map(slotName).sort()
      // The loader gives a conventional layout its default tree, so that is
      // what a template file naming one actually ships.
      const tree = defaultLayoutTree(file.type)

      it(`${template.id}/${file.type}: has a tree`, () => {
        // The whiteboard is the one layout with nothing to draw (WB-1).
        if (file.type === WHITEBOARD_LAYOUT_TYPE) return
        expect(tree, `no default tree for "${file.type}"`).toBeDefined()
      })

      it(`${template.id}/${file.type}: tree shows exactly the declared slots`, () => {
        if (!tree) return
        expect([...treeSlots(tree)].sort()).toEqual(declared)
      })

      it(`${template.id}/${file.type}: renders exactly the declared slots`, () => {
        if (file.type === WHITEBOARD_LAYOUT_TYPE) return
        const requested = new Set<string>()
        const layout = {
          ...file,
          tree,
          elementPositions: {},
        } as unknown as Layout
        render(
          createElement(rendererFor(file.type, layout), {
            slide: { ...fullSlide, layoutType: file.type },
            colors,
            textStyles: DEFAULT_TEXT_STYLES,
            metrics,
            layout,
            slot: (name: string) => {
              requested.add(name)
              return null
            },
          }),
        )
        expect([...requested].sort()).toEqual(declared)
      })
    }
  }
})
