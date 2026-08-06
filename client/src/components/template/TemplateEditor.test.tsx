/**
 * Unit tests for the template editor (TMPL-4).
 *
 * The editor is a slide you edit by looking at it: pick a layout from the
 * rail, click a box on the slide to change what it holds and how it is set,
 * and change what the whole template shares underneath. These cover what is
 * provable without layout — jsdom lays nothing out, so where a box *ends up*
 * is asserted in a browser instead (e2e/tests/template-library.spec.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { Layout, LayoutNode, Template } from '@slide-machine/shared'
import TemplateEditor from './TemplateEditor'
import { resetPreviewImages } from './usePreviewImages'
import { dispatchAction } from '../../api/actions'

vi.mock('../../api/actions')

const tree = (children: LayoutNode[]): LayoutNode => ({
  id: 'root',
  container: { mode: 'flex', direction: 'column', gap: 3 },
  children,
})

const layout = (type: string, label: string, slots: string[]): Layout =>
  ({
    type,
    label,
    purpose: `use for ${type}`,
    slots: slots.map(name => ({ name, kind: 'text', label: name })),
    tree: tree(slots.map(name => ({ id: name, slot: name }))),
    elementPositions: {},
  }) as Layout

const template = (over: Partial<Template> = {}): Template => ({
  id: 'mine-1',
  permalinkSlug: 'mine-1',
  ownerId: 'u1',
  name: 'My Style',
  theme: { background: '#ffffff', text: '#000000', accent: '#ff0000' },
  layouts: [
    layout('content', 'Content', ['title', 'body']),
    layout('whiteboard', 'Whiteboard', []),
  ],
  visibility: 'private',
  voteScore: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

const renderEditor = (onSave = vi.fn(), over: Partial<Template> = {}) => {
  render(
    <TemplateEditor
      template={template(over)}
      layoutSources={[template()]}
      onSave={onSave}
      onCancel={vi.fn()}
    />,
  )
  return onSave
}

/** The draft the editor handed to `onSave`. */
const saved = (onSave: ReturnType<typeof vi.fn>) => {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  return onSave.mock.calls[0]![0] as {
    name: string
    theme: Record<string, unknown>
    layouts: Layout[]
    visibility: Template['visibility']
  }
}

/** Selects a box by clicking its row in the outline, which is the route that
 * does not depend on anything having a size. The whole row is the target —
 * the name is plain text, so that a drag can start anywhere along it. */
const selectBox = (name: string) => {
  const row = screen.getByRole('listitem', { name: new RegExp(`^${name}`) })
  fireEvent.click(within(row).getByText(name))
}

/** The delete icon on a layout's row in the rail. Scoped to the tab list:
 * narrow screens get the same layouts as a select, with a delete of their own,
 * and jsdom renders both. */
const railDelete = (name: string) =>
  within(screen.getByRole('tablist')).getByRole('button', {
    name: `Remove the ${name} layout`,
  })

/** The delete icon on a box's row in the outline. */
const boxDelete = (name: string) =>
  screen.getByRole('button', { name: `Remove the ${name} box` })

/** Says yes to whatever is being confirmed. */
const confirm = () =>
  fireEvent.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Delete',
    }),
  )

beforeEach(() => {
  resetPreviewImages()
  vi.mocked(dispatchAction).mockResolvedValue({ urls: [] } as never)
})

