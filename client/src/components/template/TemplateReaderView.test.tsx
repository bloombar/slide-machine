/**
 * Unit tests for a reader's own view of a design (TMPL-29): everything the
 * editor shows, read-only, with picking a layout or a box still live.
 *
 * These render the real `TemplateSettings`/`LayoutInspector`/`SlotInspector`
 * inside a `<fieldset disabled>` (see TemplateReaderView's own docstring for
 * why), so the tests below check fields drawn from every corner of those
 * three components — theme, spacing, per-role text styles, a box's
 * arrangement, its sizing, its type overrides, its inherited budget — rather
 * than only the few a hand-rolled read-out might have remembered to carry
 * over. Losing any of those fields, or the `readOnly` prop that keeps the
 * rail and the outline from offering to add, delete or drag, should fail a
 * test here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Layout, LayoutNode, Template } from '@slide-machine/shared'
import TemplateReaderView from './TemplateReaderView'
import { resetPreviewImages } from './usePreviewImages'
import { dispatchAction } from '../../api/actions'

vi.mock('../../api/actions')

const tree = (children: LayoutNode[]): LayoutNode => ({
  id: 'root',
  container: { mode: 'flex', direction: 'column', gap: 3 },
  children,
})

const layout = (over: Partial<Layout> = {}): Layout => ({
  type: 'content',
  label: 'Content',
  purpose: 'Use for a slide with a title and a body',
  slots: [
    { name: 'title', kind: 'text', label: 'Title' },
    {
      name: 'body',
      kind: 'text',
      label: 'Body',
      description: 'A worked example, in plain language.',
      maxChars: 400,
    },
  ],
  tree: tree([
    { id: 'title', slot: 'title' },
    { id: 'body', slot: 'body' },
  ]),
  elementPositions: {},
  ...over,
})

const template = (over: Partial<Template> = {}): Template => ({
  id: 'design-1',
  permalinkSlug: 'a-design-ab12',
  ownerId: 'u2',
  owner: { id: 'u2', displayName: 'Designer' },
  name: 'A Design',
  theme: { background: '#ffffff', text: '#000000', accent: '#ff0000' },
  aiInstructions: 'Write for first-year undergraduates.',
  layouts: [
    layout(),
    layout({
      type: 'list',
      label: 'Points',
      purpose: 'Use for a list of points',
      slots: [{ name: 'bullets', kind: 'bullets', label: 'Bullets' }],
      tree: tree([{ id: 'bullets', slot: 'bullets' }]),
    }),
    layout({
      type: 'whiteboard',
      label: 'Whiteboard',
      slots: [],
      tree: undefined,
    }),
  ],
  visibility: 'public',
  myRole: null,
  voteScore: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

/**
 * A design with a grid container and a text box that leans on an inherited
 * text style, so a field only reachable that way (columns, an inherited
 * character budget) has something to show.
 */
const richTemplate = (): Template => ({
  id: 'design-2',
  permalinkSlug: 'a-rich-design-cd34',
  ownerId: 'u2',
  owner: { id: 'u2', displayName: 'Designer' },
  name: 'A Rich Design',
  theme: {
    background: '#ffffff',
    text: '#000000',
    accent: '#ff0000',
    // The role a box below follows, so its own fields can be left unset and
    // still have something to inherit and display as a placeholder.
    textStyles: { body: { maxChars: 250, fontWeight: 600 } },
  },
  visibility: 'public',
  myRole: null,
  voteScore: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  layouts: [
    {
      type: 'content',
      label: 'Content',
      purpose: 'Use for a slide with a title and a body',
      slots: [
        { name: 'title', kind: 'text', label: 'Title' },
        { name: 'body', kind: 'text', label: 'Body' },
        { name: 'image', kind: 'image', label: 'Image' },
      ],
      tree: {
        id: 'root',
        container: { mode: 'flex', direction: 'column', gap: 3 },
        children: [
          { id: 'title', slot: 'title', style: { textStyle: 'title' } },
          {
            id: 'grid1',
            container: { mode: 'grid', columns: 2 },
            children: [
              {
                id: 'body',
                slot: 'body',
                style: { textStyle: 'body' },
                colSpan: 1,
              },
              { id: 'image', slot: 'image' },
            ],
          },
        ],
      },
      elementPositions: {},
    },
  ],
})

