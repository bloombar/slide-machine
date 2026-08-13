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
  it('keeps the hint out of the flow, so it adds no height', () => {
    render(
      <EditableText
        value="Runoff"
        label="Slide title"
        hint="The main presentation title or section heading."
        onSave={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTitle('Click to edit Slide title'))
    const hint = screen.getByText(
      'The main presentation title or section heading.',
    )
    // Absolutely placed under the field: visible, and costing no height
    expect(hint).toHaveClass('absolute')
    expect(hint).toHaveClass('top-full')
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
