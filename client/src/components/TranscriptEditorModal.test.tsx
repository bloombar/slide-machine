/**
 * Unit tests for the spoken-transcript editor (EDIT-6): it shows the stored
 * narration, saves an edit through the action layer, cancels without saving,
 * warns when the slide carries whiteboard marks, surfaces a save failure, and
 * — when the slide's recorded audio is still available — re-transcribes it into
 * the field (GEN-4). The APIs are mocked so the tests stay offline.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type {
  DeckRefineSlideTranscriptResult,
  Slide,
  SlideRegenerateTranscriptResult,
  Stroke,
} from '@slide-machine/shared'
import TranscriptEditorModal from './TranscriptEditorModal'
import type { TtsPlayback } from '../tts/playback'
import {
  editSlideTranscript,
  refineSlideTranscript,
  regenerateSlideTranscript,
} from '../api/slides'

vi.mock('../api/slides', () => ({
  editSlideTranscript: vi.fn(),
  regenerateSlideTranscript: vi.fn(),
  refineSlideTranscript: vi.fn(),
}))
const mockedSave = vi.mocked(editSlideTranscript)
const mockedRegenerate = vi.mocked(regenerateSlideTranscript)
const mockedRefine = vi.mocked(refineSlideTranscript)

const REGENERATE = 'Regenerate from spoken audio'

const slide = (over: Partial<Slide> = {}): Slide => ({
  id: 's1',
  deckId: 'deck1',
  index: 0,
  layoutType: 'content',
  slots: {},
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

/** A stand-in for the app's shared TTS controller, in a given state. */
const fakeTts = (
  over: Partial<TtsPlayback> = {},
): TtsPlayback & { speakText: Mock; pauseResume: Mock; stop: Mock } =>
  ({
    status: 'idle',
    scope: null,
    activeIndex: null,
    playDeck: vi.fn(),
    speakSlide: vi.fn(),
    speakText: vi.fn(),
    toggle: vi.fn(),
    pauseResume: vi.fn(),
    stop: vi.fn(),
    getProgress: vi.fn(),
    ...over,
  }) as TtsPlayback & { speakText: Mock; pauseResume: Mock; stop: Mock }

interface Options {
  canRegenerate?: boolean
  canRefine?: boolean
  tts?: TtsPlayback
}

const setup = (over: Partial<Slide> = {}, options: Options = {}) => {
  const onSaved = vi.fn()
  const onClose = vi.fn()
  const view = render(
    <TranscriptEditorModal
      slide={slide(over)}
      number={2}
      canRegenerate={options.canRegenerate}
      canRefine={options.canRefine}
      tts={options.tts}
      onSaved={onSaved}
      onClose={onClose}
    />,
  )
  return {
    ...view,
    onSaved,
    onClose,
    field: screen.getByRole('textbox', { name: 'Spoken transcript' }),
  }
}

