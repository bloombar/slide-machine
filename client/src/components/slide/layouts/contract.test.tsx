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
import type {
  Layout,
  LayoutNode,
  Slide,
  SlotValue,
} from '@slide-machine/shared'
import {
  WHITEBOARD_LAYOUT_TYPE,
  defaultLayoutTree,
  treeFromPositions,
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
  imageBackground: 'transparent',
  penColor: '#000',
  highlighterColor: '#ff0',
  link: '#0ff',
}

interface TemplateFile {
  id: string
  layouts: Array<{
    type: string
    slots: Array<string | { name: string; kind?: string }>
    tree?: LayoutNode
    /** A design imported from Slides states its geometry as rectangles and
     * carries no tree; the loader builds one from these. */
    elementPositions?: Record<
      string,
      { x: number; y: number; w: number; h: number }
    >
  }>
}

const slotName = (s: string | { name: string }): string =>
  typeof s === 'string' ? s : s.name

/** The kind a declared slot holds. A bare string is a conventional slot, and
 * only the conventional names appear in that form. */
const slotKind = (s: string | { name: string; kind?: string }): string => {
  if (typeof s !== 'string') return s.kind ?? 'text'
  if (s === 'bullets') return 'bullets'
  if (s === 'image') return 'image'
  return 'text'
}

const templateFiles: TemplateFile[] = readdirSync(templatesDir)
  .filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(readFileSync(path.join(templatesDir, f), 'utf8')))

/** Something of the right shape for a box of this kind, so it is never
 * skipped for being empty. */
const sampleFor = (kind: string): SlotValue => {
  switch (kind) {
    case 'bullets':
      return { kind: 'bullets', items: ['one', 'two'] }
    case 'image':
      return { kind: 'image', ref: 'http://img/x.jpg' }
    case 'code':
      return { kind: 'code', source: 'while n > 10:\n    n -= 1' }
    case 'math':
      return { kind: 'math', tex: 'E = mc^2' }
    case 'table':
      return { kind: 'table', rows: [['a', 'b']] }
    case 'preformatted':
      return { kind: 'preformatted', value: 'literal' }
    default:
      return { kind: 'text', value: 'Text' }
  }
}

/**
 * A slide holding something for every box any shipped layout declares.
 *
 * Derived rather than listed, so adding a layout with a new box cannot make
 * this test pass by silently skipping it — which is exactly how an empty box
 * would look to the renderer.
 */
const fullSlide: Slide = {
  id: 's1',
  deckId: 'd1',
  index: 0,
  layoutType: 'content',
  slots: Object.fromEntries(
    templateFiles.flatMap(t =>
      t.layouts.flatMap(l =>
        l.slots.map(s => [slotName(s), sampleFor(slotKind(s))] as const),
      ),
    ),
  ),
}

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
      /*
       * What the loader actually ships for this layout, in the loader's own
       * order (`adoptDefaultTree`, server): the tree the file authored, then
       * a tree built from the rectangles the file measured, and only failing
       * both the default for its type.
       *
       * The middle branch is the one that matters and it used to be missing.
       * A design imported from Slides arrives as measured boxes and no tree,
       * and the server turns those boxes into a tree of `free` nodes at
       * exactly the rectangles they were measured at — so its slots are all
       * present. Skipping to the type default instead compared such a
       * template against a generic tree it never uses, which reported every
       * box the design added beyond the conventional set as missing. On the
       * first built-in to arrive that way that was twenty-two failures, none
       * of them real: the slots render, they simply do not appear in a tree
       * the app never builds for this layout.
       */
      const measured = file.elementPositions ?? {}
      const tree =
        file.tree ??
        (Object.keys(measured).length
          ? treeFromPositions(
              measured as Parameters<typeof treeFromPositions>[0],
              // Normalized to the shape the builder takes: a conventional
              // slot may be written as a bare name in a template file.
              file.slots.map(slot =>
                typeof slot === 'string' ? { name: slot } : slot,
              ),
            )
          : undefined) ??
        defaultLayoutTree(file.type)

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