beforeEach(() => {
  resetPreviewImages()
  vi.mocked(dispatchAction).mockReset()
  vi.mocked(dispatchAction).mockResolvedValue({ urls: [] } as never)
})

describe('TemplateReaderView (TMPL-29)', () => {
  it('shows the design’s AI instructions in full', () => {
    render(<TemplateReaderView template={template()} />)
    expect(
      screen.getByDisplayValue('Write for first-year undergraduates.'),
    ).toBeInTheDocument()
  })

  it('shows the first layout’s own settings, and switching layouts updates them', () => {
    render(<TemplateReaderView template={template()} />)
    expect(
      screen.getByDisplayValue('Use for a slide with a title and a body'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Points/ }))
    expect(
      screen.getByDisplayValue('Use for a list of points'),
    ).toBeInTheDocument()
  })

  it('leaves the whiteboard out of the layouts a reader can select', () => {
    render(<TemplateReaderView template={template()} />)
    expect(screen.queryByRole('tab', { name: /Whiteboard/ })).toBeNull()
  })

  it('shows a box’s settings, including the author’s AI instruction, when selected', () => {
    render(<TemplateReaderView template={template()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Body' }))

    expect(
      screen.getByDisplayValue('A worked example, in plain language.'),
    ).toBeInTheDocument()
    // The character budget the author set for this box.
    expect(screen.getByDisplayValue('400')).toBeInTheDocument()
  })

  it('shows an unset AI-instructions field as empty with an example placeholder, not as if the design held it', () => {
    // `richTemplate` sets no `aiInstructions` at all.
    render(<TemplateReaderView template={richTemplate()} />)
    const field = screen.getByLabelText('Instructions for the AI')
    expect(field).toHaveValue('')
    expect(field).toHaveAttribute(
      'placeholder',
      'e.g. Write for first-year undergraduates. Avoid jargon; define any term the first time it appears.',
    )
  })

  it('renders TemplateSettings’ theme, spacing and per-role text-style fields, disabled', () => {
    render(<TemplateReaderView template={richTemplate()} />)

    // The whole-design theme.
    expect(screen.getByLabelText('Background')).toBeDisabled()
    // Default margins.
    expect(screen.getByLabelText('Sides %')).toBeDisabled()
    // A named text style's own default budget — set on the theme, not on
    // any one box, so this is the only place it shows at all.
    const roleMaxChars = screen.getByLabelText('Max characters for Body')
    expect(roleMaxChars).toBeDisabled()
    expect(roleMaxChars).toHaveValue(250)
    // The design-wide visibility read-out a non-owner already gets.
    expect(screen.getByLabelText('Who can use it')).toBeDisabled()
  })

  it('renders a selected box’s arrangement, sizing, type and inherited-budget fields from SlotInspector, disabled', () => {
    render(<TemplateReaderView template={richTemplate()} />)

    // The grid container itself: its own arrangement fields.
    fireEvent.click(screen.getByRole('button', { name: 'Grid' }))
    expect(screen.getByLabelText('Columns')).toBeDisabled()

    // A box inside it: sizing (colSpan, since its parent is a grid), a type
    // override (font weight), and the character budget it inherits from the
    // "Body" text style rather than stating for itself.
    fireEvent.click(screen.getByRole('button', { name: 'Body' }))
    expect(screen.getByLabelText('Columns wide')).toBeDisabled()
    expect(screen.getByLabelText('Inner space')).toBeDisabled()
    expect(screen.getByLabelText('Weight')).toBeDisabled()
    const budget = screen.getByLabelText('Maximum')
    expect(budget).toBeDisabled()
    // Nothing of its own to show, so the number in force reads as a
    // placeholder — exactly as the editor shows it for an unset field.
    expect(budget).toHaveAttribute('placeholder', '250')
  })

  it('has no editable or actionable control anywhere but navigation, and never writes', () => {
    const { container } = render(
      <TemplateReaderView template={richTemplate()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Body' }))

    const controls = Array.from(
      container.querySelectorAll(
        'input, textarea, select, button, [role="button"]',
      ),
    )
    // `:disabled` rather than the `.disabled` IDL property: jsdom does not
    // implement a `<fieldset disabled>`'s effect on its descendants for the
    // property getter, only for the CSS pseudo-class (a documented jsdom
    // gap — a real browser, and `@testing-library/jest-dom`'s `toBeDisabled`
    // matcher used elsewhere in this file, both read it correctly either
    // way).
    const enabled = controls.filter(el => !el.matches(':disabled'))
    expect(enabled.length).toBeGreaterThan(0)

    // Every one of them only changes what is on screen, never the design: a
    // layout tab or the rail's own narrow-screen picker, an outline row
    // picking a box (a `<div role="button">`, since it is not a real
    // `<button>` — that distinction is what tells it apart from every
    // *inspector's* own button, which the fieldset above already disables),
    // or the "Back to layout settings" control.
    const isNavigational = (el: Element) =>
      el.getAttribute('role') === 'tab' ||
      el.matches('select') ||
      (el.getAttribute('role') === 'button' && el.tagName === 'DIV') ||
      el.textContent === 'Back to layout settings'
    for (const el of enabled) {
      expect(isNavigational(el)).toBe(true)
    }

    // A read of the preview images and the descriptor budget is fine; a
    // write to the design itself is not.
    for (const call of vi.mocked(dispatchAction).mock.calls) {
      expect(call[0]).not.toBe('template.update')
    }
  })

  it('offers a way back to a layout’s own settings once a box is selected', () => {
    render(<TemplateReaderView template={template()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Body' }))
    expect(
      screen.getByDisplayValue('A worked example, in plain language.'),
    ).toBeInTheDocument()

    // `SlotInspector`'s own close button carries the same label and is
    // still in the DOM, disabled, inside the fieldset — so there are two
    // matches for the name, and only the enabled one is this control.
    const backButtons = screen.getAllByRole('button', {
      name: 'Back to layout settings',
    })
    const enabledBack = backButtons.find(b => !b.matches(':disabled'))
    expect(enabledBack).toBeDefined()
    fireEvent.click(enabledBack!)

    expect(
      screen.getByDisplayValue('Use for a slide with a title and a body'),
    ).toBeInTheDocument()
    expect(
      screen.queryByDisplayValue('A worked example, in plain language.'),
    ).toBeNull()
  })

  it('offers nothing to add, delete or reorder — deleting readOnly from the rail or the outline would fail this', () => {
    render(<TemplateReaderView template={richTemplate()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Grid' }))

    expect(screen.queryByRole('button', { name: 'Add layout' })).toBeNull()
    expect(
      screen.queryByRole('button', { name: /^Remove the .* layout$/ }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: /^Add a box inside / }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: /^Remove the .* box$/ }),
    ).toBeNull()
  })

  it('lets a box be selected by keyboard, not only by pointer', () => {
    render(<TemplateReaderView template={template()} />)
    const row = screen.getByRole('button', { name: 'Body' })
    // The row has to be reachable by keyboard at all — `tabIndex` is what
    // `readOnly` adds to it in place of `DraggableListRow`'s own — before
    // proving that focusing and activating it does anything.
    expect(row).toHaveAttribute('tabindex', '0')
    row.focus()
    expect(row).toHaveFocus()
    fireEvent.keyDown(row, { key: 'Enter' })

    expect(
      screen.getByDisplayValue('A worked example, in plain language.'),
    ).toBeInTheDocument()
  })
})
