/**
 * Importing a design from Google Slides (TMPL-8), from the instructor's side.
 *
 * Two things carry this screen: what the instructor picked in Drive has to
 * reach the right import — a presentation is a design to derive, a file is one
 * this app already wrote — and the report has to say what the import did, since
 * consolidation is lossy and silence about it would leave the author wondering
 * what was thrown away.
 *
 * The picker here is the mock one: with no Google configured, DrivePicker
 * draws the app's own dialog over `drive.importables`, which is what a dev
 * machine and this suite get.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { Template } from '@slide-machine/shared'
import TemplateImport, { importSourceFor } from './TemplateImport'
import { ApiError } from '../../api/http'

const dispatchAction = vi.fn()
vi.mock('../../api/actions', () => ({
  dispatchAction: (...args: unknown[]) => dispatchAction(...args),
}))

const template = { id: 't1', name: 'Imported design' } as Template

const result = (over: Record<string, unknown> = {}) => ({
  template,
  report: {
    slidesRead: 38,
    layoutsCreated: 6,
    largestMerge: { type: 'title-and-bullets', slides: 11 },
    approximated: 2,
    assetsFailed: 0,
    ...over,
  },
})

/** The (mock) Drive the picker browses: one presentation to derive a design
 * from, and one design file this app exported earlier. */
const TREE = {
  folders: [],
  files: [
    {
      id: '1AbCdEfGhIjKl',
      name: 'Photosynthesis',
      mimeType: 'application/vnd.google-apps.presentation',
    },
    {
      id: '1FiLe_iD-99',
      name: 'classic.template.yaml',
      mimeType: 'application/x-yaml',
    },
  ],
}

/** What the import itself answers. Set per test; the picker's own listing is
 * answered separately, so one mock can serve both calls. */
let importOutcome: () => Promise<unknown>

beforeEach(() => {
  dispatchAction.mockReset()
  importOutcome = () => Promise.resolve(result())
  dispatchAction.mockImplementation((action: string) =>
    action === 'drive.importables' ? Promise.resolve(TREE) : importOutcome(),
  )
})

/** Opens the panel, which stays out of the way until asked for. */
const openPanel = () => {
  fireEvent.click(screen.getByRole('button', { name: /import a design/i }))
}

/** Opens the Drive picker and chooses the named file. */
const pick = async (name: RegExp) => {
  fireEvent.click(
    screen.getByRole('button', { name: /choose from google drive/i }),
  )
  fireEvent.click(await screen.findByRole('button', { name }))
}

/** Chooses a file and submits it for import. */
const pickAndImport = async (name: RegExp) => {
  await pick(name)
  fireEvent.click(screen.getByRole('button', { name: /import design/i }))
}

/** The presentation in the tree above; the id every assertion expects. */
const PRESENTATION = /photosynthesis/i
/** The exported design file in the tree above. */
const DESIGN_FILE = /classic\.template\.yaml/i

describe('what the picked file turns out to be', () => {
  it('sends a presentation to the design import', () => {
    expect(
      importSourceFor({
        id: '1AbC_dEf-123',
        name: 'Photosynthesis',
        mimeType: 'application/vnd.google-apps.presentation',
      }),
    ).toEqual({ action: 'template.importFromSlides', id: '1AbC_dEf-123' })
  })

  it('sends anything else to the file import, which is what it is', () => {
    // A design this app exported is a stored file, not a presentation — and
    // the picker says which by mime type, so nothing has to be guessed from
    // the shape of a link
    expect(
      importSourceFor({
        id: '1FiLe_iD-99',
        name: 'classic.template.yaml',
        mimeType: 'application/x-yaml',
      }),
    ).toEqual({ action: 'template.importFromDrive', id: '1FiLe_iD-99' })
  })
})