describe('the layout rail', () => {
  it('lists every layout as a tab, so one is worked on at a time', () => {
    renderEditor()
    expect(screen.getByRole('tab', { name: /Content/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('switches which layout the slide shows', () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Add layout' }))
    expect(screen.getByRole('tab', { name: /Layout 2/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('makes a layout of the author’s own when none of the conventional ones fits (TMPL-9)', () => {
    const onSave = renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Add layout' }))
    const draft = saved(onSave)
    // Named for its place in the list, so there is something to look at
    // before there is anything to type.
    const added = draft.layouts.at(-1)!
    expect(added.label).toBe('Layout 2')
    // It has to hold something, and be drawable, from the moment it exists.
    expect(added.slots).toHaveLength(1)
    expect(added.tree).toBeDefined()
  })

  it('leaves the whiteboard out: it holds nothing and cannot be changed', () => {
    renderEditor()
    // Every template has one (TMPL-7); listing it would offer a choice that
    // leads to a blank slate with nothing to do.
    expect(screen.getAllByRole('tab')).toHaveLength(1)
    expect(screen.queryByRole('tab', { name: /Whiteboard/ })).toBeNull()
  })

  it('removes a layout from its own row, once the author confirms', () => {
    const onSave = renderEditor()
    fireEvent.click(railDelete('Content'))
    confirm()
    expect(saved(onSave).layouts.map(l => l.type)).toEqual(['whiteboard'])
  })

  it('keeps the layout when the question is answered no', () => {
    // A layout is a whole design; deleting one on a stray click would be
    // expensive to put back.
    const onSave = renderEditor()
    fireEvent.click(railDelete('Content'))
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Cancel',
      }),
    )
    expect(saved(onSave).layouts.map(l => l.type)).toEqual([
      'content',
      'whiteboard',
    ])
  })

  it('deletes the layout whose row was clicked, not the one on screen', () => {
    const onSave = renderEditor(vi.fn(), {
      layouts: [
        layout('content', 'Content', ['title', 'body']),
        layout('list', 'List', ['title', 'bullets']),
        layout('whiteboard', 'Whiteboard', []),
      ],
    })
    // Looking at the second one, deleting the first.
    fireEvent.click(screen.getByRole('tab', { name: /List/ }))
    fireEvent.click(railDelete('Content'))
    confirm()
    expect(saved(onSave).layouts.map(l => l.type)).toEqual([
      'list',
      'whiteboard',
    ])
    // ...and it is still the one being looked at, though it has moved up.
    expect(screen.getByRole('tab', { name: /List/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('never lands on the whiteboard after deleting the layout before it', () => {
    // The whiteboard sits last on every template and is not listed, so an
    // index that walked onto it would show a blank slate with nothing to
    // edit and no tab selected.
    const onSave = renderEditor(vi.fn(), {
      layouts: [
        layout('content', 'Content', ['title', 'body']),
        layout('list', 'List', ['title', 'bullets']),
        layout('whiteboard', 'Whiteboard', []),
      ],
    })
    // Delete the last listed layout, whose neighbour is the whiteboard.
    fireEvent.click(screen.getByRole('tab', { name: /List/ }))
    fireEvent.click(railDelete('List'))
    confirm()
    expect(screen.getByRole('tab', { name: /Content/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    // ...and the whiteboard is still on the template (TMPL-7).
    expect(saved(onSave).layouts.map(l => l.type)).toEqual([
      'content',
      'whiteboard',
    ])
  })
})

describe('the layout inspector', () => {
  it('edits the purpose the AI reads when choosing a layout (TMPL-6)', () => {
    const onSave = renderEditor()
    fireEvent.change(screen.getByDisplayValue('use for content'), {
      target: { value: 'when a slide is mostly prose' },
    })
    expect(saved(onSave).layouts[0]!.purpose).toBe(
      'when a slide is mostly prose',
    )
  })

  it('leaves deleting to the rail, where every layout can be reached', () => {
    renderEditor()
    expect(screen.queryByRole('button', { name: /^Remove this/ })).toBeNull()
  })

  it('keeps the whiteboard on the template even though it is not listed', () => {
    // It is required of every template (TMPL-7), so saving must not drop it.
    const onSave = renderEditor()
    expect(saved(onSave).layouts.map(l => l.type)).toContain('whiteboard')
  })
})

describe('the box inspector', () => {
  it('opens on the box you clicked, in place of the layout’s settings', () => {
    renderEditor()
    selectBox('title')
    expect(screen.getByText('Box')).toBeInTheDocument()
    expect(screen.queryByLabelText('What is it')).toBeInTheDocument()
  })

  it('hands the column back to the layout', () => {
    renderEditor()
    selectBox('title')
    fireEvent.click(
      screen.getByRole('button', { name: 'Back to layout settings' }),
    )
    expect(screen.getByDisplayValue('use for content')).toBeInTheDocument()
  })

  it('changes what a box holds', () => {
    const onSave = renderEditor()
    selectBox('body')
    fireEvent.change(screen.getByLabelText('What is it'), {
      target: { value: 'image' },
    })
    const body = saved(onSave).layouts[0]!.slots.find(s => s.name === 'body')
    expect(body?.kind).toBe('image')
  })

  it('sets a box’s type from a named style, so the template stays consistent', () => {
    const onSave = renderEditor()
    selectBox('title')
    fireEvent.change(screen.getByLabelText('Text style'), {
      target: { value: 'heading' },
    })
    const node = saved(onSave).layouts[0]!.tree!.children![0]!
    expect(node.style?.textStyle).toBe('heading')
  })

  it('lets a box override one thing about the style it follows', () => {
    const onSave = renderEditor()
    selectBox('title')
    fireEvent.change(screen.getByLabelText('Text style'), {
      target: { value: 'heading' },
    })
    fireEvent.change(screen.getByLabelText('Text size'), {
      target: { value: '9' },
    })
    const node = saved(onSave).layouts[0]!.tree!.children![0]!
    expect(node.style).toMatchObject({ textStyle: 'heading', fontSize: 9 })
  })

  it('leaves deleting to the outline, where the box is already listed', () => {
    renderEditor()
    selectBox('body')
    expect(screen.queryByRole('button', { name: 'Remove this box' })).toBeNull()
  })

  it('turns a box into a row of other boxes', () => {
    // One question, not two: a box either shows something or arranges things
    // that do.
    const onSave = renderEditor()
    selectBox('body')
    fireEvent.change(screen.getByLabelText('What is it'), {
      target: { value: 'row' },
    })
    const draft = saved(onSave).layouts[0]!
    const node = draft.tree!.children![1]!
    expect(node.container).toMatchObject({ mode: 'flex', direction: 'row' })
    // It no longer shows anything, so the slot it showed is gone with it.
    expect(node.slot).toBeUndefined()
    expect(draft.slots.map(s => s.name)).toEqual(['title'])
  })

  it('divides a new row evenly among its boxes', () => {
    // What someone making a row almost always means by it. Written onto the
    // boxes rather than assumed by the renderer, so it shows in their own
    // settings and can be changed there.
    const onSave = renderEditor()
    selectBox('body')
    fireEvent.change(screen.getByLabelText('What is it'), {
      target: { value: 'row' },
    })
    fireEvent.click(
      screen.getAllByRole('button', { name: /^Add a box inside/ }).at(-1)!,
    )
    fireEvent.click(
      screen.getAllByRole('button', { name: /^Add a box inside/ }).at(-1)!,
    )
    const row = saved(onSave).layouts[0]!.tree!.children![1]!
    expect(row.children).toHaveLength(2)
    // An equal share means starting from nothing, not sharing the leftovers.
    for (const child of row.children!)
      expect(child).toMatchObject({ grow: 1, basis: 0 })
  })

  it('leaves a layout that already sizes its boxes alone', () => {
    // The built-ins say how much room each box takes; an even split would be
    // a redesign of every slide already made with them.
    const onSave = renderEditor()
    const before = saved(onSave).layouts[0]!.tree!.children!
    for (const child of before) expect(child.grow).toBeUndefined()
  })

  it('turns an arrangement back into content, and its boxes go with it', () => {
    const onSave = renderEditor()
    selectBox('body')
    fireEvent.change(screen.getByLabelText('What is it'), {
      target: { value: 'grid' },
    })
    fireEvent.click(
      screen.getAllByRole('button', { name: /^Add a box inside/ }).at(-1)!,
    )
    // It is called "Grid" in the outline now — the name says what it is.
    selectBox('Grid')
    fireEvent.change(screen.getByLabelText('What is it'), {
      target: { value: 'text' },
    })
    const draft = saved(onSave).layouts[0]!
    const node = draft.tree!.children![1]!
    expect(node.container).toBeUndefined()
    expect(node.children).toBeUndefined()
    // Nothing is left to arrange the box it held, so its slot went too.
    expect(draft.slots).toHaveLength(2)
  })
})

describe('boxes of the author’s own', () => {
  it('takes four pictures on one slide (the professor’s case)', () => {
    const onSave = renderEditor()
    for (let i = 0; i < 4; i++) {
      // Queried fresh each time: adding a box re-renders the outline.
      fireEvent.click(
        screen.getAllByRole('button', { name: /^Add a box inside/ })[0]!,
      )
      fireEvent.change(screen.getByLabelText('What is it'), {
        target: { value: 'image' },
      })
    }
    const draft = saved(onSave).layouts[0]!
    expect(draft.slots.filter(s => s.kind === 'image')).toHaveLength(4)
    // Every one of them is drawn, not just declared.
    expect(draft.tree!.children).toHaveLength(6)
  })

  it('keeps each added box under a name of its own', () => {
    const onSave = renderEditor()
    for (let i = 0; i < 2; i++)
      fireEvent.click(
        screen.getAllByRole('button', { name: /^Add a box inside/ })[0]!,
      )
    const names = saved(onSave).layouts[0]!.slots.map(s => s.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('reorders boxes, which is both the flow and the paint order', () => {
    // A whole row is the drag surface; Alt+arrows is the keyboard route, the
    // same as reordering slides.
    const onSave = renderEditor()
    fireEvent.keyDown(screen.getByRole('listitem', { name: /^body/ }), {
      key: 'ArrowUp',
      altKey: true,
    })
    expect(saved(onSave).layouts[0]!.tree!.children!.map(c => c.id)).toEqual([
      'body',
      'title',
    ])
  })
})

describe('deleting a box from the outline', () => {
  it('removes it and the slot it showed, without asking', () => {
    // A box is one undo away, so a question per box would only be in the way.
    const onSave = renderEditor()
    fireEvent.click(boxDelete('body'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    const draft = saved(onSave).layouts[0]!
    expect(draft.slots.map(s => s.name)).toEqual(['title'])
    expect(draft.tree!.children!.map(c => c.id)).toEqual(['title'])
  })

  it('puts it back on undo', () => {
    const onSave = renderEditor()
    fireEvent.click(boxDelete('body'))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    const draft = saved(onSave).layouts[0]!
    expect(draft.slots.map(s => s.name)).toEqual(['title', 'body'])
    expect(draft.tree!.children!.map(c => c.id)).toEqual(['title', 'body'])
  })

  it('takes what a container held with it', () => {
    // Nothing is left to arrange those boxes, so their slots would be
    // declared and never drawn.
    const onSave = renderEditor()
    selectBox('body')
    fireEvent.change(screen.getByLabelText('What is it'), {
      target: { value: 'row' },
    })
    fireEvent.click(
      screen.getAllByRole('button', { name: /^Add a box inside/ }).at(-1)!,
    )
    fireEvent.click(boxDelete('Row'))
    const draft = saved(onSave).layouts[0]!
    expect(draft.slots.map(s => s.name)).toEqual(['title'])
    expect(draft.tree!.children!.map(c => c.id)).toEqual(['title'])
  })

  it('drops the selection when the box selected is the one deleted', () => {
    renderEditor()
    selectBox('body')
    fireEvent.click(boxDelete('body'))
    // The column is back to the layout's own settings, not a box that is gone.
    expect(screen.queryByLabelText('What is it')).toBeNull()
    expect(screen.getByDisplayValue('use for content')).toBeInTheDocument()
  })

  it('keeps a selection the deletion did not touch', () => {
    renderEditor()
    selectBox('title')
    fireEvent.click(boxDelete('body'))
    expect(screen.getByLabelText('What is it')).toBeInTheDocument()
  })

  it('offers nothing to delete on the layout’s own row', () => {
    // The root row is the layout itself; deleting that is the rail's job.
    renderEditor()
    // One per box — the two in this layout — and none for the root.
    expect(
      screen.getAllByRole('button', { name: /^Remove the .+ box$/ }),
    ).toHaveLength(2)
  })
})

describe('how much a box holds', () => {
  it('shows the budget it inherits without claiming it as its own', () => {
    // The placeholder is the style's number; the field stays empty, so
    // saving does not freeze an inherited value onto the box.
    renderEditor()
    selectBox('title')
    fireEvent.change(screen.getByLabelText('Text style'), {
      target: { value: 'heading' },
    })
    const field = screen.getByLabelText('Max characters')
    expect(field).toHaveValue(null)
    expect(field).toHaveAttribute('placeholder', '80')
  })

  it('lets a box state a budget of its own', () => {
    const onSave = renderEditor()
    selectBox('title')
    fireEvent.change(screen.getByLabelText('Max characters'), {
      target: { value: '25' },
    })
    expect(saved(onSave).layouts[0]!.slots[0]!.maxChars).toBe(25)
  })

  it('takes an authoring instruction for the AI (TMPL-10)', () => {
    const onSave = renderEditor()
    selectBox('title')
    fireEvent.change(screen.getByLabelText('What goes in it (for the AI)'), {
      target: { value: 'A runnable Python snippet, at most eight lines.' },
    })
    expect(saved(onSave).layouts[0]!.slots[0]!.description).toBe(
      'A runnable Python snippet, at most eight lines.',
    )
  })

  it('caps the instruction, since it is sent with every phrase', () => {
    renderEditor()
    selectBox('title')
    expect(
      screen.getByLabelText('What goes in it (for the AI)'),
    ).toHaveAttribute('maxlength', '200')
  })

  it('drops an instruction the author cleared', () => {
    const onSave = renderEditor()
    selectBox('title')
    const field = screen.getByLabelText('What goes in it (for the AI)')
    fireEvent.change(field, { target: { value: 'Something' } })
    fireEvent.change(field, { target: { value: '' } })
    // Absent, not empty: an empty quotation would still be sent
    expect(saved(onSave).layouts[0]!.slots[0]!.description).toBeUndefined()
  })

  it('takes a word ceiling as well as a character one', () => {
    const onSave = renderEditor()
    selectBox('title')
    fireEvent.change(screen.getByLabelText('Max words'), {
      target: { value: '40' },
    })
    expect(saved(onSave).layouts[0]!.slots[0]!.maxWords).toBe(40)
  })

  it('marks a box the slide should always fill', () => {
    const onSave = renderEditor()
    selectBox('title')
    fireEvent.click(screen.getByLabelText('The slide should always fill this'))
    expect(saved(onSave).layouts[0]!.slots[0]!.required).toBe(true)
  })

  it('offers a point count only to a list', () => {
    renderEditor()
    selectBox('title')
    expect(screen.queryByLabelText('Max points')).toBeNull()
    fireEvent.change(screen.getByLabelText('What is it'), {
      target: { value: 'bullets' },
    })
    expect(screen.getByLabelText('Max points')).toBeInTheDocument()
  })

  it('changes what every box in a style holds, from the template settings', () => {
    const onSave = renderEditor()
    fireEvent.change(screen.getByLabelText('Max characters for Body'), {
      target: { value: '200' },
    })
    const styles = saved(onSave).theme.textStyles as Record<
      string,
      { maxChars: number }
    >
    expect(styles.body!.maxChars).toBe(200)
  })
})

describe('what the editor does not show', () => {
  it('carries a layout’s AI constraints through a save untouched', () => {
    // The editor has no controls for these — they steer generation, not
    // appearance — but it must not drop what it cannot show. Saving a
    // template would otherwise quietly lift every limit on it.
    const constrained = layout('content', 'Content', ['title', 'body'])
    constrained.constraints = { maxBullets: 6, maxTitleChars: 60 }
    constrained.slots[0]!.maxChars = 60
    const onSave = renderEditor(vi.fn(), {
      layouts: [constrained, layout('whiteboard', 'Whiteboard', [])],
    })
    fireEvent.change(screen.getByLabelText('Template name'), {
      target: { value: 'Renamed' },
    })
    const saved_ = saved(onSave).layouts[0]!
    expect(saved_.constraints).toEqual({ maxBullets: 6, maxTitleChars: 60 })
    expect(saved_.slots[0]!.maxChars).toBe(60)
  })
})

describe('template settings', () => {
  it('saves a new name', () => {
    const onSave = renderEditor()
    fireEvent.change(screen.getByLabelText('Template name'), {
      target: { value: 'Renamed' },
    })
    expect(saved(onSave).name).toBe('Renamed')
  })

  it('saves a default colour', () => {
    const onSave = renderEditor()
    fireEvent.change(screen.getByLabelText('Accent'), {
      target: { value: '#00ff00' },
    })
    expect(saved(onSave).theme.accent).toBe('#00ff00')
  })

  it('saves who may use it (TMPL-4 sharing)', () => {
    const onSave = renderEditor()
    fireEvent.change(screen.getByLabelText('Who can use it'), {
      target: { value: 'public' },
    })
    expect(saved(onSave).visibility).toBe('public')
  })

  it('restyles every box that follows a text style, in one edit', () => {
    const onSave = renderEditor()
    fireEvent.change(screen.getByLabelText('Text size for Body'), {
      target: { value: '5' },
    })
    const styles = saved(onSave).theme.textStyles as Record<
      string,
      { fontSize: number }
    >
    expect(styles.body!.fontSize).toBe(5)
  })

  it('saves margins as fractions, though they are typed as percentages', () => {
    const onSave = renderEditor()
    fireEvent.change(screen.getByLabelText('Sides %'), {
      target: { value: '10' },
    })
    expect(saved(onSave).theme.marginX).toBeCloseTo(0.1, 5)
  })
})

describe('previewing a layout at its limits', () => {
  /** A layout whose boxes say how much they hold, so there is a limit to
   * fill them to. */
  const bounded = (): Partial<Template> => ({
    layouts: [
      {
        ...layout('content', 'Content', ['title']),
        slots: [
          { name: 'title', kind: 'text', label: 'title', maxChars: 90 },
          { name: 'points', kind: 'bullets', label: 'points', maxItems: 5 },
        ],
        tree: tree([
          { id: 'title', slot: 'title' },
          { id: 'points', slot: 'points' },
        ]),
      } as Layout,
      layout('whiteboard', 'Whiteboard', []),
    ],
  })

  const canvas = () => screen.getByTestId('template-canvas')
  const box = (id: string) =>
    canvas().querySelector(`[data-node-id="${id}"]`) as HTMLElement

  it('starts on the comfortable sample', () => {
    renderEditor(vi.fn(), bounded())
    expect(
      screen.getByRole('checkbox', { name: /Fill every box to its limit/ }),
    ).not.toBeChecked()
    expect(box('title').textContent).toBe('A slide in this style')
  })

  it('fills every box to what the template says it holds', () => {
    renderEditor(vi.fn(), bounded())
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Fill every box to its limit/ }),
    )

    // The title box says 90 characters, so that is about what it shows —
    // far more than the sample sentence it held a moment ago.
    const filled = box('title').textContent ?? ''
    expect(filled.length).toBeLessThanOrEqual(90)
    expect(filled.length).toBeGreaterThan(87)
    // …and the list box says five points, so it lists five
    expect(box('points').querySelectorAll('li')).toHaveLength(5)
  })

  it('is a way of looking, not an edit: nothing about it is saved', () => {
    const onSave = renderEditor(vi.fn(), bounded())
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Fill every box to its limit/ }),
    )
    const draft = saved(onSave)
    expect(draft.layouts[0]!.slots).toEqual([
      { name: 'title', kind: 'text', label: 'title', maxChars: 90 },
      { name: 'points', kind: 'bullets', label: 'points', maxItems: 5 },
    ])
  })
})

describe('undo', () => {
  it('is offered as a button, not only as a shortcut', () => {
    renderEditor()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  it('takes back an edit, and puts it back again', () => {
    const onSave = renderEditor()
    const purpose = screen.getByDisplayValue('use for content')
    // The snapshot is taken when a field is focused, so a whole typed word
    // is one undo step rather than one per keystroke.
    fireEvent.focus(purpose)
    fireEvent.change(purpose, { target: { value: 'changed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByDisplayValue('use for content')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(saved(onSave).layouts[0]!.purpose).toBe('changed')
  })

  it('restores the selection along with the edit', () => {
    // Undoing a deletion that leaves nothing selected is disorienting.
    renderEditor()
    selectBox('body')
    fireEvent.click(boxDelete('body'))
    expect(screen.queryByLabelText('What is it')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByLabelText('What is it')).toBeInTheDocument()
  })
})