beforeEach(() => {
  mockedSave.mockReset()
  mockedRegenerate.mockReset()
  mockedRefine.mockReset()
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

  it('cancels straight away when nothing was changed', () => {
    const { onClose } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mockedSave).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  // A rewrite is real work; closing must not throw it away on one stray click.
  it('confirms before discarding unsaved changes, then closes', () => {
    const { onClose, field } = setup()
    fireEvent.change(field, { target: { value: 'Discarded' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toHaveAccessibleName(
      'Discard changes?',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(mockedSave).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('keeps the edit when the discard prompt is dismissed', () => {
    const { onClose, field } = setup()
    fireEvent.change(field, { target: { value: 'Still wanted' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    // The prompt's own Cancel returns to the editor with the text intact.
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' }).at(-1)!)

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(field).toHaveValue('Still wanted')
  })

  // Escape and the backdrop share Cancel's dismissal path, so one covers both.
  it('confirms before discarding an Escape dismissal', () => {
    const { onClose, field } = setup()
    fireEvent.change(field, { target: { value: 'Typed by hand' } })

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()

    // Escape now belongs to the prompt: it cancels the discard, not the editor.
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(field).toHaveValue('Typed by hand')
  })

  it('confirms before discarding a regenerated transcript', async () => {
    mockedRegenerate.mockResolvedValue({ transcript: 'Heard afresh.' })
    const { onClose, field } = setup({}, { canRegenerate: true })

    fireEvent.click(screen.getByRole('button', { name: REGENERATE }))
    await vi.waitFor(() => expect(field).toHaveValue('Heard afresh.'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes without a prompt when an edit was reverted by hand', () => {
    const { onClose, field } = setup()
    fireEvent.change(field, { target: { value: 'Changed' } })
    fireEvent.change(field, {
      target: { value: 'A cell is the basic unit of life.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
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

  // The link is the only entry point to re-transcription, so its presence is
  // exactly the promise that recorded audio for this slide still exists.
  it('offers regeneration only when the slide has recorded audio', () => {
    const { unmount } = render(
      <TranscriptEditorModal
        slide={slide()}
        number={1}
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: REGENERATE })).toBeNull()
    unmount()

    setup({}, { canRegenerate: true })
    expect(screen.getByRole('button', { name: REGENERATE })).toBeInTheDocument()
  })

  it('re-transcribes the recorded audio into the field', async () => {
    mockedRegenerate.mockResolvedValue({
      transcript: 'What was actually said.',
    })
    const { field } = setup({}, { canRegenerate: true })

    fireEvent.click(screen.getByRole('button', { name: REGENERATE }))
    await vi.waitFor(() => expect(field).toHaveValue('What was actually said.'))
    // Regenerating only fills the field; the slide is untouched until Save.
    expect(mockedRegenerate).toHaveBeenCalledWith('s1')
    expect(mockedSave).not.toHaveBeenCalled()
  })

  it('locks the field and says so while regenerating', async () => {
    let finish!: (result: SlideRegenerateTranscriptResult) => void
    mockedRegenerate.mockReturnValue(
      new Promise<SlideRegenerateTranscriptResult>(resolve => {
        finish = resolve
      }),
    )
    const { field } = setup({}, { canRegenerate: true })

    fireEvent.click(screen.getByRole('button', { name: REGENERATE }))
    // Editing text that is about to be replaced would silently lose the edit.
    expect(field).toBeDisabled()
    expect(await screen.findByRole('status')).toHaveTextContent(
      /Regenerating from spoken audio/i,
    )
    expect(
      screen.getByRole('button', { name: 'Save transcript' }),
    ).toBeDisabled()

    finish({ transcript: 'Heard afresh.' })
    await vi.waitFor(() => expect(field).toBeEnabled())
    expect(field).toHaveValue('Heard afresh.')
  })

  it('saves the regenerated text like any other edit', async () => {
    mockedRegenerate.mockResolvedValue({ transcript: 'Heard afresh.' })
    const updated = slide({ sourceTranscript: 'Heard afresh.' })
    mockedSave.mockResolvedValue(updated)
    const { onSaved, field } = setup({}, { canRegenerate: true })

    fireEvent.click(screen.getByRole('button', { name: REGENERATE }))
    await vi.waitFor(() => expect(field).toHaveValue('Heard afresh.'))
    fireEvent.click(screen.getByRole('button', { name: 'Save transcript' }))

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated))
    expect(mockedSave).toHaveBeenCalledWith('s1', 'Heard afresh.')
  })

  it('keeps the current text and reports a failed regeneration', async () => {
    mockedRegenerate.mockRejectedValue(new Error('no audio'))
    const { field } = setup({}, { canRegenerate: true })

    fireEvent.click(screen.getByRole('button', { name: REGENERATE }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not regenerate from the recorded audio',
    )
    expect(field).toHaveValue('A cell is the basic unit of life.')
    // Editing stays possible, so the failure costs nothing.
    expect(field).toBeEnabled()
  })

  // Refine runs the same narration pass as the kebab "Refine this slide", at
  // the lecture's saved strength — the server owns that, so the editor just
  // asks for the slide.
  it('refines the transcript into the field without saving', async () => {
    mockedRefine.mockResolvedValue({ transcript: 'A refined narration.' })
    const { field } = setup({}, { canRefine: true })

    fireEvent.click(screen.getByRole('button', { name: 'Refine with AI' }))
    await vi.waitFor(() => expect(field).toHaveValue('A refined narration.'))
    expect(mockedRefine).toHaveBeenCalledWith('deck1', 's1')
    expect(mockedSave).not.toHaveBeenCalled()
  })

  it('locks the field while refining', async () => {
    let finish!: (result: DeckRefineSlideTranscriptResult) => void
    mockedRefine.mockReturnValue(
      new Promise<DeckRefineSlideTranscriptResult>(resolve => {
        finish = resolve
      }),
    )
    const { field } = setup({}, { canRefine: true })

    fireEvent.click(screen.getByRole('button', { name: 'Refine with AI' }))
    expect(field).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Refining…' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Save transcript' }),
    ).toBeDisabled()

    finish({ transcript: 'A refined narration.' })
    await vi.waitFor(() => expect(field).toBeEnabled())
    expect(field).toHaveValue('A refined narration.')
  })

  it('keeps the current text and reports a failed refine', async () => {
    mockedRefine.mockRejectedValue(new Error('nope'))
    const { field } = setup({}, { canRefine: true })

    fireEvent.click(screen.getByRole('button', { name: 'Refine with AI' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not refine the transcript',
    )
    expect(field).toHaveValue('A cell is the basic unit of life.')
    expect(field).toBeEnabled()
  })

  it('confirms before discarding a refined transcript', async () => {
    mockedRefine.mockResolvedValue({ transcript: 'A refined narration.' })
    const { onClose, field } = setup({}, { canRefine: true })

    fireEvent.click(screen.getByRole('button', { name: 'Refine with AI' }))
    await vi.waitFor(() => expect(field).toHaveValue('A refined narration.'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  // The lecture's Refine settings can turn the narration pass off; the editor
  // follows that rather than offering a pass the lecture disabled.
  it('hides Refine when the lecture has the narration pass off', () => {
    setup()
    expect(screen.queryByRole('button', { name: 'Refine' })).toBeNull()
  })

  // Previewing runs on the app's shared TTS controller, so it can never play
  // over "Speak this slide" or deck playback.
  it('speaks the field’s current text, not the stored transcript', () => {
    const tts = fakeTts()
    const { field } = setup({}, { tts })

    fireEvent.change(field, { target: { value: 'Unsaved rewrite.' } })
    fireEvent.click(
      screen.getByRole('button', { name: 'Play the spoken transcript' }),
    )
    expect(tts.speakText).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1' }),
      'Unsaved rewrite.',
    )
  })

  it('pauses and resumes an already-running preview', () => {
    const tts = fakeTts({ scope: 'text', status: 'playing' })
    setup({}, { tts })

    const pause = screen.getByRole('button', {
      name: 'Pause the spoken transcript',
    })
    expect(pause).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(pause)
    expect(tts.pauseResume).toHaveBeenCalled()
    expect(tts.speakText).not.toHaveBeenCalled()
  })

  it('shows Play, not Pause, while another slide is being spoken', () => {
    // Deck playback owns the audio: this preview is not the thing playing.
    const tts = fakeTts({ scope: 'deck', status: 'playing' })
    setup({}, { tts })
    fireEvent.click(
      screen.getByRole('button', { name: 'Play the spoken transcript' }),
    )
    expect(tts.speakText).toHaveBeenCalled()
    expect(tts.pauseResume).not.toHaveBeenCalled()
  })

  it('stops a preview when the text it was speaking changes', () => {
    const tts = fakeTts({ scope: 'text', status: 'playing' })
    const { field } = setup({}, { tts })
    expect(tts.stop).not.toHaveBeenCalled()

    // Reading words the user just replaced would be worse than silence.
    fireEvent.change(field, { target: { value: 'Different words.' } })
    expect(tts.stop).toHaveBeenCalled()
  })

  it('leaves other playback alone when it closes', () => {
    const deck = fakeTts({ scope: 'deck', status: 'playing' })
    const { unmount } = setup({}, { tts: deck })
    unmount()
    expect(deck.stop).not.toHaveBeenCalled()

    const preview = fakeTts({ scope: 'text', status: 'playing' })
    setup({}, { tts: preview }).unmount()
    expect(preview.stop).toHaveBeenCalled()
  })

  it('cannot speak an empty field, and hides the control without TTS', () => {
    const tts = fakeTts()
    const { field, unmount } = setup({}, { tts })
    fireEvent.change(field, { target: { value: '   ' } })
    expect(
      screen.getByRole('button', { name: 'Play the spoken transcript' }),
    ).toBeDisabled()
    unmount()

    setup()
    expect(
      screen.queryByRole('button', { name: 'Play the spoken transcript' }),
    ).toBeNull()
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