describe('importing', () => {
  it('stays out of the way until asked for', () => {
    render(<TemplateImport onImported={vi.fn()} />)
    expect(
      screen.queryByRole('button', { name: /choose from google drive/i }),
    ).not.toBeInTheDocument()
  })

  it('will not submit until a file has been chosen', async () => {
    render(<TemplateImport onImported={vi.fn()} />)
    openPanel()
    expect(
      screen.getByRole('button', { name: /import design/i }),
    ).toBeDisabled()

    await pick(PRESENTATION)
    expect(screen.getByRole('button', { name: /import design/i })).toBeEnabled()
  })

  it('sends the id of the file that was picked', async () => {
    render(<TemplateImport onImported={vi.fn()} />)
    openPanel()
    await pickAndImport(PRESENTATION)

    await waitFor(() =>
      expect(dispatchAction).toHaveBeenCalledWith('template.importFromSlides', {
        presentationId: '1AbCdEfGhIjKl',
        keepEverySlide: true,
      }),
    )
  })

  it('keeps every slide unless the instructor asks for tidying', async () => {
    // Which slides are "the same design" is a judgement, and one made
    // silently leaves an author with fewer layouts than slides and no way to
    // see why. So it is offered rather than taken (TMPL-8).
    render(<TemplateImport onImported={vi.fn()} />)
    openPanel()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    await pickAndImport(PRESENTATION)

    await waitFor(() =>
      expect(dispatchAction).toHaveBeenCalledWith('template.importFromSlides', {
        presentationId: '1AbCdEfGhIjKl',
        keepEverySlide: true,
      }),
    )
  })

  it('combines near-identical slides when the box is ticked', async () => {
    // A hand-built deck usually rebuilds one design many times over, and
    // recognising those as one layout is what makes the result usable.
    render(<TemplateImport onImported={vi.fn()} />)
    openPanel()
    fireEvent.click(screen.getByRole('checkbox'))
    await pickAndImport(PRESENTATION)

    await waitFor(() =>
      expect(dispatchAction).toHaveBeenCalledWith('template.importFromSlides', {
        presentationId: '1AbCdEfGhIjKl',
        keepEverySlide: false,
      }),
    )
  })

  it('hands the new design back so it can be worn straight away', async () => {
    const onImported = vi.fn()
    render(<TemplateImport onImported={onImported} />)
    openPanel()
    await pickAndImport(PRESENTATION)

    await waitFor(() => expect(onImported).toHaveBeenCalledWith(template))
  })

  it('says it is working, since reading a deck is not instant', async () => {
    importOutcome = () => new Promise(() => {})
    render(<TemplateImport onImported={vi.fn()} />)
    openPanel()
    await pickAndImport(PRESENTATION)

    expect(await screen.findByText(/reading the presentation/i)).toBeVisible()
  })
})

describe('what the instructor is told afterwards', () => {
  const importOne = async (over: Record<string, unknown> = {}) => {
    importOutcome = () => Promise.resolve(result(over))
    render(<TemplateImport onImported={vi.fn()} />)
    openPanel()
    await pickAndImport(PRESENTATION)
    await screen.findByRole('status')
  }

  it('says how many slides became how many layouts', async () => {
    await importOne()
    expect(screen.getByRole('status')).toHaveTextContent(
      '38 slides → 6 layouts',
    )
  })

  it('says what was merged and what was only approximated', async () => {
    // Consolidation is a judgment call, so it is stated rather than logged
    await importOne()
    const report = screen.getByRole('status')
    expect(report).toHaveTextContent(/11 near-identical slides merged/i)
    expect(report).toHaveTextContent(/2 matched to the closest layout/i)
  })

  it('mentions images that could not be retrieved', async () => {
    await importOne({ assetsFailed: 3 })
    expect(screen.getByRole('status')).toHaveTextContent(
      /3 images couldn’t be fetched|3 images couldn't be fetched/i,
    )
  })

  it('stays quiet about the things that did not happen', async () => {
    await importOne({
      approximated: 0,
      assetsFailed: 0,
      largestMerge: undefined,
    })
    const report = screen.getByRole('status')
    expect(report).not.toHaveTextContent(/closest layout/i)
    expect(report).not.toHaveTextContent(/couldn.t be fetched/i)
    expect(report).not.toHaveTextContent(/merged/i)
  })

  it('says the presentation itself was left alone', async () => {
    await importOne()
    expect(screen.getByRole('status')).toHaveTextContent(
      /your presentation wasn.t changed/i,
    )
  })
})

