/**
 * Creating a lecture from a Google Slides presentation (EXP-5), from the
 * instructor's side.
 *
 * Three things carry this panel: the presentation picked in Drive has to reach
 * the import with the project it lands in, the lecture has to arrive in the
 * list straight away, and the report has to say what happened to both halves —
 * an import that produced a template as well is something the author may want
 * to keep instead of the lecture.
 *
 * The picker here is the mock one: with no Google configured, DrivePicker
 * draws the app's own dialog over `drive.importables`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { Deck, Template } from '@slide-machine/shared'
import LectureImport from './LectureImport'
import { ApiError } from '../api/http'

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

/** The (mock) Drive the picker browses: one presentation to import. */
const TREE = {
  folders: [],
  files: [
    {
      id: '1AbC_dEf-123',
      name: 'Photosynthesis',
      mimeType: 'application/vnd.google-apps.presentation',
    },
  ],
}

/** What the import itself answers; the picker's listing is answered
 * separately, so one mock serves both calls. */
let importOutcome: () => Promise<unknown>

beforeEach(() => {
  dispatchAction.mockReset()
  importOutcome = () => Promise.resolve(result())
  dispatchAction.mockImplementation((action: string) =>
    action === 'drive.importables' ? Promise.resolve(TREE) : importOutcome(),
  )
})

/** Opens the Drive picker and chooses the presentation in it. */
const pick = async () => {
  fireEvent.click(
    screen.getByRole('button', { name: /choose a presentation/i }),
  )
  fireEvent.click(
    await screen.findByRole('button', { name: /photosynthesis/i }),
  )
}

/** Chooses the presentation and submits it. */
const pickAndImport = async () => {
  await pick()
  fireEvent.click(screen.getByRole('button', { name: 'Import lecture' }))
}

const renderPanel = () =>
  render(
    <LectureImport projectId="p1" onImported={vi.fn()} onClose={vi.fn()} />,
  )

describe('importing a lecture', () => {
  it('will not submit until a presentation has been chosen', async () => {
    renderPanel()
    expect(
      screen.getByRole('button', { name: 'Import lecture' }),
    ).toBeDisabled()

    await pick()
    expect(screen.getByRole('button', { name: 'Import lecture' })).toBeEnabled()
  })

  it('sends the id it was given and the project it lands in', async () => {
    renderPanel()
    await pickAndImport()

    await waitFor(() =>
      expect(dispatchAction).toHaveBeenCalledWith('deck.importFromSlides', {
        projectId: 'p1',
        presentationId: '1AbC_dEf-123',
        keepEverySlide: true,
      }),
    )
  })

  it('keeps every slide, a lecture being the deck itself', async () => {
    // No choice to offer: consolidation is what makes a *template* usable,
    // and merging two slides that were drawn differently redraws one of them.
    // The instructor asked for their lecture, not a tidied version of it.
    renderPanel()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    await pickAndImport()

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
    await pickAndImport()

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
    await pickAndImport()

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
    await pickAndImport()

    await waitFor(() => expect(dispatchAction).toHaveBeenCalled())
    expect(
      screen.queryByTestId('lecture-import-report'),
    ).not.toBeInTheDocument()
  })

  it('carries a file import’s warnings up the same way', async () => {
    importOutcome = () =>
      Promise.resolve({
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
    fireEvent.change(screen.getByLabelText(/import a lecture file/i), {
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
    importOutcome = () => Promise.reject(new Error('connect google first'))
    renderPanel()
    await pickAndImport()

    expect(
      await screen.findByRole('button', { name: /connect google/i }),
    ).toBeInTheDocument()
  })

  it('says so plainly when the deck is not the instructor’s to open', async () => {
    // A pasted link to a colleague's lecture. This used to offer "Connect
    // Google", which sends them through the consent screen to arrive back at
    // exactly the same refusal — the connection was never the problem.
    importOutcome = () =>
      Promise.reject(new ApiError(403, 'source_forbidden', 'no access'))
    renderPanel()
    await pickAndImport()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /do not have access/i,
    )
    expect(screen.queryByRole('button', { name: /connect google/i })).toBeNull()
  })

  it('still offers the reconnect when the connection IS the problem', async () => {
    importOutcome = () =>
      Promise.reject(new ApiError(403, 'google_reconnect', 'stale'))
    renderPanel()
    await pickAndImport()

    expect(
      await screen.findByRole('button', { name: /connect google/i }),
    ).toBeInTheDocument()
  })

  it('reports any other failure without blaming the instructor', async () => {
    importOutcome = () => Promise.reject(new Error('boom'))
    renderPanel()
    await pickAndImport()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not import that presentation/i,
    )
  })
})
