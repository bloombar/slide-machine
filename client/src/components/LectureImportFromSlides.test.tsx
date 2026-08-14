/**
 * Creating a lecture from a Google Slides presentation (EXP-5), from the
 * instructor's side.
 *
 * Three things carry this panel: the pasted link has to become a presentation
 * id without the instructor thinking about it, the lecture has to arrive in
 * the list straight away, and the report has to say what happened to both
 * halves — an import that produced a template as well is something the author
 * may want to keep instead of the lecture.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { Deck, Template } from '@slide-machine/shared'
import LectureImportFromSlides from './LectureImportFromSlides'

const dispatchAction = vi.fn()
vi.mock('../api/actions', () => ({
  dispatchAction: (...args: unknown[]) => dispatchAction(...args),
}))

const deck = { id: 'd1', title: 'Photosynthesis' } as Deck
const template = { id: 't1', name: 'Photosynthesis' } as Template

const result = (over: Record<string, unknown> = {}) => ({
  deck,
  template,
  report: {
    slidesRead: 10,
    layoutsCreated: 3,
    approximated: 1,
    assetsFailed: 0,
    ...over,
  },
})

beforeEach(() => {
  dispatchAction.mockReset()
  dispatchAction.mockResolvedValue(result())
})

const importLink = (link: string) => {
  fireEvent.change(screen.getByLabelText('Google Slides link'), {
    target: { value: link },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Import lecture' }))
}

const renderPanel = () =>
  render(
    <LectureImportFromSlides
      projectId="p1"
      onImported={vi.fn()}
      onClose={vi.fn()}
    />,
  )

describe('importing a lecture', () => {
  it('will not submit until the link is one', () => {
    renderPanel()
    expect(
      screen.getByRole('button', { name: 'Import lecture' }),
    ).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Google Slides link'), {
      target: { value: 'not a link' },
    })
    expect(
      screen.getByRole('button', { name: 'Import lecture' }),
    ).toBeDisabled()
    expect(screen.getByText(/doesn't look like/i)).toBeInTheDocument()
  })

  it('sends the id it found and the project it lands in', async () => {
    renderPanel()
    importLink('https://docs.google.com/presentation/d/1AbC_dEf-123/edit')

    await waitFor(() =>
      expect(dispatchAction).toHaveBeenCalledWith('deck.importFromSlides', {
        projectId: 'p1',
        presentationId: '1AbC_dEf-123',
      }),
    )
  })

  it('consolidates unless told otherwise, as the design import does', async () => {
    renderPanel()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    importLink('1AbCdEfGhIjKl')

    await waitFor(() =>
      expect(dispatchAction).toHaveBeenCalledWith(
        'deck.importFromSlides',
        expect.not.objectContaining({ keepEverySlide: true }),
      ),
    )
  })

  it('asks for every slide when the instructor ticks the box', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('checkbox'))
    importLink('1AbCdEfGhIjKl')

    await waitFor(() =>
      expect(dispatchAction).toHaveBeenCalledWith(
        'deck.importFromSlides',
        expect.objectContaining({ keepEverySlide: true }),
      ),
    )
  })

  it('hands the lecture back so it can be listed and opened', async () => {
    const onImported = vi.fn()
    render(
      <LectureImportFromSlides
        projectId="p1"
        onImported={onImported}
        onClose={vi.fn()}
      />,
    )
    importLink('1AbCdEfGhIjKl')

    await waitFor(() =>
      expect(onImported).toHaveBeenCalledWith(
        expect.objectContaining({ deck, template }),
      ),
    )
  })
})

describe('what the instructor is told afterwards', () => {
  it('says how many slides became how many layouts', async () => {
    renderPanel()
    importLink('1AbCdEfGhIjKl')

    const report = await screen.findByTestId('lecture-import-report')
    expect(report).toHaveTextContent(/10 slides became 3 layouts/)
  })

  it('names the slides whose material did not fit', async () => {
    // EXP-5: named rather than silently truncated — "slide 4: image" is
    // something an author can act on, "3 dropped" is not
    dispatchAction.mockResolvedValue(
      result({ contentDropped: [{ slide: 4, slots: ['image'] }] }),
    )
    renderPanel()
    importLink('1AbCdEfGhIjKl')

    const report = await screen.findByTestId('lecture-import-report')
    expect(report).toHaveTextContent(/4: image/)
  })

  it('stays quiet about material that all fitted', async () => {
    renderPanel()
    importLink('1AbCdEfGhIjKl')

    const report = await screen.findByTestId('lecture-import-report')
    expect(report).not.toHaveTextContent(/didn't fit/i)
  })

  it('says the presentation itself was left alone', async () => {
    renderPanel()
    importLink('1AbCdEfGhIjKl')

    const report = await screen.findByTestId('lecture-import-report')
    expect(report).toHaveTextContent(/nothing was changed in the presentation/i)
  })
})

describe('when it will not work', () => {
  it('offers the missing step rather than an error, when Google is not connected', async () => {
    dispatchAction.mockRejectedValue(new Error('connect google first'))
    renderPanel()
    importLink('1AbCdEfGhIjKl')

    expect(
      await screen.findByRole('button', { name: /connect google/i }),
    ).toBeInTheDocument()
  })

  it('reports any other failure without blaming the instructor', async () => {
    dispatchAction.mockRejectedValue(new Error('boom'))
    renderPanel()
    importLink('1AbCdEfGhIjKl')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not import that presentation/i,
    )
  })
})
