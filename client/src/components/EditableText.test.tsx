/**
 * Unit tests for generalizable in-place editing: click-to-edit,
 * debounced auto-save while typing, flush on Enter/blur, and Escape
 * reverting even after an interim save.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import EditableText from './EditableText'

const startEdit = () =>
  fireEvent.click(screen.getByTitle('Click to edit Slide title'))

describe('EditableText', () => {
  it('renders text and swaps to an input on click', () => {
    render(<EditableText value="Hello" label="Slide title" onSave={vi.fn()} />)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

    startEdit()

    expect(screen.getByRole('textbox', { name: 'Slide title' })).toHaveValue(
      'Hello',
    )
  })

  it('auto-saves once after a typing burst (debounced)', async () => {
    const onSave = vi.fn()
    render(
      <EditableText
        value="Hello"
        label="Slide title"
        onSave={onSave}
        debounceMs={20}
      />,
    )
    startEdit()

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'He' } })
    fireEvent.change(input, { target: { value: 'Hey' } })
    fireEvent.change(input, { target: { value: 'Hey there' } })

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith('Hey there')
  })

  it('flushes immediately on Enter and on blur', () => {
    const onSave = vi.fn()
    render(
      <EditableText
        value="Hello"
        label="Slide title"
        onSave={onSave}
        debounceMs={5000}
      />,
    )
    startEdit()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })

    expect(onSave).toHaveBeenCalledWith('New')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('does not save when the text is unchanged', () => {
    const onSave = vi.fn()
    render(
      <EditableText
        value="Hello"
        label="Slide title"
        onSave={onSave}
        debounceMs={5}
      />,
    )
    startEdit()
    fireEvent.blur(screen.getByRole('textbox'))

    expect(onSave).not.toHaveBeenCalled()
  })

  it('Escape reverts, undoing any interim debounced save', async () => {
    const onSave = vi.fn()
    render(
      <EditableText
        value="Hello"
        label="Slide title"
        onSave={onSave}
        debounceMs={10}
      />,
    )
    startEdit()

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Oops' } })
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Oops'))

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(onSave).toHaveBeenLastCalledWith('Hello')
  })

  it('truncates as a block, so the text keeps the baseline beside it', () => {
    // jsdom has no layout: the mechanism is the assertion. A truncating
    // inline-block sits on the line by its bottom edge (hidden overflow),
    // which lifts the text above whatever it sits next to — the lecture
    // title beside its project in the nav. It also drops the padding that
    // would ellipsize text that fits.
    const { rerender } = render(
      <EditableText value="Hello" label="Slide title" onSave={vi.fn()} />,
    )
    expect(screen.getByTitle('Click to edit Slide title')).toHaveClass(
      'inline-block',
    )

    rerender(
      <EditableText
        value="Hello"
        label="Slide title"
        onSave={vi.fn()}
        truncate
      />,
    )
    const display = screen.getByTitle('Click to edit Slide title')
    expect(display).toHaveClass('block', 'truncate', 'max-w-full')
    expect(display).not.toHaveClass('inline-block', 'px-1', '-mx-1')
  })

  it('uses a textarea with Cmd/Ctrl+Enter flush when multiline', () => {
    const onSave = vi.fn()
    render(
      <EditableText
        value="Body text"
        label="Slide title"
        multiline
        onSave={onSave}
      />,
    )
    startEdit()

    const box = screen.getByRole('textbox')
    expect(box.tagName).toBe('TEXTAREA')
    fireEvent.change(box, { target: { value: 'Line one' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true })
    expect(onSave).toHaveBeenCalledWith('Line one')
  })
})

/**
 * A box is where its design put it, and typing in it is not a reason to move
 * it. An imported title centres its contents vertically, so anything that
 * makes the editor taller than the text it replaced pushes the words up and
 * out from under the reader — and back down when they finish.
 */
