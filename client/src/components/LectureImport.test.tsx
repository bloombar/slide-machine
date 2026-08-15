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
import LectureImport from './LectureImport'

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
    <LectureImport projectId="p1" onImported={vi.fn()} onClose={vi.fn()} />,
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
      <LectureImport
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

describe('what happens once it has worked', () => {
  it('hands the report to the caller rather than showing it here', async () => {
    // The panel closes on success, so what happened has to survive it — the
    // page says it beside the lecture that arrived
    const onImported = vi.fn()
    render(
      <LectureImport
        projectId="p1"
        onImported={onImported}
        onClose={vi.fn()}
      />,
    )
    importLink('1AbCdEfGhIjKl')

    await waitFor(() =>
      expect(onImported).toHaveBeenCalledWith(
        expect.objectContaining({
          deck,
          report: expect.objectContaining({
            slidesRead: 10,
            layoutsCreated: 3,
          }),
        }),
      ),
    )
  })

  it('shows no report of its own, having closed', async () => {
    render(
      <LectureImport projectId="p1" onImported={vi.fn()} onClose={vi.fn()} />,
    )
    importLink('1AbCdEfGhIjKl')

    await waitFor(() => expect(dispatchAction).toHaveBeenCalled())
    expect(
      screen.queryByTestId('lecture-import-report'),
    ).not.toBeInTheDocument()
  })

  it('carries a file import’s warnings up the same way', async () => {
    dispatchAction.mockResolvedValue({
      deck,
      warnings: ['Unknown template "foo" — using the default instead.'],
    })
    const onImported = vi.fn()
    render(
      <LectureImport
        projectId="p1"
        onImported={onImported}
        onClose={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText(/import a \.yaml lecture file/i), {
      target: {
        files: [
          new File(['version: 1\nkind: deck\n'], 'deck.yaml', {
            type: 'application/x-yaml',
          }),
        ],
      },
    })

    await waitFor(() =>
      expect(onImported).toHaveBeenCalledWith(
        expect.objectContaining({
          warnings: ['Unknown template "foo" — using the default instead.'],
        }),
      ),
    )
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
