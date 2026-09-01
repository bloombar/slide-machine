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
    // Breaking the slide up changes how many slides the lecture has, so it is
    // opted into as well.
    expect(checkbox(/Break up this slide/)).not.toBeChecked()
    // Speaker ID is opted into, not out of: it re-reads the whole recording at
    // the same per-minute rate as capturing it, so refining a slide's wording
    // must not quietly spend a diarization allowance too.
    expect(checkbox(/Identify multiple speakers/)).not.toBeChecked()
  })

  it('leaves speaker identification off even when there is audio to read', () => {
    setup({ hasAudio: true })
    expect(checkbox(/Identify multiple speakers/)).not.toBeChecked()
    expect(checkbox(/Identify multiple speakers/)).toBeEnabled()
  })

  it('leaves speaker identification off when there is no audio to read', () => {
    setup({ hasAudio: false })
    expect(checkbox(/Identify multiple speakers/)).not.toBeChecked()
  })

  // This dialog IS what the lecture-wide tab recommends, so it does not repeat
  // the advice to prefer it.
  it('does not carry the lecture-wide "prefer per slide" advice', () => {
    setup()
    expect(screen.queryByText(/Usually better one slide at a time/)).toBeNull()
  })

  it('runs every selected pass at the chosen strength', async () => {
    const { onRefine, onClose } = setup()

    fireEvent.click(checkbox(/Refine the spoken transcript/))
    // Speaker ID starts off, so selecting "every pass" means asking for it.
    fireEvent.click(checkbox(/Identify multiple speakers/))
    fireEvent.change(
      screen.getByRole('slider', { name: 'How much to refine this slide' }),
      { target: { value: '5' } },
    )
    fireEvent.click(refineButton())

    expect(onRefine).toHaveBeenCalledWith({
      identifySpeakers: true,
      parts: { text: true, layout: true, imagery: true },
      allowSplit: false,
      refineTranscript: true,
      // One slider, applied to the slide and its narration alike.
      level: 5,
    })
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  /**
   * Breaking the slide up (GEN-4).
   *
   * The checkbox IS the consent — a ticked box is what makes the server write
   * a split, and there is no dialog afterwards to catch a mistake. So what
   * matters is that the answer travels: a form that shows the box but sends
   * nothing would silently never split, and one that sends true regardless
   * would divide lectures nobody asked to divide.
   */
  it('asks for no split while the box is unticked', () => {
    const { onRefine } = setup()
    fireEvent.click(refineButton())
    expect(onRefine).toHaveBeenCalledWith(
      expect.objectContaining({ allowSplit: false }),
    )
  })

  it('asks for one once it is ticked', () => {
    const { onRefine } = setup()
    fireEvent.click(checkbox(/Break up this slide/))
    fireEvent.click(refineButton())
    expect(onRefine).toHaveBeenCalledWith(
      expect.objectContaining({ allowSplit: true }),
    )
  })

  it('starts from the lecture’s saved answer', () => {
    setup({ defaultAllowSplit: true })
    expect(checkbox(/Break up this slide/)).toBeChecked()
  })

  it('promises that a slide that does not need it is left whole', () => {
    // The reassurance is the point of the copy: a checkbox that reads as
    // "divide my slide" gets left off by people who would have wanted it.
    setup()
    expect(
      screen.getByText(/only if one slide genuinely cannot hold it/i),
    ).toBeInTheDocument()
  })

  it('goes unavailable when the text pass is off, and asks for nothing', () => {
    // Splitting is a claim about the slide's WORDS. A refine not reading them
    // cannot make it, so the box must not quietly ask for one.
    const { onRefine } = setup()
    fireEvent.click(checkbox(/Break up this slide/))
    fireEvent.click(checkbox(/Refine slide text/))
    expect(checkbox(/Break up this slide/)).toBeDisabled()
    expect(checkbox(/Break up this slide/)).not.toBeChecked()

    fireEvent.click(refineButton())
    expect(onRefine).toHaveBeenCalledWith(
      expect.objectContaining({ allowSplit: false }),
    )
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
    // Speaker ID is already off by default; unchecking the three content
    // passes is all it takes to leave nothing selected.
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