describe('editing does not move the box', () => {
  it('draws the hint outside the box, so nothing can clip it', () => {
    // The box a slide gives a field is sized by its design and clips what it
    // holds, so a hint drawn inside it was cut off — and counted as the box's
    // content, which took `useFitText` to the floor trying to fit it. It is
    // placed over the slide instead, from the document root.
    render(
      <div data-testid="box" style={{ overflow: 'hidden', height: 20 }}>
        <EditableText
          value="Runoff"
          label="Slide title"
          hint="The main presentation title or section heading."
          onSave={vi.fn()}
        />
      </div>,
    )
    fireEvent.click(screen.getByTitle('Click to edit Slide title'))
    const hint = screen.getByText(
      'The main presentation title or section heading.',
    )
    expect(hint.closest('[data-testid="box"]')).toBeNull()
    expect(hint.parentElement).toBe(document.body)
    // Nothing but the field is left inside the box, so it costs no height
    expect(screen.getByTestId('box')).toContainElement(
      screen.getByRole('textbox'),
    )
    // Over the slide rather than under it, and untouchable: a click on the
    // hint would blur the field it describes and end the edit
    expect(hint).toHaveClass('fixed')
    expect(hint).toHaveClass('pointer-events-none')
  })

  it('names the hint from the field, which a portal would otherwise lose', () => {
    // Out of the reading order, a screen reader would never reach it.
    render(
      <EditableText
        value="Runoff"
        label="Slide title"
        hint="One line on what this part covers."
        onSave={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTitle('Click to edit Slide title'))
    expect(screen.getByRole('textbox')).toHaveAccessibleDescription(
      'One line on what this part covers.',
    )
  })

  it('takes the hint away with the field when the edit ends', () => {
    render(
      <EditableText
        value="Runoff"
        label="Slide title"
        hint="One line on what this part covers."
        onSave={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTitle('Click to edit Slide title'))
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    // A portal outlives its own subtree if it is not unmounted with it
    expect(
      screen.queryByText('One line on what this part covers.'),
    ).not.toBeInTheDocument()
  })

  it('edits a wrapping box in a field that wraps', () => {
    // An input never wraps: a title that reads as three lines on the slide
    // straightened into one long line under the cursor and the box stopped
    // looking like the box.
    render(
      <EditableText
        value="A title long enough to wrap over more than one line"
        label="Slide title"
        onSave={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTitle('Click to edit Slide title'))
    expect(screen.getByRole('textbox').tagName).toBe('TEXTAREA')
  })

  it('edits a truncating box on one line, as it is displayed', () => {
    // The control: a header title ellipsizes rather than wrapping, so a
    // wrapping field would misrepresent it.
    render(
      <EditableText
        value="A lecture title in a narrow header"
        label="Slide title"
        truncate
        onSave={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTitle('Click to edit Slide title'))
    expect(screen.getByRole('textbox').tagName).toBe('INPUT')
  })

  it('keeps a one-line value on one line, whatever is pasted into it', () => {
    // A textarea does not flatten pasted newlines the way an input did.
    const onSave = vi.fn()
    render(<EditableText value="Runoff" label="Slide title" onSave={onSave} />)
    fireEvent.click(screen.getByTitle('Click to edit Slide title'))
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: 'One\nTwo' } })
    expect(box).toHaveValue('One Two')
  })

  it('gives a one-line box one row, not two', () => {
    render(
      <EditableText
        value="Runoff"
        label="Slide body"
        multiline
        onSave={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTitle('Click to edit Slide body'))
    expect(screen.getByRole('textbox', { name: 'Slide body' })).toHaveAttribute(
      'rows',
      '1',
    )
  })

  it('grows a row per line the text actually has', () => {
    render(
      <EditableText
        value={'one\ntwo\nthree'}
        label="Slide body"
        multiline
        onSave={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTitle('Click to edit Slide body'))
    expect(screen.getByRole('textbox', { name: 'Slide body' })).toHaveAttribute(
      'rows',
      '3',
    )
  })
})
