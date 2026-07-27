/**
 * Unit tests for the spoken-transcript editor (EDIT-6): it shows the stored
 * narration, saves an edit through the action layer, cancels without saving,
 * warns when the slide carries whiteboard marks, and surfaces a save failure.
 * The save API is mocked so the tests stay offline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Slide, Stroke } from '@slide-machine/shared'
import TranscriptEditorModal from './TranscriptEditorModal'
import { editSlideTranscript } from '../api/slides'

vi.mock('../api/slides', () => ({ editSlideTranscript: vi.fn() }))
const mockedSave = vi.mocked(editSlideTranscript)

const slide = (over: Partial<Slide> = {}): Slide => ({
  id: 's1',
  deckId: 'deck1',
  index: 0,
  layoutType: 'content',
  title: 'Cells',
  sourceTranscript: 'A cell is the basic unit of life.',
  ...over,
})

/** A whiteboard mark, optionally already erased (so it no longer shows). */
const stroke = (erased = false): Stroke => ({
  id: 'stroke-1',
  tool: 'pen',
  color: '#1e293b',
  thickness: 0.01,
  points: [{ x: 0.2, y: 0.3 }],
  startedAt: '2026-07-21T10:00:00.000Z',
  endedAt: '2026-07-21T10:00:01.000Z',
  anchor: { charAnchor: 4, source: 'word' },
  ...(erased ? { erasedAnchor: { charAnchor: 20, source: 'word' } } : {}),
})

const setup = (over: Partial<Slide> = {}) => {
  const onSaved = vi.fn()
  const onClose = vi.fn()
  render(
    <TranscriptEditorModal
      slide={slide(over)}
      number={2}
      onSaved={onSaved}
      onClose={onClose}
    />,
  )
  return {
    onSaved,
    onClose,
    field: screen.getByRole('textbox', { name: 'Spoken transcript' }),
  }
}

beforeEach(() => {
  mockedSave.mockReset()
})

describe('TranscriptEditorModal', () => {
  it('shows the slide number and its stored transcript', () => {
    const { field } = setup()
    expect(
      screen.getByRole('heading', { name: 'Spoken transcript — slide 2' }),
    ).toBeInTheDocument()
    expect(field).toHaveValue('A cell is the basic unit of life.')
  })

  it('saves an edited transcript and hands back the refreshed slide', async () => {
    const updated = slide({ sourceTranscript: 'Cells are life’s unit.' })
    mockedSave.mockResolvedValue(updated)
    const { onSaved, onClose, field } = setup()

    fireEvent.change(field, { target: { value: 'Cells are life’s unit.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save transcript' }))

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated))
    expect(mockedSave).toHaveBeenCalledWith('s1', 'Cells are life’s unit.')
    expect(onClose).toHaveBeenCalled()
  })

  it('cancels without saving', () => {
    const { onClose, field } = setup()
    fireEvent.change(field, { target: { value: 'Discarded' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mockedSave).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('closes without a request when nothing changed', () => {
    const { onClose } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Save transcript' }))
    expect(mockedSave).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('saves an empty transcript, which clears the stored narration', async () => {
    mockedSave.mockResolvedValue(slide({ sourceTranscript: undefined }))
    const { field } = setup()
    fireEvent.change(field, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save transcript' }))
    await vi.waitFor(() => expect(mockedSave).toHaveBeenCalledWith('s1', ''))
  })

  // Marks are timed to the transcript (WB-2), so an edit can move or orphan
  // them — the dialog says so before the user commits.
  it('warns about whiteboard marks only when the slide has visible ones', () => {
    const note = /whiteboard markings timed to the transcript/i
    const { unmount } = render(
      <TranscriptEditorModal
        slide={slide({ drawings: [stroke()] })}
        number={1}
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText(note)).toBeInTheDocument()
    unmount()

    // An erased mark no longer shows on the slide, so it earns no warning.
    render(
      <TranscriptEditorModal
        slide={slide({ drawings: [stroke(true)] })}
        number={1}
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByText(note)).not.toBeInTheDocument()
  })

  it('keeps the dialog open and reports a failed save', async () => {
    mockedSave.mockRejectedValue(new Error('nope'))
    const { onSaved, onClose, field } = setup()
    fireEvent.change(field, { target: { value: 'New text' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save transcript' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save the transcript',
    )
    expect(onSaved).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    // The edit is still there to retry with.
    expect(field).toHaveValue('New text')
  })
})
