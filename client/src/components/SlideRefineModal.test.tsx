/**
 * Unit tests for the per-slide "Refine this slide with AI" dialog (GEN-4): the
 * defaults it opens with, the options it sends for one run, the states that
 * make refining impossible (nothing selected, no audio for speaker ID), the
 * whiteboard-mark warning, and failure handling.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SlideRefineModal from './SlideRefineModal'

const setup = (props: Partial<Parameters<typeof SlideRefineModal>[0]> = {}) => {
  const onRefine = vi.fn(async () => {})
  const onClose = vi.fn()
  render(
    <SlideRefineModal
      number={3}
      defaultLevel={2}
      hasAudio
      onRefine={onRefine}
      onClose={onClose}
      {...props}
    />,
  )
  return { onRefine, onClose }
}

const checkbox = (name: RegExp) => screen.getByRole('checkbox', { name })
const refineButton = () => screen.getByRole('button', { name: 'Refine' })

describe('SlideRefineModal', () => {
  it('opens on the defaults: slide passes on, narration off', () => {
    setup()
    expect(
      screen.getByRole('heading', {
        name: 'Refine this slide with AI — slide 3',
      }),
    ).toBeInTheDocument()
    expect(checkbox(/Refine slide text/)).toBeChecked()
    expect(checkbox(/Refine slide layout/)).toBeChecked()
    expect(checkbox(/Refine slide imagery/)).toBeChecked()
    expect(checkbox(/Refine the spoken transcript/)).not.toBeChecked()
    // Speaker ID follows the audio, like the lecture tab follows recordings.
    expect(checkbox(/Identify multiple speakers/)).toBeChecked()
  })

  it('leaves speaker identification off when there is no audio to read', () => {
    setup({ hasAudio: false })
    expect(checkbox(/Identify multiple speakers/)).not.toBeChecked()
  })

  it('runs every selected pass at the chosen strength', async () => {
    const { onRefine, onClose } = setup()

    fireEvent.click(checkbox(/Refine the spoken transcript/))
    fireEvent.change(
      screen.getByRole('slider', { name: 'How much to refine this slide' }),
      { target: { value: '5' } },
    )
    fireEvent.click(refineButton())

    expect(onRefine).toHaveBeenCalledWith({
      identifySpeakers: true,
      parts: { text: true, layout: true, imagery: true },
      refineTranscript: true,
      // One slider, applied to the slide and its narration alike.
      level: 5,
    })
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('sends only the parts left checked', () => {
    const { onRefine } = setup()
    fireEvent.click(checkbox(/Refine slide text/))
    fireEvent.click(checkbox(/Refine slide imagery/))
    fireEvent.click(refineButton())

    expect(onRefine).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: { text: false, layout: true, imagery: false },
      }),
    )
  })

  it('starts the slider at the lecture’s level', () => {
    setup({ defaultLevel: 4 })
    expect(
      screen.getByRole('slider', { name: 'How much to refine this slide' }),
    ).toHaveValue('4')
  })

  // Speaker identification reads the slide's recorded audio; without it there
  // is nothing to diarize.
  it('disables speaker identification when the slide has no audio', () => {
    setup({ hasAudio: false })
    expect(checkbox(/Identify multiple speakers/)).toBeDisabled()
    expect(
      screen.getByText(/No recorded audio remains for this slide/),
    ).toBeInTheDocument()
  })

  it('cannot refine with nothing selected', () => {
    const { onRefine } = setup()
    fireEvent.click(checkbox(/Identify multiple speakers/))
    fireEvent.click(checkbox(/Refine slide text/))
    fireEvent.click(checkbox(/Refine slide layout/))
    fireEvent.click(checkbox(/Refine slide imagery/))
    expect(refineButton()).toBeDisabled()

    fireEvent.click(refineButton())
    expect(onRefine).not.toHaveBeenCalled()
  })

  it('warns about whiteboard marks only when the slide has them', () => {
    const note = /whiteboard markings/i
    const { unmount } = render(
      <SlideRefineModal
        number={1}
        defaultLevel={2}
        marked
        onRefine={vi.fn(async () => {})}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText(note)).toBeInTheDocument()
    unmount()

    setup()
    expect(screen.queryByText(note)).toBeNull()
  })

  it('sends the blurb link to the lecture-wide Refine settings', () => {
    const onOpenLectureRefine = vi.fn()
    setup({ onOpenLectureRefine })
    fireEvent.click(
      screen.getByRole('button', { name: 'lecture-wide options' }),
    )
    expect(onOpenLectureRefine).toHaveBeenCalled()
  })

  it('names the lecture-wide options without a link when there is nowhere to go', () => {
    setup()
    expect(
      screen.queryByRole('button', { name: 'lecture-wide options' }),
    ).toBeNull()
    expect(screen.getByText(/lecture-wide options/)).toBeInTheDocument()
  })

  it('stays open and reports a failed refine', async () => {
    const onClose = vi.fn()
    render(
      <SlideRefineModal
        number={1}
        defaultLevel={2}
        onRefine={vi.fn(async () => {
          throw new Error('nope')
        })}
        onClose={onClose}
      />,
    )
    fireEvent.click(refineButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not refine this slide',
    )
    expect(onClose).not.toHaveBeenCalled()
    // Still usable for a retry.
    expect(refineButton()).toBeEnabled()
  })

  it('locks the controls while refining', async () => {
    let finish!: () => void
    render(
      <SlideRefineModal
        number={1}
        defaultLevel={2}
        hasAudio
        onRefine={() =>
          new Promise<void>(resolve => {
            finish = resolve
          })
        }
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(refineButton())

    expect(screen.getByRole('button', { name: 'Refining…' })).toBeDisabled()
    expect(checkbox(/Refine slide text/)).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    finish()
  })
})