describe('choosing before Google is connected', () => {
  it('connects from inside the picker and opens it again', async () => {
    // The picker cannot list a Drive this account has not granted, so the
    // first open is an error with a way out. Taking it must land back at the
    // files — not at a closed panel the instructor has to find again.
    let connected = false
    dispatchAction.mockImplementation((action: string) => {
      if (action === 'quiz.connectGoogle') {
        connected = true
        return Promise.resolve({ status: 'connected' })
      }
      if (action === 'drive.importables') {
        return connected
          ? Promise.resolve(TREE)
          : Promise.reject(new ApiError(403, 'capability_required', 'connect'))
      }
      return importOutcome()
    })

    render(<TemplateImport onImported={vi.fn()} />)
    openPanel()
    fireEvent.click(
      screen.getByRole('button', { name: /choose from google drive/i }),
    )
    fireEvent.click(await screen.findByRole('button', { name: /reconnect/i }))

    // Reopened on its own, now listing what the grant allows.
    expect(
      await screen.findByRole('button', { name: PRESENTATION }),
    ).toBeInTheDocument()
  })
})

describe('when it will not work', () => {
  it('explains a presentation Google would not hand over', async () => {
    // Told apart by code rather than by sniffing the message for "google",
    // which missed every refusal it had not seen before — and missed this one
    // entirely while it arrived as a plain 500
    importOutcome = () =>
      Promise.reject(
        new ApiError(400, 'source_unreadable', 'Slides read failed (500)'),
      )
    render(<TemplateImport onImported={vi.fn()} />)
    openPanel()
    await pickAndImport(PRESENTATION)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /would not hand over that file/i,
    )
  })

  it('says a presentation that is not there is not there', async () => {
    // A different instruction from a refused read: check the link, not the
    // account
    importOutcome = () =>
      Promise.reject(
        new ApiError(
          404,
          'source_not_found',
          'That presentation was not found',
        ),
      )
    render(<TemplateImport onImported={vi.fn()} />)
    openPanel()
    await pickAndImport(PRESENTATION)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /not found in your drive/i,
    )
  })

  it('offers the reconnect when Google refuses the account', async () => {
    importOutcome = () =>
      Promise.reject(
        new ApiError(403, 'google_reconnect', 'would not let this account'),
      )
    render(<TemplateImport onImported={vi.fn()} />)
    openPanel()
    await pickAndImport(PRESENTATION)

    expect(
      await screen.findByRole('button', { name: /connect google/i }),
    ).toBeInTheDocument()
  })

  it('reports any other failure without blaming the instructor', async () => {
    importOutcome = () => Promise.reject(new Error('boom'))
    render(<TemplateImport onImported={vi.fn()} />)
    openPanel()
    await pickAndImport(PRESENTATION)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not import that presentation/i,
    )
  })
})

describe('a design file kept in Drive', () => {
  it('is imported through the file route', async () => {
    importOutcome = () => Promise.resolve(template)
    render(<TemplateImport onImported={vi.fn()} />)
    openPanel()
    await pickAndImport(DESIGN_FILE)

    await waitFor(() =>
      expect(dispatchAction).toHaveBeenCalledWith('template.importFromDrive', {
        fileId: '1FiLe_iD-99',
      }),
    )
  })

  it('offers no consolidation choice, having no slides to consolidate', async () => {
    render(<TemplateImport onImported={vi.fn()} />)
    openPanel()
    expect(screen.getByRole('checkbox')).toBeInTheDocument()

    await pick(DESIGN_FILE)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('hands the template back the same way, though nothing is reported', async () => {
    // A file comes back as the template it already was: no slides were read,
    // so there is nothing to say about what became of them
    const onImported = vi.fn()
    importOutcome = () => Promise.resolve(template)
    render(<TemplateImport onImported={onImported} />)
    openPanel()
    await pickAndImport(DESIGN_FILE)

    await waitFor(() => expect(onImported).toHaveBeenCalledWith(template))
    expect(screen.queryByTestId('import-report')).not.toBeInTheDocument()
  })
})
